/**
 * Client-Side Authoritative API Client with Offline Resilience
 */
async function fetchApi(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    },
    credentials: 'include' // Send session cookie
  };

  try {
    const response = await fetch(endpoint, config);

    // Handle 401 Unauthorized -> redirect to login if not already there
    if (response.status === 401 && !window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
      console.warn('Session expired or unauthorized, redirecting to login...');
      // Clear client cache if needed
      window.location.href = '/index.html';
      return null;
    }

    const data = await response.json();

    if (!response.ok && !data.success) {
      const errorMsg = data.error || `HTTP Error ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  } catch (err) {
    // If network error (offline) and this is a mutation, queue to IndexedDB if supported
    if (!navigator.onLine && options.method && options.method !== 'GET' && window.OfflineDB) {
      console.info('Offline detected: queueing request to local outbox');
      await window.OfflineDB.queueOfflineCommand('SYNC_FETCH', { endpoint, options });
      if (window.showToast) window.showToast('تم حفظ العملية محلياً وستتم مزامنتها تلقائياً عند عودة الاتصال', 'warning');
      return { success: true, queued_offline: true };
    }
    throw err;
  }
}

if (typeof window !== 'undefined') {
  window.fetchApi = fetchApi;
}
