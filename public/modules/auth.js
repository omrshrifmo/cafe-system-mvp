/**
 * Client-Side Auth & Session Helper (Secure In-Memory Model)
 * Never stores credentials, tokens, or raw session IDs in localStorage.
 */
let currentUser = null;
let inactivityTimer = null;
const INACTIVITY_LIMIT_MS = 15000; // 15 seconds

async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        resetInactivityTimer();
        return currentUser;
      }
    }
  } catch (e) {}
  
  clearLocalState();
  return null;
}

async function loginWithPin(pin) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pin: String(pin).trim() })
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'رمز الدخول غير صحيح');
  }

  currentUser = data.user;
  if (data.token) {
    setTabToken(data.token);
  }
  resetInactivityTimer();
  return data;
}

async function verifyPinForUnlock(pin) {
  const res = await fetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pin: String(pin).trim() })
  });
  
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'الرمز السري غير صحيح');
  }
  
  unlockScreen();
  resetInactivityTimer();
  return data;
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include' 
    });
  } catch (e) {}
  
  if (window.MazajRealtime && typeof window.MazajRealtime.disconnect === 'function') {
    window.MazajRealtime.disconnect();
  }
  
  clearLocalState();
  sessionStorage.clear();
  window.location.replace('/index.html');
}

function clearLocalState() {
  currentUser = null;
  localStorage.removeItem('mazaj_user');
  localStorage.removeItem('user');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('mazaj_session_reference');
  clearTimeout(inactivityTimer);
}

function getCurrentUser() {
  return currentUser;
}

// Inactivity & Lock Screen Logic
let countdownTimer = null;
let secondsRemaining = 15;
let isCaffeineActive = false;
let caffeineExpiryTime = null;

function updateCountdownWarning() {
  const warningEl = document.getElementById('inactivity-warning-toast');
  if (secondsRemaining <= 5 && secondsRemaining > 0 && !isCaffeineActive && !document.getElementById('mazaj-lock-overlay')) {
    if (!warningEl) {
      const toast = document.createElement('div');
      toast.id = 'inactivity-warning-toast';
      toast.dir = 'rtl';
      toast.className = 'fixed bottom-4 left-4 z-[99999] bg-amber-500 text-slate-950 px-4 py-2 rounded-xl text-xs font-black shadow-2xl flex items-center gap-2 animate-bounce border border-amber-400';
      toast.innerHTML = `<span>⏳</span><span>سيتم قفل الشاشة خلال <strong id="inactivity-sec-count">${secondsRemaining}</strong> ثانية</span>`;
      document.body.appendChild(toast);
    } else {
      const countEl = document.getElementById('inactivity-sec-count');
      if (countEl) countEl.textContent = secondsRemaining;
    }
  } else if (warningEl) {
    warningEl.remove();
  }
}

function resetInactivityTimer(e) {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html') || path.endsWith('/setup.html') || path.includes('qr-menu.html')) {
    return;
  }

  // Filter meaningful events: must be trusted user interaction and tab visible
  if (e) {
    if (e.isTrusted === false) return; // Ignore synthetic events
    if (document.hidden) return; // Ignore hidden tab activity
  }

  if (document.getElementById('mazaj-lock-overlay')) return;

  clearTimeout(inactivityTimer);
  clearInterval(countdownTimer);
  secondsRemaining = Math.round(INACTIVITY_LIMIT_MS / 1000);
  updateCountdownWarning();

  if (isCaffeineActive) {
    // Check if caffeine mode expired
    if (caffeineExpiryTime && Date.now() >= caffeineExpiryTime) {
      isCaffeineActive = false;
      caffeineExpiryTime = null;
    } else {
      return; // Caffeine mode prevents lock
    }
  }

  countdownTimer = setInterval(() => {
    secondsRemaining--;
    updateCountdownWarning();
    if (secondsRemaining <= 0) {
      clearInterval(countdownTimer);
      lockScreen();
    }
  }, 1000);

  inactivityTimer = setTimeout(lockScreen, INACTIVITY_LIMIT_MS);
}

let lockPinValue = "";

function updateLockDisplay() {
  const dotsEl = document.getElementById('lock-pin-dots');
  if (!dotsEl) return;
  if (lockPinValue.length === 0) {
    dotsEl.className = "text-slate-500 text-sm";
    dotsEl.textContent = "أدخل رمز PIN لإلغاء القفل";
  } else {
    dotsEl.className = "text-amber-400 tracking-widest text-3xl font-mono";
    dotsEl.textContent = "•".repeat(lockPinValue.length);
  }
}

function lockScreen() {
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html') || path.endsWith('/setup.html') || path.includes('qr-menu.html')) {
    return;
  }
  if (document.getElementById('mazaj-lock-overlay')) return;

  const warningEl = document.getElementById('inactivity-warning-toast');
  if (warningEl) warningEl.remove();
  
  lockPinValue = "";
  const overlay = document.createElement('div');
  overlay.id = 'mazaj-lock-overlay';
  overlay.dir = 'rtl';
  overlay.className = 'fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[9999999] flex flex-col items-center justify-center p-4 text-slate-100 select-none';
  overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 9999999 !important; background: rgba(11, 17, 32, 0.96) !important; backdrop-filter: blur(12px) !important; display: flex !important; align-items: center !important; justify-content: center !important;';
  
  const userName = currentUser ? (currentUser.name || currentUser.role) : 'المستخدم';
  const userRole = currentUser ? currentUser.role : 'كافيه مزاج';
  
  overlay.innerHTML = `
    <div class="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center">
      <div class="w-16 h-16 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 animate-pulse">
        🔒
      </div>
      <h2 class="text-xl font-bold text-slate-100 mb-1">شاشة النظام مقفولة</h2>
      <p class="text-xs text-slate-400 mb-1">${userName}</p>
      <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 mb-5">${userRole}</span>

      <div class="mb-5">
        <div id="lock-pin-dots" class="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-center text-3xl tracking-widest font-mono text-amber-400 min-h-[58px] flex items-center justify-center">
          <span class="text-slate-500 text-sm">أدخل رمز PIN لإلغاء القفل</span>
        </div>
        <div id="lock-error-msg" class="hidden mt-2 p-2 bg-red-950/80 border border-red-800 text-red-300 text-xs text-center rounded-lg font-semibold"></div>
      </div>

      <!-- Keypad -->
      <div class="grid grid-cols-3 gap-2.5 mb-5">
        <button onclick="window.AuthModule.pressLockKey('1')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">1</button>
        <button onclick="window.AuthModule.pressLockKey('2')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">2</button>
        <button onclick="window.AuthModule.pressLockKey('3')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">3</button>
        <button onclick="window.AuthModule.pressLockKey('4')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">4</button>
        <button onclick="window.AuthModule.pressLockKey('5')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">5</button>
        <button onclick="window.AuthModule.pressLockKey('6')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">6</button>
        <button onclick="window.AuthModule.pressLockKey('7')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">7</button>
        <button onclick="window.AuthModule.pressLockKey('8')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">8</button>
        <button onclick="window.AuthModule.pressLockKey('9')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">9</button>
        <button onclick="window.AuthModule.clearLockKey()" class="bg-rose-950/60 hover:bg-rose-900 active:bg-rose-800 text-rose-300 text-sm font-bold py-3.5 rounded-xl border border-rose-800/60 transition">مسح ✕</button>
        <button onclick="window.AuthModule.pressLockKey('0')" class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-2xl font-bold py-3.5 rounded-xl border border-slate-700 transition">0</button>
        <button onclick="window.AuthModule.submitUnlock()" class="bg-amber-600 hover:bg-amber-500 active:bg-amber-400 text-slate-950 text-xl font-bold py-3.5 rounded-xl border border-amber-500 transition flex items-center justify-center">فتح ↵</button>
      </div>

      <div class="border-t border-slate-800 pt-4 flex items-center justify-between">
        <button onclick="window.AuthModule.logout()" class="text-xs text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1">
          <span>🚪</span>
          <span>تسجيل خروج بالكامل</span>
        </button>
        <span class="text-[10px] text-slate-500">حماية الجلسة نشطة (15 ثانية)</span>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
}

function pressLockKey(key) {
  const errEl = document.getElementById('lock-error-msg');
  if (errEl) errEl.classList.add('hidden');
  if (lockPinValue.length < 6) {
    lockPinValue += key;
    updateLockDisplay();
  }
}

function clearLockKey() {
  lockPinValue = "";
  updateLockDisplay();
}

async function submitUnlock() {
  if (!lockPinValue || lockPinValue.length < 4) {
    const errEl = document.getElementById('lock-error-msg');
    if (errEl) {
      errEl.textContent = 'رمز PIN يجب ألا يقل عن 4 أرقام';
      errEl.classList.remove('hidden');
    }
    return;
  }

  try {
    await verifyPinForUnlock(lockPinValue);
    unlockScreen();
  } catch (err) {
    const errEl = document.getElementById('lock-error-msg');
    if (errEl) {
      errEl.textContent = err.message || 'الرمز السري غير صحيح';
      errEl.classList.remove('hidden');
    }
    lockPinValue = "";
    updateLockDisplay();
  }
}

function unlockScreen() {
  const overlay = document.getElementById('mazaj-lock-overlay');
  if (overlay) {
    overlay.remove();
  }
  lockPinValue = "";
  resetInactivityTimer();
}

// Global meaningful activity listeners (EXCLUDING mousemove alone)
if (typeof window !== 'undefined') {
  ['click', 'touchstart', 'keydown', 'input', 'change', 'scroll'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      resetInactivityTimer(e);
    }, true);
  });

  // Handle keyboard on lock screen
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('mazaj-lock-overlay')) return;
    if (e.key >= '0' && e.key <= '9') {
      pressLockKey(e.key);
    } else if (e.key === 'Backspace') {
      lockPinValue = lockPinValue.slice(0, -1);
      updateLockDisplay();
    } else if (e.key === 'Enter') {
      submitUnlock();
    } else if (e.key === 'Escape') {
      clearLockKey();
    }
  });
}

// Caffeine Mode API client
async function enableCaffeineMode(durationMinutes = 30, reason = 'OPERATIONAL_KEEP_ALIVE', managerPin = null) {
  const res = await fetch('/api/auth/caffeine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_minutes: durationMinutes, reason, manager_pin: managerPin })
  });
  const data = await res.json();
  if (data.success) {
    isCaffeineActive = true;
    caffeineExpiryTime = new Date(data.expires_at).getTime();
    resetInactivityTimer();
  }
  return data;
}

async function disableCaffeineMode() {
  const res = await fetch('/api/auth/caffeine', { method: 'DELETE' });
  const data = await res.json();
  if (data.success) {
    isCaffeineActive = false;
    caffeineExpiryTime = null;
    resetInactivityTimer();
  }
  return data;
}

async function fetchCaffeineStatus() {
  try {
    const res = await fetch('/api/auth/caffeine');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.enabled) {
        isCaffeineActive = true;
        caffeineExpiryTime = new Date(data.expires_at).getTime();
      } else {
        isCaffeineActive = false;
        caffeineExpiryTime = null;
      }
      return data;
    }
  } catch (e) {}
  return { enabled: false };
}

// Activity Restore Checkpoint API client
async function saveCheckpoint(route, draftType, draftPayload) {
  try {
    await fetch('/api/auth/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route, draft_type: draftType, draft_payload: draftPayload })
    });
  } catch (e) {}
}

async function checkAndPromptRestore() {
  try {
    const res = await fetch('/api/auth/checkpoint');
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data || !json.data.allowed || !json.data.checkpoint) return;

    const cp = json.data.checkpoint;
    if (document.getElementById('restore-activity-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'restore-activity-toast';
    toast.dir = 'rtl';
    toast.className = 'fixed bottom-4 right-4 z-[99999] bg-slate-900 border border-amber-500/50 rounded-2xl p-4 shadow-2xl max-w-sm text-slate-100 animate-slide-up';
    toast.style.fontFamily = "'Tajawal', system-ui, sans-serif";
    toast.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl flex items-center justify-center text-xl shrink-0">
          ↩️
        </div>
        <div class="flex-1">
          <h4 class="text-xs font-black text-amber-300 mb-1">استئناف العمل السابق</h4>
          <p class="text-[11px] text-slate-400 mb-3">
            توجد مسودة غير مكتملة محفوظة من جلستك السابقة (${cp.draft_type}). هل ترغب في استكمالها؟
          </p>
          <div class="flex items-center gap-2">
            <button id="btn-confirm-restore" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-lg transition-colors cursor-pointer shadow">
              استئناف ↵
            </button>
            <button id="btn-discard-restore" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-lg transition-colors cursor-pointer border border-slate-700">
              تجاهل ✕
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    document.getElementById('btn-confirm-restore').onclick = () => {
      toast.remove();
      if (cp.route && window.location.pathname !== cp.route) {
        window.location.href = cp.route;
      } else if (window.onActivityRestored) {
        window.onActivityRestored(cp);
      }
    };

    document.getElementById('btn-discard-restore').onclick = async () => {
      toast.remove();
      try {
        await fetch('/api/auth/checkpoint', { method: 'DELETE' });
      } catch (e) {}
    };
  } catch (e) {}
}

// Per-Tab Context & Ephemeral Session Tokens
function getContextId() {
  if (typeof sessionStorage === 'undefined') return 'CTX-GLOBAL';
  let ctx = sessionStorage.getItem('mazaj_context_id');
  if (!ctx) {
    ctx = 'CTX-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
    sessionStorage.setItem('mazaj_context_id', ctx);
  }
  return ctx;
}

function getTabToken() {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem('mazaj_tab_token') || null;
}

function setTabToken(token) {
  if (typeof sessionStorage === 'undefined') return;
  if (token) sessionStorage.setItem('mazaj_tab_token', token);
  else sessionStorage.removeItem('mazaj_tab_token');
}

// Show Stale Context in-page Arabic modal
function showStaleContextModal(message) {
  if (document.getElementById('stale-context-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'stale-context-modal';
  overlay.dir = 'rtl';
  overlay.className = 'fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[9999999] flex flex-col items-center justify-center p-4 text-slate-100 select-none';
  overlay.style.fontFamily = "'Tajawal', system-ui, sans-serif";
  overlay.innerHTML = `
    <div class="w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl p-6 shadow-2xl text-center">
      <div class="w-16 h-16 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 animate-bounce">
        ⚠️
      </div>
      <h2 class="text-lg font-black text-amber-300 mb-2">تنبيه أمان: تم تغيير الجلسة من نافذة أخرى</h2>
      <p class="text-xs text-slate-300 leading-relaxed mb-6">
        ${message || 'تم تسجيل الخروج أو تغيير المستخدم النشط من نافذة متصفح أخرى على هذا الجهاز. لحماية العمليات المالية وحسابات الضيوف، تم إيقاف هذا السياق بأمان.'}
      </p>
      <button onclick="window.AuthModule.logout()" class="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition-all shadow-lg cursor-pointer">
        تسجيل الدخول بحسابك من جديد 🔐
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Listen for cross-tab session invalidation
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'mazaj_session_revoked_at' || (event.key === 'currentUser' && !event.newValue)) {
      showStaleContextModal();
    }
  });
}

// Global fetch interceptor for 401, per-tab token injection, and activity restore
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.fetch = async function(resource, init = {}) {
    init = init || {};
    init.headers = init.headers || {};

    const tabToken = getTabToken();
    const contextId = getContextId();

    if (init.headers instanceof Headers) {
      if (tabToken && !init.headers.has('x-session-token')) init.headers.set('x-session-token', tabToken);
      if (!init.headers.has('x-context-id')) init.headers.set('x-context-id', contextId);
    } else if (Array.isArray(init.headers)) {
      if (tabToken) init.headers.push(['x-session-token', tabToken]);
      init.headers.push(['x-context-id', contextId]);
    } else {
      if (tabToken && !init.headers['x-session-token']) init.headers['x-session-token'] = tabToken;
      if (!init.headers['x-context-id']) init.headers['x-context-id'] = contextId;
    }

    const response = await originalFetch.call(this, resource, init);
    if (response.status === 401) {
      const path = window.location.pathname;
      if (path !== '/' && !path.endsWith('/index.html') && !path.endsWith('/setup.html') && !path.includes('qr-menu.html')) {
        clearLocalState();
        showStaleContextModal('انتهت صلاحية الجلسة أو تم تسجيل الخروج. يرجى تسجيل الدخول مجدداً.');
      }
    }
    return response;
  };
}

if (typeof window !== 'undefined') {
  window.AuthModule = {
    checkAuthSession,
    loginWithPin,
    verifyPinForUnlock,
    logout,
    getCurrentUser,
    lockScreen,
    unlockScreen,
    pressLockKey,
    clearLockKey,
    submitUnlock,
    resetInactivityTimer,
    getContextId,
    getTabToken,
    setTabToken,
    showStaleContextModal,
    enableCaffeineMode,
    disableCaffeineMode,
    fetchCaffeineStatus,
    saveCheckpoint,
    checkAndPromptRestore
  };
  
  resetInactivityTimer();
  setTimeout(checkAndPromptRestore, 800);
}

