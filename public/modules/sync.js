/**
 * Client-Side Offline Synchronizer Manager
 */
let isSyncing = false;

async function syncPendingOfflineCommands() {
  if (!navigator.onLine || isSyncing || !window.OfflineDB) return;
  isSyncing = true;

  try {
    const pending = await window.OfflineDB.getPendingOfflineCommands();
    if (pending.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`Syncing ${pending.length} offline command(s) with server...`);
    const commandsPayload = pending.map(p => ({
      client_command_id: p.id,
      idempotency_key: p.idempotency_key,
      action: p.action,
      payload: p.payload
    }));

    const response = await fetch('/api/sync/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ commands: commandsPayload })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results) {
        for (const res of data.results) {
          if (res.status === 'APPLIED' || res.status === 'DUPLICATE') {
            await window.OfflineDB.markOfflineCommandCompleted(res.client_command_id);
          }
        }
      }
      console.log('✅ Offline synchronization complete.');
    }
  } catch (err) {
    console.warn('Sync attempt failed:', err.message);
  } finally {
    isSyncing = false;
  }
}

// Auto-sync when coming online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('Network back online. Triggering synchronization...');
    syncPendingOfflineCommands();
  });

  // Background sync polling every 10 seconds
  setInterval(() => {
    if (navigator.onLine) syncPendingOfflineCommands();
  }, 10000);

  window.syncPendingOfflineCommands = syncPendingOfflineCommands;
}
