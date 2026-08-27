/**
 * Client-Side Offline Synchronizer Manager
 * Synchronizes user-partitioned queued commands safely with server authority.
 */
let isSyncing = false;

async function syncPendingOfflineCommands() {
  if (!navigator.onLine || isSyncing || !window.OfflineDB) return;
  isSyncing = true;

  try {
    const currentUserId = typeof window !== 'undefined' && window.currentUser ? window.currentUser.id : null;
    const pending = await window.OfflineDB.getPendingCommands(currentUserId);
    if (pending.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[OfflineSync] Syncing ${pending.length} command(s) for user [${currentUserId || 'ANY'}]...`);

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
      payload: p.payload,
      device_id: p.device_id,
      seat_id: p.seat_id,
      shift_id: p.shift_id,
      business_date: p.business_date,
      created_at: p.created_at
    }));

    const response = await fetch('/api/sync/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ commands: commandsPayload })
    });

    if (response.ok) {
      const data = await response.json();
      let appliedCount = 0;
      let conflictCount = 0;
      let rejectedCount = 0;

      if (data.results) {
        for (const res of data.results) {
          await window.OfflineDB.updateCommandStatus(res.client_command_id, {
            status: res.status, // APPLIED, ACCEPTED, DUPLICATE, REJECTED, CONFLICT, UNKNOWN_REQUIRES_RECONCILIATION
            result: res.result || null,
            last_error: res.error || null,
            conflict_reason: res.status === 'CONFLICT' ? (res.error || 'تعارض في إصدار البيانات') : null
          });

          if (res.status === 'APPLIED' || res.status === 'ACCEPTED' || res.status === 'DUPLICATE') {
            appliedCount++;
          } else if (res.status === 'CONFLICT') {
            conflictCount++;
          } else if (res.status === 'REJECTED') {
            rejectedCount++;
          }
        }
      }

      console.log(`✅ [OfflineSync] Complete: ${appliedCount} applied, ${conflictCount} conflicts, ${rejectedCount} rejected.`);

      if (typeof window !== 'undefined' && window.UIState && window.UIState.showToast) {
        if (appliedCount > 0 && conflictCount === 0 && rejectedCount === 0) {
          window.UIState.showToast(`✅ تمت مزامنة ${appliedCount} طلب بنجاح مع الخادم`, 'success');
        } else if (conflictCount > 0) {
          window.UIState.showToast(`⚠️ تم رصد ${conflictCount} تعارض في البيانات المسجلة محلياً`, 'warning');
        } else if (rejectedCount > 0) {
          window.UIState.showToast(`❌ تم رفض ${rejectedCount} أمر بسبب قيود الصلاحيات أو السياسات`, 'error');
        }
      }

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
    console.warn('[OfflineSync] Sync attempt failed:', err.message);
  } finally {
    isSyncing = false;
  }
}

// Auto-sync when coming online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineSync] Network back online. Triggering synchronization...');
    syncPendingOfflineCommands();
  });

  // Background sync polling every 10 seconds
  setInterval(() => {
    if (navigator.onLine) syncPendingOfflineCommands();
  }, 10000);

  window.syncPendingOfflineCommands = syncPendingOfflineCommands;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { syncPendingOfflineCommands };
}
