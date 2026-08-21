# System Architecture & Topology: Mazaj Cafe Operations Platform

## 1. Executive Architectural Summary
Mazaj Cafe Operations Platform is a high-availability, local-first, server-authoritative ERP and Point of Sale system specifically engineered for cafe operations in the MENA region. The architecture prioritizes zero-latency local Wi-Fi reliability, strict financial privacy (Financial Blindness), append-only inventory ledgers, and tamper-resistant audit trails.

```
+-----------------------------------------------------------------------------------+
|                                 Local Network (Wi-Fi)                             |
|                                                                                   |
|  +--------------------+   +--------------------+   +---------------------------+  |
|  |  Cashier / POS UI  |   |  Waiter Mobile UI  |   |  KDS Screens (Bar/Kitchen)|  |
|  |  (Vanilla JS / IDB)|   |  (PWA Mobile Web)  |   |  (WebSocket Subscriptions)|  |
|  +---------+----------+   +---------+----------+   +-------------+-------------+  |
|            |                        |                            |                |
|            +-------------------+    |    +-----------------------+                |
|                                |    |    |                                        |
|                                v    v    v                                        |
|                     +---------------------------------+                           |
|                     |    Express API & Static Server  |                           |
|                     |    - Request ID & Logging       |                           |
|                     |    - Rate Limiter & Auth Guard  |                           |
|                     |    - Session Token Validator    |                           |
|                     +----------------+----------------+                           |
|                                      |                                            |
|                  +-------------------+-------------------+                        |
|                  v                                       v                        |
|   +------------------------------+       +-------------------------------+        |
|   |    Domain Logic Layer        |       |    WebSocket Hub & Outbox     |        |
|   |    - Catalog & Pricing Minor |       |    - Authenticated Topics     |        |
|   |    - Server Quotes & Taxes   |       |    - KDS State Broadcasting   |        |
|   |    - Atomic BOM Ledger       |       +---------------+---------------+        |
|   |    - Blind Shift Calculator  |                       |                        |
|   +--------------+---------------+                       v                        |
|                  |                       +-------------------------------+        |
|                  v                       |    Durable Print Worker       |        |
|   +------------------------------+       |    - ESC/POS TCP 9100         |        |
|   | SQLite3 Database (WAL Mode)  |       |    - Exponential Backoff      |        |
|   | - Mutex-Chained Transactions |       +---------------+---------------+        |
|   | - Versioned Migrations (001-4)                       |                        |
|   +------------------------------+                       v                        |
|                                          +-------------------------------+        |
|                                          | Thermal Printers (Kitchen/Bar)|        |
|                                          +-------------------------------+        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Layered Component Architecture

### 2.1 Storage Layer (`src/db/`)
- **Engine**: SQLite 3 in Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and synchronous normal mode (`PRAGMA synchronous = NORMAL;`).
- **Transaction Coordinator (`src/db/transaction.js`)**: Implements an in-memory promise mutex queue (`txQueue = txQueue.then(...)`) ensuring strictly serialized, non-interleaved, deadlock-free transactional execution.
- **Migration Engine (`src/db/migrator.js`)**: Versioned SQL migrations (`001_core_schema.sql` through `004_outbox_and_idempotency.sql`) with MD5 checksum validation, historical tracking in `schema_migrations`, and schema column harmonizers for zero-downtime upgrades.

### 2.2 Domain Business Services (`src/domain/`)
- **Auth (`src/domain/auth/`)**: Salted bcrypt PIN verification (work factor 10), cryptographically random 64-character session tokens hashed with SHA-256 and salt, role-based permission matrix.
- **Catalog (`src/domain/catalog/`)**: Canonical category and menu item hierarchy, integer minor units pricing (`amount_minor`), recipe ingredient BOM mapping in micro-units (`1 unit = 1,000,000 micro-units`).
- **Orders (`src/domain/orders/`)**: Order lifecycle state machine, atomic single-transaction BOM deductions in `inventory_ledger`, 4-lane KDS progression (`PENDING -> ACCEPTED -> READY -> DELIVERED`), cancellation handshake protocol.
- **Payments (`src/domain/payments/`)**: Server-authoritative quote calculation (Subtotal + 12% Service Charge + 14% VAT - Discounts), multi-tender split settlement, immutable payment rows, append-only reversals (`payment_reversals`), Ultimate Void Rule enforcement.
- **Inventory (`src/domain/inventory/`)**: Double-entry style append-only event ledger (`inventory_ledger`), supplier purchase invoice receiving, paired material transfers, manual waste logs.
- **Tables (`src/domain/tables/`)**: Discrete lifecycle state machine (`AVAILABLE`, `SEATED`, `CHECK_REQUESTED`, `PAID`, `VACANT`), guest count tracking, table transfers.
- **Shifts (`src/domain/shifts/`)**: Clock-in/out tracking, individual employee performance summaries, blind cash declaration Z-reports.
- **Printing (`src/domain/printing/`)**: Native ESC/POS binary formatters generating receipt packets, kitchen order chits, drawer kick pulses (`0x1B 0x70`), and paper guillotine cuts (`0x1D 0x56`).

### 2.3 Realtime & Background Jobs
- **WebSocket Gateway (`src/realtime/websocket.js`)**: Real-time duplex pub/sub hub broadcasting state changes to KDS and POS stations with authenticated handshake.
- **Durable Print Worker (`src/jobs/print-worker.js`)**: Polls `print_jobs` table for `PENDING` tickets, connects to thermal printers over raw TCP sockets (port 9100), handles network failures with exponential retry backoff.

### 2.4 HTTP Transport & Middlewares (`src/http/`)
- **Request ID Middleware (`src/http/middleware/request-id.js`)**: Generates unique UUIDv4 per request, attached to request headers and structured logs.
- **Authentication Middleware (`src/http/middleware/auth.js`)**: Validates `session_token` from `HttpOnly` cookie or `Authorization: Bearer` header against active database sessions.
- **RBAC Middleware (`src/http/middleware/permissions.js`)**: Evaluates granular permissions against user role, returning structured `403 Forbidden` responses upon violation.
- **Rate Limiting (`src/http/middleware/rate-limit.js`)**: Protects authentication endpoints against brute-force attacks (5 attempts per minute per IP).
- **Error Boundary (`src/http/middleware/errors.js`)**: Catches all uncaught exceptions, logs sanitized stack traces, and outputs unified Arabic error envelopes.

---

## 3. Client Topology & Offline Resilience
- **Offline Command Queue (`public/modules/db.js`)**: Client-side IndexedDB database (`MazajOfflineDB_v2`) queues outgoing mutation commands when Wi-Fi is disconnected.
- **Client Auto-Sync (`public/modules/sync.js`)**: Listens to browser `online` events and periodic intervals (10s), replaying queued commands against `/api/sync/batch` with idempotency keys.
