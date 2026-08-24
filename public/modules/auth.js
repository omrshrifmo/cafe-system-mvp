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
function resetInactivityTimer() {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html') || path.endsWith('/setup.html') || path.includes('qr-menu.html')) {
    return;
  }
  
  clearTimeout(inactivityTimer);
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
  
  lockPinValue = "";
  const overlay = document.createElement('div');
  overlay.id = 'mazaj-lock-overlay';
  overlay.dir = 'rtl';
  overlay.className = 'fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[999999] flex flex-col items-center justify-center p-4 text-slate-100 select-none';
  overlay.style.fontFamily = "'Tajawal', system-ui, sans-serif";
  
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
}

// Global activity listeners
if (typeof window !== 'undefined') {
  ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => {
      // Only reset inactivity timer if not already locked
      if (!document.getElementById('mazaj-lock-overlay')) {
        resetInactivityTimer();
      }
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

// Global fetch interceptor for 401
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (response.status === 401) {
      const path = window.location.pathname;
      if (path !== '/' && !path.endsWith('/index.html') && !path.endsWith('/setup.html') && !path.includes('qr-menu.html')) {
        clearLocalState();
        window.location.replace('/index.html?returnUrl=' + encodeURIComponent(path));
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
    resetInactivityTimer
  };
  
  resetInactivityTimer();
}

