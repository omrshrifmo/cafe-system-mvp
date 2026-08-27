/**
 * Client-Side Realtime WebSocket Connection & State Machine
 * States: CONNECTED, DEGRADED, RECONNECTING, SYNCING, OFFLINE, STALE
 */
class RealtimeClient {
  constructor(options = {}) {
    this.venueId = options.venueId || 'V_DEFAULT';
    this.stationId = options.stationId || 'HALL';
    this.token = options.token || null;
    this.state = 'OFFLINE'; // CONNECTED, DEGRADED, RECONNECTING, SYNCING, OFFLINE, STALE
    this.ws = null;
    this.lastSequence = 0;
    this.lastEventTime = null;
    this.listeners = new Map();
    this.stateListeners = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.baseBackoffMs = 1000;
    this.maxBackoffMs = 30000;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.deviceId = this.getOrCreateDeviceId();
    this.pollingTimer = null;
    this.staleTimer = null;
    this.lastEventId = null;
    this.cursorKey = `cafe_rt_cursor_${this.venueId}_${this.stationId}`;
    this.restoreCursor();

    // Auto-initiate network listener
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkOnline());
      window.addEventListener('offline', () => this.handleNetworkOffline());
    }
  }

  getOrCreateDeviceId() {
    if (typeof localStorage === 'undefined') return 'DEV-UNKNOWN';
    let id = localStorage.getItem('cafe_device_id');
    if (!id) {
      id = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem('cafe_device_id', id);
    }
    return id;
  }

  /**
   * Restore persisted event cursor so reconnect replays from where we left off,
   * without requiring a manual refresh or losing accepted events.
   */
  restoreCursor() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = parseInt(localStorage.getItem(this.cursorKey), 10);
      if (!isNaN(saved) && saved > 0) {
        this.lastSequence = saved;
      }
    } catch (e) { /* private mode */ }
  }

  persistCursor() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.cursorKey, String(this.lastSequence));
    } catch (e) { /* private mode */ }
  }

  setState(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    console.log(`[RealtimeClient] State change: ${oldState} -> ${newState}`);
    this.stateListeners.forEach(cb => cb(newState, oldState));
  }

  onStateChange(callback) {
    this.stateListeners.push(callback);
    callback(this.state, null);
  }

  on(topic, handler) {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, []);
    }
    this.listeners.get(topic).push(handler);
  }

  connect() {
    if (typeof window === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!navigator.onLine) {
      this.setState('OFFLINE');
      return;
    }

    this.setState(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'SYNCING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let url = `${protocol}//${host}/ws?venueId=${encodeURIComponent(this.venueId)}&stationId=${encodeURIComponent(this.stationId)}&cursor=${this.lastSequence}&deviceId=${this.deviceId}`;
    if (this.token) {
      url += `&token=${encodeURIComponent(this.token)}`;
    }

    try {
      this.ws = new WebSocket(url);
      this.setupSocketHandlers();
    } catch (err) {
      console.error('[RealtimeClient] Connection creation error:', err);
      this.scheduleReconnect();
    }
  }

  setupSocketHandlers() {
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.stopPollingFallback();
      this.setState('CONNECTED');
      this.startHeartbeat();
      this.markFresh();
      // Replay any events missed while disconnected — no manual refresh needed
      if (this.lastSequence > 0) {
        setTimeout(() => this.requestReplay(this.lastSequence), 300);
      }
      console.log('✅ [RealtimeClient] WebSocket connected successfully');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleIncomingMessage(msg);
      } catch (err) {
        console.warn('[RealtimeClient] Malformed WS message:', err);
      }
    };

    this.ws.onclose = (event) => {
      this.cleanupHeartbeat();
      if (!navigator.onLine) {
        this.setState('OFFLINE');
      } else {
        this.setState('DEGRADED');
        this.startPollingFallback();
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[RealtimeClient] WebSocket error event:', err);
      this.setState('DEGRADED');
    };
  }

  handleIncomingMessage(msg) {
    if (msg.type === 'PONG') {
      if (this.pongTimeout) clearTimeout(this.pongTimeout);
      if (this.state === 'DEGRADED') this.setState('CONNECTED');
      return;
    }

    if (msg.type === 'CONNECTED_HANDSHAKE') {
      this.setState('CONNECTED');
      return;
    }

    // Process sequenced event
    if (msg.sequence) {
      const seq = parseInt(msg.sequence, 10);

      // Gap Detection: If we received seq > lastSequence + 1, request replay
      if (this.lastSequence > 0 && seq > this.lastSequence + 1) {
        console.warn(`[RealtimeClient] Sequence gap detected: Expected ${this.lastSequence + 1}, received ${seq}. Requesting replay.`);
        this.requestReplay(this.lastSequence);
      }

      if (seq > this.lastSequence) {
        this.lastSequence = seq;
        this.persistCursor();
      }

      // Send ACK back to server
      this.sendAck(seq);
    }

    if (msg.event_id) this.lastEventId = msg.event_id;
    this.lastEventTime = msg.timestamp || new Date().toISOString();
    this.markFresh();

    // Dispatch to topic handlers
    const topic = msg.topic;
    if (topic && this.listeners.has(topic)) {
      this.listeners.get(topic).forEach(handler => {
        try {
          handler(msg.payload || msg.data || msg);
        } catch (e) {
          console.error(`[RealtimeClient] Handler error for ${topic}:`, e);
        }
      });
    }

    // Also dispatch to wildcard listeners
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(handler => handler(msg));
    }
  }

  sendAck(sequence) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ACK', sequence }));
    }
  }

  requestReplay(fromSequence) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'REQUEST_REPLAY', from_sequence: fromSequence }));
    } else {
      // Socket down: HTTP replay path so no manual refresh is required
      this.httpReplay(fromSequence);
    }
  }

  /**
   * HTTP-based replay/snapshot recovery. Used on reconnect when the socket is
   * unavailable, guaranteeing accepted events arrive without manual refresh.
   */
  async httpReplay(fromSequence) {
    try {
      const res = await fetch(`/api/realtime/events?venueId=${encodeURIComponent(this.venueId)}&since=${fromSequence}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const events = (body && body.data && body.data.events) || [];
      for (const ev of events) {
        this.handleIncomingMessage(ev);
      }
      // If server says our cursor is too old for replay, load snapshot instead
      if (body && body.data && body.data.snapshot_required) {
        await this.loadSnapshot();
      }
    } catch (err) {
      console.warn('[RealtimeClient] HTTP replay failed:', err.message);
      this.startPollingFallback();
    }
  }

  async loadSnapshot() {
    try {
      const res = await fetch(`/api/realtime/snapshot?venueId=${encodeURIComponent(this.venueId)}&stationId=${encodeURIComponent(this.stationId)}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const snap = body && body.data;
      if (snap) {
        if (snap.sequence) {
          this.lastSequence = snap.sequence;
          this.persistCursor();
        }
        if (this.listeners.has('SNAPSHOT')) {
          this.listeners.get('SNAPSHOT').forEach(h => { try { h(snap); } catch (e) { } });
        }
      }
    } catch (err) {
      console.warn('[RealtimeClient] Snapshot load failed:', err.message);
    }
  }

  /**
   * Visible degraded mode: poll events over HTTP while realtime is down.
   * Never claims payment/stock/payroll/EOD success offline — read-only polling only.
   */
  startPollingFallback() {
    if (this.pollingTimer) return;
    this.setState('DEGRADED');
    this.pollingTimer = setInterval(() => {
      if (navigator.onLine && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.httpReplay(this.lastSequence);
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.stopPollingFallback();
      }
    }, 10000);
  }

  stopPollingFallback() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  markStale() {
    if (this.state === 'CONNECTED' || this.state === 'DEGRADED') {
      this.setState('STALE');
    }
  }

  markFresh() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.markStale(), 60000);
  }

  startHeartbeat() {
    this.cleanupHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
        this.pongTimeout = setTimeout(() => {
          console.warn('[RealtimeClient] Heartbeat timeout - connection degraded');
          this.setState('DEGRADED');
        }, 8000);
      }
    }, 15000);
  }

  cleanupHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.pongTimeout) clearTimeout(this.pongTimeout);
  }

  scheduleReconnect() {
    this.cleanupHeartbeat();
    if (!navigator.onLine) {
      this.setState('OFFLINE');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter
    const backoff = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * Math.pow(1.5, this.reconnectAttempts)
    ) + Math.random() * 500;

    console.log(`[RealtimeClient] Reconnecting in ${(backoff / 1000).toFixed(1)}s (Attempt #${this.reconnectAttempts})...`);
    setTimeout(() => {
      if (navigator.onLine) {
        this.connect();
      }
    }, backoff);
  }

  handleNetworkOnline() {
    console.log('[RealtimeClient] Network is back ONLINE');
    this.reconnectAttempts = 0;
    this.connect();
    if (window.syncPendingOfflineCommands) {
      window.syncPendingOfflineCommands();
    }
  }

  handleNetworkOffline() {
    console.warn('[RealtimeClient] Network is OFFLINE');
    this.setState('OFFLINE');
    if (this.ws) {
      try { this.ws.close(); } catch (e) { }
    }
  }

  getLastCursorInfo() {
    return {
      state: this.state,
      last_sequence: this.lastSequence,
      last_event_id: this.lastEventId,
      last_event_time: this.lastEventTime
    };
  }

  updateHealthBadge(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const badges = {
      'CONNECTED': { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', dot: 'bg-emerald-500', text: '🟢 متصل لحظياً' },
      'SYNCING': { bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400', dot: 'bg-blue-500 animate-pulse', text: '🔄 جاري المزامنة...' },
      'DEGRADED': { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400', dot: 'bg-amber-500 animate-ping', text: '⚠️ اتصال ضعيف' },
      'RECONNECTING': { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400', dot: 'bg-amber-500 animate-pulse', text: '⏳ إعادة الاتصال...' },
      'OFFLINE': { bg: 'bg-red-500/10 border-red-500/30 text-red-400', dot: 'bg-red-500', text: '🔴 غير متصل (أوفلاين)' },
      'STALE': { bg: 'bg-purple-500/10 border-purple-500/30 text-purple-400', dot: 'bg-purple-500', text: '⏱️ البيانات متأخرة' }
    };

    const cfg = badges[this.state] || badges['OFFLINE'];
    const cursorInfo = this.lastSequence > 0 ? ` · آخر حدث #${this.lastSequence}` : '';
    el.className = `flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${cfg.bg}`;
    el.innerHTML = `<span class="w-2 h-2 rounded-full ${cfg.dot}"></span><span>${cfg.text}${cursorInfo}</span>`;
    el.title = `State: ${this.state} | Cursor: ${this.lastSequence} | Last event: ${this.lastEventTime || 'none'}`;
  }
}

if (typeof window !== 'undefined') {
  window.RealtimeClient = RealtimeClient;
}
