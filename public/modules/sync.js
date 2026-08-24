/**
 * Client-Side Offline Synchronizer Manager
 */
let isSyncing = false;

async function syncPendingOfflineCommands() {
  if (!navigator.onLine || isSyncing || !window.OfflineDB) return;
  isSyncing = true;

  try {
    const pending = await window.OfflineDB.getPendingCommands();
    if (pending.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`Syncing ${pending.length} offline command(s) with server...`);

    // Mark as SYNCING locally
    for (const p of pending) {
      await window.OfflineDB.updateCommandStatus(p.client_command_id, {
        status: 'SYNCING',
        attempts: (p.attempts || 0) + 1
      });
    }

    const commandsPayload = pending.map(p => ({
      client_command_id: p.client_command_id,
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
          await window.OfflineDB.updateCommandStatus(res.client_command_id, {
            status: res.status, // ACCEPTED, DUPLICATE, REJECTED, CONFLICT
            result: res.result || null,
            last_error: res.error || null
          });
        }
      }
      console.log('✅ Offline synchronization complete.');
      window.dispatchEvent(new CustomEvent('offline-sync-completed', { detail: data }));
    } else {
      // Server returned error: revert to QUEUED with backoff
      for (const p of pending) {
        await window.OfflineDB.updateCommandStatus(p.client_command_id, {
          status: 'QUEUED',
          last_error: `HTTP Error: ${response.status}`
        });
      }
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
