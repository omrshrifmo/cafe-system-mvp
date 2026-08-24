/**
 * Authenticated Realtime WebSocket Server & Outbox Dispatcher
 */
const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { validateSession } = require('../domain/auth/service');
const { allQuery, runQuery, getQuery } = require('../db/connection');
const logger = require('../observability/logger');

let wss = null;
let outboxTimer = null;

function setupWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let token = url.searchParams.get('token');
      
      if (!token && req.headers.cookie) {
        const match = req.headers.cookie.match(/session_token=([^;]+)/);
        if (match) token = match[1];
      }
      
      const venueId = url.searchParams.get('venueId') || 'V_DEFAULT';
      const stationId = url.searchParams.get('stationId') || 'HALL';
      const cursor = parseInt(url.searchParams.get('cursor'), 10) || 0;
      
      let user = null;
      if (token) {
        user = await validateSession(token);
      }

      if (!user) {
        ws.close(4001, 'AUTH_REQUIRED: Invalid or expired session');
        return;
      }

      ws.user = user;
      ws.venueId = venueId;
      ws.stationId = stationId;
      ws.isAlive = true;
      ws.lastAckedSeq = cursor;

      // Send initial connection handshake with server state
      ws.send(JSON.stringify({
        type: 'CONNECTED_HANDSHAKE',
        user_id: user.id,
        role: user.role,
        venue_id: venueId,
        station_id: stationId,
        initial_cursor: cursor,
        server_time: new Date().toISOString()
      }));

      // Immediately replay events from client cursor if cursor specified
      if (cursor > 0) {
        await replayEventsForClient(ws, cursor);
      }

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', server_time: new Date().toISOString() }));
          } else if (data.type === 'ACK') {
            if (data.sequence && data.sequence > (ws.lastAckedSeq || 0)) {
              ws.lastAckedSeq = data.sequence;
            }
          } else if (data.type === 'REQUEST_REPLAY') {
            const fromSeq = parseInt(data.from_sequence, 10) || 0;
            await replayEventsForClient(ws, fromSeq);
          }
        } catch (e) {
          logger.warn('Error handling WS message', { error: e.message });
        }
      });

      logger.info('WebSocket client connected', { userId: user.id, role: user.role, stationId, venueId });
    } catch (err) {
      logger.error('WebSocket connection setup error', { error: err.message });
      ws.close(4000, 'INTERNAL_ERROR');
    }
  });

  // Outbox dispatch loop
  if (outboxTimer) clearInterval(outboxTimer);
  outboxTimer = setInterval(async () => {
    await dispatchPendingOutboxEvents();
  }, 500);

  return wss;
}

async function dispatchPendingOutboxEvents() {
  if (!wss || wss.clients.size === 0) return;

  try {
    const events = await allQuery(
      `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY sequence ASC LIMIT 50`
    );

    for (const evt of events) {
      let payload = {};
      try { payload = JSON.parse(evt.payload_json); } catch (e) {}

      const msgString = JSON.stringify({
        event_id: evt.id,
        topic: evt.topic,
        aggregate_type: evt.aggregate_type,
        aggregate_id: evt.aggregate_id,
        aggregate_version: evt.aggregate_version || 1,
        sequence: evt.sequence || 0,
        schema_version: evt.schema_version || 'v1',
        venue_id: evt.venue_id,
        station_id: evt.station_id,
        payload,
        timestamp: evt.created_at
      });

      // Broadcast to connected clients, scoping to venue and station
      wss.clients.forEach((client) => {
        if (client.readyState === 1 && (!evt.venue_id || client.venueId === evt.venue_id)) { 
          // Station filter: broadcast if target station matches, or if client is HALL, MANAGER, or ALL
          const targetStation = evt.station_id;
          if (!targetStation || client.stationId === targetStation || client.stationId === 'HALL' || client.stationId === 'MANAGER' || client.stationId === 'ALL') {
            client.send(msgString);
          }
        }
      });

      await runQuery(
        `UPDATE outbox_events SET status = 'PUBLISHED', published_at = datetime('now', 'localtime') WHERE id = ?`,
        [evt.id]
      );
    }
  } catch (e) {
    // Suppress loop error
  }
}

async function replayEventsForClient(ws, cursor) {
  try {
    const events = await allQuery(
      `SELECT * FROM outbox_events 
       WHERE venue_id = ? AND sequence > ? 
       ORDER BY sequence ASC LIMIT 500`,
      [ws.venueId, cursor]
    );

    for (const evt of events) {
      const targetStation = evt.station_id;
      if (targetStation && ws.stationId !== targetStation && ws.stationId !== 'HALL' && ws.stationId !== 'MANAGER' && ws.stationId !== 'ALL') {
        continue;
      }

      let payload = {};
      try { payload = JSON.parse(evt.payload_json); } catch (e) {}

      const msgString = JSON.stringify({
        event_id: evt.id,
        topic: evt.topic,
        aggregate_type: evt.aggregate_type,
        aggregate_id: evt.aggregate_id,
        aggregate_version: evt.aggregate_version || 1,
        sequence: evt.sequence || 0,
        schema_version: evt.schema_version || 'v1',
        venue_id: evt.venue_id,
        station_id: evt.station_id,
        payload,
        is_replay: true,
        timestamp: evt.created_at
      });

      if (ws.readyState === 1) {
        ws.send(msgString);
      }
    }
  } catch (e) {
    logger.error('Error replaying events for WS client', { error: e.message });
  }
}

function broadcastEvent(topic, data, venueId = 'V_DEFAULT', stationId = null) {
  if (!wss) return;
  const msg = JSON.stringify({
    topic,
    data,
    timestamp: new Date().toISOString()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.venueId === venueId) {
      if (!stationId || client.stationId === stationId || client.stationId === 'HALL' || client.stationId === 'MANAGER' || client.stationId === 'ALL') {
        client.send(msg);
      }
    }
  });
}

module.exports = {
  setupWebSocketServer,
  dispatchPendingOutboxEvents,
  broadcastEvent,
  getWss: () => wss
};
