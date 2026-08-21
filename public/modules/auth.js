/**
 * Client-Side Auth & Session Helper
 */
let currentUser = null;

async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      return currentUser;
    }
  } catch (e) {}
  currentUser = null;
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
  localStorage.setItem('mazaj_user', JSON.stringify(data.user));
  return data;
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {}
  currentUser = null;
  localStorage.removeItem('mazaj_user');
  window.location.href = '/index.html';
}

function getCurrentUser() {
  if (currentUser) return currentUser;
  try {
    const cached = localStorage.getItem('mazaj_user');
    if (cached) currentUser = JSON.parse(cached);
  } catch (e) {}
  return currentUser;
}

if (typeof window !== 'undefined') {
  window.AuthModule = {
    checkAuthSession,
    loginWithPin,
    logout,
    getCurrentUser
  };
}
