# Current-State System Map & Baseline Analysis

## 1. Executive Summary & Overview
The current repository is an Arabic RTL Cafe ERP system designed for local network deployment in cafes and restaurants.
It provides POS (Point of Sale), Table Management, Kitchen Display System (KDS), Barista, Shisha station dispatch, Inventory & Recipe/BOM tracking, Supplier management, Purchasing, CRM & Loyalty points, Staff HR & Shift management, Financial reporting (EOD & BI), QA/Complaints, Reservations, and ESC/POS thermal printing.

While functional as an MVP, the codebase exhibits critical architectural limitations that prevent it from being safe for enterprise production:
- **Monolithic Architecture**: All backend routes reside in a single 2,095-line `server.js` and a 3,631-line `database.js`.
- **Insecure Authentication & Authorization**: Plaintext PIN codes stored in SQLite; client identity trusted via `localStorage` and client-supplied `x-user-role` headers or `user_id` request fields.
- **Dual/Overlapping Menu Models**: A legacy `recipes` table overlaps with `menu_categories` / `menu_items` tables.
- **Client-Determined Calculations**: Certain financial calculations, totals, and item details can be supplied by the browser.
- **Non-authoritative Offline State**: Service worker caches files, but no persistent IndexedDB offline command queue or server idempotency deduplication exists.
- **Ephemeral Print Bridge**: Direct socket connections during HTTP requests rather than a persistent, transactional Outbox print queue.
- **Missing Toolchain & Testing**: No standard test runner, no CI workflow, no database migration runner, and committed SQLite database binaries in git.

---

## 2. File & Directory Inventory

| File / Path | Size (Lines / Bytes) | Role & Responsibility | Deficiencies Identified |
| :--- | :--- | :--- | :--- |
| `server.js` | 2,095 lines / ~82 KB | Monolithic Express server, HTTP API endpoints, WebSocket server, mDNS advertisement, print socket handler. | Mixed concerns; lack of modular router structure; no request ID/structured logging; error handling returns raw error messages. |
| `database.js` | 3,631 lines / ~142 KB | Monolithic SQLite database connection, table initialization DDL, schema migrations, and repository queries. | Direct raw SQL; lack of isolated transactions; mixed business logic and data access; raw database instance exposed. |
| `public/*.html` (25 pages) | ~500 KB total | Frontend views for POS, Tables, KDS, Kitchen, Shisha, Inventory, HR, EOD, BI, CRM, Menu, Settings, Portal, etc. | Reliance on `localStorage.getItem('currentUser')`; inline calculation of taxes and prices; direct API fetch calls without unified client layer. |
| `public/nav.js` | 469 lines / ~20 KB | Universal navigation bar, RBAC role menu filtering, design tokens, Service Worker auto-registration. | Role check is client-side only (cosmetic); must be backed by strict server-side middleware. |
| `public/sw.js` | ~2.2 KB | Service worker for offline shell caching. | Caches assets but lacks IndexedDB offline command sync queue. |
| `public/manifest.json` | ~725 B | Web App Manifest for PWA standalone installation. | Functional, needs integration with offline app shell. |
| `cafe.db` (+ wal/shm) | ~278 KB | Committed SQLite database containing operational tables and seed data. | Committed to git; needs to be extracted as a clean migration fixture and excluded from VCS. |
| `test_suite.js` | 243 lines / ~13 KB | Standalone end-to-end integration script. | Ad-hoc runner without standardized Jest/Mocha runner or unit test coverage. |

---

## 3. Database Schema & Current Entity Map

The database `cafe.db` currently contains 28 tables:
1. `users`: `id, name, role, pin_code, hourly_rate` (Plaintext PINs, legacy roles).
2. `system_config`: `key, value, updated_at` (Cafe name, VAT %, Service %, Currency, Printer IP).
3. `menu_categories`: `id, name, icon, sort_order, is_active, created_at`.
4. `menu_items`: `id, category_id, name, description, price, is_available, sort_order, created_at`.
5. `item_variants` & `item_addons`: `id, menu_item_id, name, price, is_available`.
6. `recipes`: `id, item_name, category, price, tolerance_percent, ingredients, instructions, created_at` (Legacy flat recipe model).
7. `inventory`: `id, name, unit, min_limit, cost_per_unit, default_supplier_id, category, current_stock`.
8. `orders`: `id, item_name, quantity, table_number, status, created_at, waiter_id, sugar_level, roast_type, kds_status, edit_request`.
9. `order_sessions`: `id, table_number, status, opened_at, closed_at`.
10. `order_payments`: `id, order_id, method, amount, tip_amount, subtotal, service_amount, vat_amount, discount_amount, total_amount, currency, created_at`.
11. `tables` & `table_sessions`: `id, table_number, custom_name, customer_name, customer_phone, status, seated_at, guest_count`.
12. `customers`: `phone, name, points, total_spent, credit_balance, created_at`.
13. `shifts` & `drawer_declarations`: `id, user_id, user_name, clock_in, clock_out, shift_type, declared_amount, expected_amount, variance`.
14. `employee_advances` & `penalties`: Staff advances and deduction logs.
15. `daily_expenses`: `id, description, amount, payment_source, created_at`.
16. `material_transfers`: `id, source_dept, target_dept, item_name, quantity, unit, created_at`.
17. `purchases`: `id, supplier_id, item_name, quantity, unit_price, total_cost, invoice_number, created_at`.
18. `waste_log`: `id, inventory_id, quantity, reason, reported_by, created_at`.
19. `audit_logs`: `id, user_id, action, target_table, record_id, previous_value, new_value, created_at`.
20. `shareholder_ledger`: `id, partner_name, amount, type, description, created_at`.
21. `complaints` & `reservations` & `customer_feedback` & `staff_allowances`.

### Key Schema Issues to Resolve
- **Menu Dual Authority**: `recipes` table vs `menu_items` / `menu_categories`. Need a unified canonical catalog (`menu_categories`, `menu_items`, `menu_prices`, `recipe_versions`, `recipe_ingredients`).
- **Currency & Decimal Precision**: Existing schema uses floating-point `REAL` for prices and totals; must adopt integer minor units (`amount_minor`) to prevent floating-point rounding errors.
- **Physical Quantities**: Standardize BOM quantities to integer micro-units or precise decimal representations.
- **Missing Transactional Invariants**: Lack of `inventory_ledger` table with immutable event tracking (`PURCHASE`, `CONSUMPTION`, `WASTE`, `TRANSFER`, `ADJUSTMENT`, `REVERSAL`).
- **Missing Outbox Tables**: Print jobs and realtime sync events are not persisted in SQLite outbox tables.

---

## 4. Current Authentication & Security Flaws

1. **Plaintext Credentials**: `users.pin_code` holds plaintext 4-digit PINs (`1001`, `1002`, `1007`, `1009`, `1111`, etc.).
2. **Missing Server Session State**: Login returns user details; client saves `currentUser` in `localStorage`. Subsequent requests send `x-user-role: OWNER` or `role=OWNER` which the server trusts.
3. **Insecure Endpoints**:
   - Financial endpoints (`/api/reports/eod`, `/api/reports/bi`) rely on `req.headers['x-user-role']`.
   - `/api/orders` accepts `waiter_id` and `user_name` directly from request body.
   - `/api/checkout` accepts client-calculated `subtotal` and `total_amount`.
4. **No Rate Limiting or Anti-Brute-Force**: Login endpoint `/api/auth/login` can be brute-forced without rate limits or progressive delays.

---

## 5. Offline Capabilities & Print Bridge Analysis

- **Offline Support**: `sw.js` caches static web assets, but placing an order while disconnected fails because the frontend directly calls `fetch('/api/orders')`. No IndexedDB command queue exists.
- **Thermal Printing**: `server.js` calls `sendRawToPrinter` which connects directly to a TCP socket at request time. If the printer is offline or busy, the job is lost or marked "simulated" without retry capability.

---

## 6. Baseline Metrics & Counts (Current cafe.db)
- **Users**: 21 registered accounts
- **Audit Logs**: 459 entries
- **Orders**: 86 records
- **Order Payments**: 47 records
- **Purchases**: 12 records
- **Inventory Items**: 6 items
- **Recipes**: 8 items
- **Drawer Declarations**: 13 records
- **Complaints**: 15 records
- **Penalties & Advances**: 18 each
- **Waste Logs**: 45 entries
