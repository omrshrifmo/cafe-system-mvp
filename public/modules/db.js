/**
 * Client-Side IndexedDB Offline Store & Audit Queue
 */
const DB_NAME = 'CafeSystemOfflineDB';
const DB_VERSION = 2;

class OfflineDB {
  static async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('offline_commands')) {
          const store = db.createObjectStore('offline_commands', { keyPath: 'client_command_id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('idempotency_key', 'idempotency_key', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('local_snapshots')) {
          db.createObjectStore('local_snapshots', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static getDeviceId() {
    if (typeof localStorage === 'undefined') return 'DEV-UNKNOWN';
    let id = localStorage.getItem('cafe_device_id');
    if (!id) {
      id = 'DEV-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem('cafe_device_id', id);
    }
    return id;
  }

  /**
   * Queues an action for offline execution.
   * STRICT POLICY: Financial payments (e.g. SETTLE_PAYMENT) are NEVER accepted for offline queuing.
   */
  static async queueCommand(action, payload = {}) {
    if (['SETTLE_PAYMENT', 'VOID_PAID', 'EOD_CLOSE', 'SETTLE_BILL'].includes(action)) {
      throw new Error('UNSAFE_OFFLINE_ACTION: لا يمكن تنفيذ عمليات الدفع أو التسوية المالية بدون اتصال مباشر بالخادم');
    }

    const db = await this.open();
    const commandId = 'CMD-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const idempotencyKey = 'IDEM-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const deviceId = this.getDeviceId();
    const nowIso = new Date().toISOString();

    const record = {
      client_command_id: commandId,
      device_id: deviceId,
      idempotency_key: idempotencyKey,
      request_hash: null,
      action,
      payload,
      status: 'QUEUED', // QUEUED, SYNCING, ACCEPTED, DUPLICATE, REJECTED, CONFLICT, UNKNOWN_REQUIRES_RECONCILIATION
      created_at: nowIso,
      attempted_at: null,
      attempts: 0,
      backoff: 1000,
      last_error: null,
      result: null,
      conflict: null
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('offline_commands', 'readwrite');
      const store = tx.objectStore('offline_commands');
      const req = store.add(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  static async getPendingCommands() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offline_commands', 'readonly');
      const store = tx.objectStore('offline_commands');
      const index = store.index('status');
      const req = index.getAll(IDBKeyRange.only('QUEUED'));
      
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  static async updateCommandStatus(commandId, updates = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offline_commands', 'readwrite');
      const store = tx.objectStore('offline_commands');
      const getReq = store.get(commandId);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return resolve(null);

        const updated = {
          ...item,
          ...updates,
          attempted_at: new Date().toISOString()
        };

        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  static async getAllCommands() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('offline_commands', 'readonly');
      const store = tx.objectStore('offline_commands');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // Compatibility aliases
  static async getPendingOfflineCommands() {
    return this.getPendingCommands();
  }

  static async markOfflineCommandCompleted(commandId, result = null) {
    return this.updateCommandStatus(commandId, { status: 'ACCEPTED', result });
  }
}

if (typeof window !== 'undefined') {
  window.OfflineDB = OfflineDB;
}
