/**
 * Client-Side IndexedDB Offline Command Queue
 */
const DB_NAME = 'CafeSystemOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'outbox_commands';

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('idempotency_key', 'idempotency_key', { unique: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueOfflineCommand(action, payload) {
  const db = await openIndexedDb();
  const idempotencyKey = 'CLI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = {
      action,
      payload,
      idempotency_key: idempotencyKey,
      status: 'PENDING',
      created_at: new Date().toISOString()
    };
    const req = store.add(item);
    req.onsuccess = () => resolve({ id: req.result, idempotency_key: idempotencyKey });
    req.onerror = () => reject(req.error);
  });
}

async function getPendingOfflineCommands() {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      resolve(items.filter(it => it.status === 'PENDING'));
    };
    req.onerror = () => reject(req.error);
  });
}

async function markOfflineCommandCompleted(id) {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

if (typeof window !== 'undefined') {
  window.OfflineDB = {
    queueOfflineCommand,
    getPendingOfflineCommands,
    markOfflineCommandCompleted
  };
}
