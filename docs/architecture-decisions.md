# Cafe System MVP — Architecture Decision Records (ADRs)

**Date:** 22 August 2026  
**Status:** Active / Accepted  
**Target Runtime:** Node.js Express 4.x + SQLite 3.x WAL + WebSocket + Vanilla JS PWA

---

## ADR-001: Strict Minor-Unit Currency Representation
- **Context:** Floating-point arithmetic introduces rounding drift in high-volume cafe operations, especially with 12% service charge and 14% VAT.
- **Decision:** All monetary fields are stored as integer minor units (`EGP cents` / `piastres`) with column suffix `_minor`.
- **Formulas:**
  - `subtotal_minor = SUM(unit_price_minor * quantity)`
  - `service_minor = ROUND(subtotal_minor * (service_rate / 100))`
  - `tax_minor = ROUND((subtotal_minor + service_minor) * (vat_rate / 100))`
  - `total_minor = subtotal_minor + service_minor + tax_minor - discount_minor + tip_minor`
- **Consequences:** Eliminates decimal drift; provides exact ledger reconciliation across receipts, EOD, BI, and shareholder statements.

---

## ADR-002: SQLite WAL Mode with Serialized Mutating Transactions
- **Context:** The system operates offline-first on local hardware (e.g. mini PC/POS terminal) with concurrent orders from Waiters, QR guests, POS cashiers, and KDS stations.
- **Decision:** SQLite configured with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA busy_timeout = 5000`, and `PRAGMA foreign_keys = ON`.
- **Concurrency Control:** All financial checkouts, inventory stock deductions, and table lifecycle transitions execute within `runTransaction` using an explicit single-thread transaction queue.
- **Consequences:** Readers never block writers, writers never block readers. Concurrency stress tests with 10 parallel transactions pass with zero deadlocks.

---

## ADR-003: Server-Authoritative Identity & Default-Deny Route Registry
- **Context:** Browsers must never be trusted to declare prices, totals, stock truth, or cashier identities.
- **Decision:**
  - Centralized Route Permission Registry (`src/http/middleware/registry.js`) intercepts every HTTP route before dispatch. Any route not explicitly mapped is rejected with `403 DEFAULT_DENY`.
  - Sessions are managed server-side via `user_sessions` table with cryptographic UUID tokens, HttpOnly Lax cookies, and PIN verification using `bcryptjs`.
- **Consequences:** Prevents privilege escalation and forged client parameters.

---

## ADR-004: Append-Only Reversals & Ultimate Void Rule
- **Context:** Deleting or mutating historical financial or inventory rows destroys accounting audit trails.
- **Decision:**
  - Deleting paid orders or settled payments is strictly forbidden.
  - Cancellations of paid orders create immutable rows in `payment_reversals` and `inventory_ledger` with `event_type = 'REVERSAL'`.
  - Reversals on closed/settled orders require `OWNER` or `SUPER_ADMIN` authorization.
- **Consequences:** Ensures full compliance with Egyptian and MENA accounting standards.

---

## ADR-005: Canonical Published Catalog & Deprecation of Mutable Base Prices
- **Context:** Previously, legacy `menu_items.price` and `menu_items.base_price` caused pricing desynchronization between POS, QR, and Menu Manager.
- **Decision:** `menu_prices` is the authoritative effective-dated price table. Every item price update generates an append-only row in `menu_prices`, and order items record immutable `unit_price_snapshot` at the moment of order placement.
- **Consequences:** Historical sales analytics remain accurate even if menu prices change in the future.
