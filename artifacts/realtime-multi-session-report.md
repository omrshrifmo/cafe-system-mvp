# Realtime Multi-Session & Station Operations Report

**Environment**: Isolated DEMO Mode  
**WebSocket Server**: `ws://localhost:3000`  
**Test Suite**: `test/security/station_realtime_offline.test.js` (11/11 PASS)

---

## 1. Station Operations Matrix

- **Barista Station**: Receives Spanish Latte, Americano, Tea with preparation timers and recipe instructions.
- **Kitchen Station**: Receives Burgers, Pastries with allergen notes.
- **Shisha Station**: Receives Shisha flavors and coal refresh alerts.
- **Runner Station**: Receives ready order alerts with target table coordinates and duplicate claim protection.

## 2. Realtime Event Broadcasting

- `ORDER_CREATED`: Broadcast to POS, Waiter, and KDS stations.
- `ITEM_STATUS_CHANGED`: Updates line status (`PENDING` -> `PREPARING` -> `READY` -> `DELIVERED`).
- `ORDER_CLOSED`: Automatically triggers table vacation and drawer reconciliation update.
