# Offline-First Synchronization & Conflict Resolution Protocol

## 1. Architectural Strategy: Local-First with Server Authority

The Mazaj Cafe system runs inside the local venue network (LAN / Wi-Fi). In real-world cafe environments, mobile devices used by waitstaff frequently experience temporary Wi-Fi dead zones. 

To maintain uninterrupted floor operations:
1. **Client Queuing**: All state-mutating actions (creating orders, advancing prep status, requesting check) are written immediately to a client-side IndexedDB database (`MazajOfflineDB_v2`).
2. **Server Authority**: The server remains the single source of truth for canonical catalog pricing, sequential order IDs, and stock ledger summation.
3. **Deterministic Idempotency**: Every command carries a client-generated UUIDv4 idempotency key to prevent accidental duplicate submission upon reconnection.

---

## 2. IndexedDB Schema & Command Format (`public/modules/db.js`)

Database: `MazajOfflineDB_v2`  
Object Store: `offline_commands` (Key: `id`, Auto-increment)

### Command Object Payload:
```json
{
  "id": 1042,
  "idempotency_key": "c8b45942-0f06-4b21-8289-42b7e68bc6a9",
  "endpoint": "/api/orders",
  "method": "POST",
  "payload": {
    "table_number": "T-12",
    "items": [
      { "item_name": "شاي كرك", "price": 35.0, "quantity": 2 }
    ]
  },
  "created_at": 1724285900000,
  "synced": false,
  "retry_count": 0
}
```

---

## 3. Reconnect & Auto-Synchronization Protocol (`public/modules/sync.js`)

1. **Trigger Hooks**:
   - `window.addEventListener('online', triggerSync)`
   - Background timer loop running every 10 seconds.
2. **Batch Transmission**:
   - Client retrieves all unsynced commands from IndexedDB.
   - Posts array payload to `POST /api/sync/batch`.
3. **Server-Side Idempotency Processing (`src/domain/sync/service.js`)**:
   - For each command in the batch, the server checks the `idempotency_keys` table.
   - **If already processed**: Returns the cached response payload immediately without re-executing business logic or double-deducting inventory.
   - **If new**: Executes within a serialized transaction, saves the result to `idempotency_keys`, and returns success.
4. **Client Queue Cleanup**:
   - Upon receiving `200 OK` batch response, client marks processed records as completed and deletes them from IndexedDB.
