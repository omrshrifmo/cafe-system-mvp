/**
 * Client-Side Auth & Session Helper (Secure)
 */
let currentUser = null;
let inactivityTimer = null;
const INACTIVITY_LIMIT_MS = 15000; // 15 seconds

async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      localStorage.setItem('mazaj_session_reference', JSON.stringify({
        id: currentUser.id,
        role: currentUser.role,
        venueId: currentUser.venueId
      }));
      resetInactivityTimer();
      return currentUser;
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
    body: JSON.stringify({ pin })
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'رمز الدخول غير صحيح');
  }

  currentUser = data.user;
  localStorage.setItem('mazaj_session_reference', JSON.stringify({
    id: currentUser.id,
    role: currentUser.role,
    venueId: currentUser.venueId
  }));
  
  resetInactivityTimer();
  return data;
}

async function verifyPinForUnlock(pin) {
  const res = await fetch('/api/auth/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pin })
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
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {}
  clearLocalState();
  window.location.href = '/index.html';
}

function clearLocalState() {
  currentUser = null;
  localStorage.removeItem('mazaj_user'); // Clean up old insecure legacy state
  localStorage.removeItem('mazaj_session_reference');
  clearTimeout(inactivityTimer);
}

function getCurrentUser() {
  if (currentUser) return currentUser;
  try {
    const cached = localStorage.getItem('mazaj_session_reference');
    if (cached) currentUser = JSON.parse(cached);
  } catch (e) {}
  return currentUser;
}

// Inactivity & Lock Screen Logic
function resetInactivityTimer() {
  if (window.location.pathname === '/index.html' || window.location.pathname === '/setup.html') return;
  
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(lockScreen, INACTIVITY_LIMIT_MS);
}

function lockScreen() {
  if (document.getElementById('mazaj-lock-overlay')) return;
  
  const overlay = document.createElement('div');
  overlay.id = 'mazaj-lock-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.9); z-index: 999999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: white; font-family: sans-serif;
  `;
  
  const name = currentUser ? currentUser.name || currentUser.role : 'مستخدم';
  
  overlay.innerHTML = `
    <h1 style="margin-bottom:20px; font-size:32px;">الشاشة مقفولة</h1>
    <p style="margin-bottom:30px; font-size:18px;">الرجاء إدخال الرمز السري للمتابعة (${name})</p>
    <input type="password" id="unlock-pin" placeholder="الرمز السري" style="padding:15px; font-size:24px; text-align:center; border-radius:8px; border:none; margin-bottom:20px;" autofocus>
    <div>
      <button id="unlock-btn" style="padding:12px 30px; font-size:20px; background:#4CAF50; color:white; border:none; border-radius:8px; cursor:pointer; margin-right:10px;">فتح</button>
      <button id="switch-user-btn" style="padding:12px 30px; font-size:20px; background:#f44336; color:white; border:none; border-radius:8px; cursor:pointer;">تبديل المستخدم</button>
    </div>
    <div id="unlock-error" style="color:#ff5252; margin-top:20px; font-size:18px;"></div>
  `;
  
  document.body.appendChild(overlay);
  
  const pinInput = document.getElementById('unlock-pin');
  pinInput.focus();
  
  document.getElementById('unlock-btn').addEventListener('click', async () => {
    try {
      document.getElementById('unlock-error').innerText = '';
      await verifyPinForUnlock(pinInput.value);
    } catch (err) {
      document.getElementById('unlock-error').innerText = err.message;
      pinInput.value = '';
      pinInput.focus();
    }
  });
  
  pinInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('unlock-btn').click();
  });
  
  document.getElementById('switch-user-btn').addEventListener('click', () => {
    logout();
  });
}

function unlockScreen() {
  const overlay = document.getElementById('mazaj-lock-overlay');
  if (overlay) {
    overlay.remove();
  }
}

// Global listeners for activity
if (typeof window !== 'undefined') {
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, true);
  });
}

// Global fetch interceptor to catch 401/403
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (response.status === 401 || response.status === 403) {
      // If we get an unauthorized error from an API, force a lock or logout
      if (window.location.pathname !== '/index.html' && window.location.pathname !== '/setup.html') {
         if (response.status === 401) {
           clearLocalState();
           window.location.href = '/index.html';
         } else if (response.status === 403) {
           alert('ليس لديك صلاحية لإجراء هذه العملية.');
         }
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
    lockScreen
  };
  
  // Initial timer start
  resetInactivityTimer();
}
