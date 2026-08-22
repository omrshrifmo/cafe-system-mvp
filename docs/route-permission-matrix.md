# Cafe System MVP — Route Permission Matrix (Default Deny)

**Version:** 2.1  
**Enforcement Middleware:** `src/http/middleware/registry.js` & `src/domain/auth/permissions.js`

---

## 1. Authentication & System Identity Routes

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | `public` | PIN-based authentication with rate limiting |
| `GET` / `POST` | `/api/auth/logout` | `public` | Session revocation, cookie clearing, and cache invalidation |
| `GET` | `/api/auth/me` | `authenticated` | Session verification and current user profile |
| `POST` | `/api/auth/verify-pin` | `authenticated` | Manager PIN re-authentication for sensitive actions |
| `GET` | `/api/build-info` | `public` | Runtime provenance (commit SHA, build ID, schema, SW version) |
| `GET` | `/healthz` | `public` | Server liveness and readiness probe |

---

## 2. Catalog & Menu Routes

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/menu` & `/api/menu/*` | `public` | Canonical menu items, categories, variants, addons |
| `GET` | `/api/public/menu` | `public` | Public grouped menu for QR mobile ordering |
| `POST` | `/api/menu/*` | `menu:write` (OWNER, OP_MANAGER, ADMIN) | Create new menu item or category |
| `PUT` | `/api/menu/*` | `menu:write` (OWNER, OP_MANAGER, ADMIN) | Update menu item details, category, or price |
| `DELETE` | `/api/menu/*` | `menu:write` (OWNER, OP_MANAGER, ADMIN) | Retire or soft-delete menu item |

---

## 3. POS, Tables, Orders & Checkout Routes

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/orders` & `/api/orders/*` | `authenticated` | Fetch active/historical orders |
| `POST` | `/api/orders` | `orders:write` (CASHIER, WAITER, JOKER, OWNER) | Submit new order to kitchen/bar |
| `POST` | `/api/orders/:id/void` | `orders:void` / `OWNER` (if paid) | Void or cancel order items |
| `GET` | `/api/tables` | `authenticated` | List all tables and active status |
| `GET` | `/api/tables/:number/session` | `authenticated` | Get active table session items and financial quote |
| `POST` | `/api/tables` | `tables:write` | Create or update table definition/custom name |
| `POST` | `/api/tables/seat` | `tables:seat` | Seat guests and record table opening |
| `POST` | `/api/tables/move` | `tables:move` | Move open orders to another table |
| `POST` | `/api/tables/request-check` | `authenticated` | Request bill/check print |
| `POST` | `/api/tables/vacate` | `tables:vacate` | Vacate table and free seat |
| `POST` | `/api/quote` | `authenticated` | Authoritative server quote calculation |
| `POST` | `/api/checkout` | `authenticated` (CASHIER, OP_MANAGER, OWNER) | Multi-method settlement and payment receipt |

---

## 4. Shifts, EOD & Financial Reports

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/shifts/me` | `authenticated` | Current staff shift status and duration |
| `POST` | `/api/shifts/clock-in` | `authenticated` | Staff clock-in |
| `POST` | `/api/shifts/clock-out` | `authenticated` | Staff clock-out |
| `POST` | `/api/shifts/declare-cash-extended` | `authenticated` | Blind cash declaration by cashier |
| `GET` | `/api/reports/eod` | `reports:financial` (OWNER, OP_MANAGER) | Daily EOD revenue, cash balance, and variance |
| `GET` | `/api/reports/bi` | `reports:financial` (OWNER, OP_MANAGER) | BI sales analytics, hourly trends, and margins |
| `GET` | `/api/reports/bom-reconciliation` | `reports:inventory` (OWNER, OP_MANAGER) | BOM consumption vs theoretical stock |

---

## 5. Inventory & Purchasing Routes

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/inventory` & `/api/inventory/*` | `inventory:manage` | Current stock levels and valuations |
| `POST` | `/api/inventory/purchase` | `inventory:manage` | Record approved supplier purchase |
| `POST` | `/api/inventory/waste` | `inventory:manage` | Log inventory waste with reason |
| `POST` | `/api/inventory/transfer` | `inventory:manage` | Inter-department stock transfer |

---

## 6. HR, Staff & Configuration Routes

| Method | Path Pattern | Required Permission / Role | Description |
|---|---|---|---|
| `GET` | `/api/users` | `hr:manage` (OWNER, OP_MANAGER, ADMIN) | List employees, roles, hourly rates |
| `POST` | `/api/users` | `hr:manage` (OWNER, OP_MANAGER, ADMIN) | Create or update staff profile & hashed PIN |
| `GET` | `/api/config` | `hr:manage` | Venue tax rates, service charge, currency |
| `PUT` | `/api/config` | `hr:manage` (OWNER, ADMIN) | Update operational configuration |
| `POST` | `/api/sync` | `authenticated` | Process offline queued commands batch |
