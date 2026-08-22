# Cafe System MVP — Current State & Defect Ledger

**Evaluation Date:** 22 August 2026  
**Runtime Build ID:** `build-d4c1b979-v2`  
**Database Identity:** `cafe.db` (SQLite WAL mode)  
**Schema Version:** `005_canonical_prices.sql`  
**Service Worker Version:** `cafe-os-v3`  
**Gate Status:** `PASS` (Baseline established with isolated fixtures and verified backup)

---

## 1. Provenance Baseline

- **Repository Root:** `/home/omrshrifmo/cafe-system-mvp`
- **Node Runtime:** Node.js v22.23.1, npm v10.9.2
- **Process Manager:** PM2 (daemon process `cafe-server` ID 0 on port 3000)
- **Database Engine:** SQLite 3.x with WAL journal mode, `PRAGMA synchronous = NORMAL`, `foreign_keys = ON`
- **Backup Snapshot:** `backups/cafe_baseline_backup.db` (SHA-256 verified and restore validated)
- **Isolated Fixtures:**
  - `fixtures/clean.sqlite`: Deterministic empty transactional state with canonical seed
  - `fixtures/legacy.sqlite`: Representative legacy records, old column patterns, and unhashed PINs
  - `fixtures/concurrency.sqlite`: Dedicated inventory stock and active sessions for stress testing
  - `fixtures/offline.sqlite`: Deterministic client offline sync snapshot

---

## 2. Complete Defect Ledger

Every finding from `BROWSER_ENTERPRISE_QA_REVIEW_AFTER_AGENT4.md` and `browser_qa_notes_round3.md` is tracked below. All statuses are strictly `PASS`, `FAIL`, or `BLOCKED`.

| Finding ID | Domain / Area | Defect Summary & Root Cause | Affected API / Files | Test & Evidence Path | Owner | Baseline Status | Target Remediation |
|---|---|---|---|---|---|---|---|
| **DEF-01** | Auth / Session | Session revocation failure; `/api/auth/logout` was missing GET method; client remained logged in | `src/http/routes/auth.js`, `src/domain/auth/service.js` | `test/security/auth.test.js`, `artifacts/baseline/runtime-identity.txt` | Security Engineer | **FAIL** (Fixed in route; awaiting browser retest) | Support GET/POST `/api/auth/logout`, invalidate cookie, delete session from `user_sessions`, return 401 on `/api/auth/me`. |
| **DEF-02** | Provenance | Build-info endpoint returned insufficient metadata without commit SHA, schema, or instance ID | `src/app.js`, `/api/build-info` | `artifacts/baseline/runtime-identity.txt`, `artifacts/release-gate.json` | DevOps / SRE | **PASS** | Implemented headers `X-Build-Id`, `X-Commit-Sha`, `X-Schema-Version`, and full JSON payload. |
| **DEF-03** | Menu / Catalog | `GET /api/menu` was blocked by Default Deny regex mismatch with trailing slash | `src/http/middleware/registry.js`, `/api/menu` | `test/integration/orders.test.js`, `docs/route-permission-matrix.md` | API Lead | **PASS** | Updated regex in `registry.js` to `/^\/api\/menu(\/.*)?$/` permitting public catalog read. |
| **DEF-04** | POS Rendering | POS rendered blank cards on clean navigation or hard refresh if catalog array wasn't flattened | `public/pos.html`, `public/sw.js` | `test/integration/orders.test.js`, `public/pos.html` | Frontend Lead | **FAIL** (Overhauled in `pos.html`; pending live acceptance) | Flatten grouped menu categories into unified item cards, connect search, category filter tabs, and bump SW cache to `cafe-os-v3`. |
| **DEF-05** | Custom Item | Custom item modal submit left modal open and cart unchanged without server price calculation | `public/pos.html`, `src/http/routes/orders.js` | `test/integration/orders.test.js`, `public/pos.html` | Frontend Lead | **FAIL** (Fixed in DOM; pending browser retest) | Validated custom item name, minor-unit price, dynamic icon, cart integration, and modal auto-close. |
| **DEF-06** | BI Reporting | `/api/reports/bi` threw `SQLITE_ERROR: no such column: oi.item_name` and exposed internal error | `src/http/routes/reports.js`, `src/http/middleware/errors.js` | `test/security/security.test.js`, `docs/financial-baseline.md` | Accounting Engineer | **FAIL** (Fixed in SQL; pending report UI validation) | Corrected query to use `item_name_snapshot` in `order_items` and sanitized error envelopes globally. |
| **DEF-07** | Users / HR API | `/api/users` failed with `SQLITE_ERROR: no such column: phone` when querying staff | `src/http/routes/users.js` | `test/integration/shifts.test.js`, `docs/api-contracts.md` | Database Engineer | **FAIL** (Fixed query projection; pending UI check) | Projected valid user schema columns (`id, name, role, is_active, hourly_rate, department`). |
| **DEF-08** | EOD Departmental Totals | EOD departmental breakdown could report items exceeding total order count/revenue | `src/domain/shifts/service.js`, `src/http/routes/reports.js` | `test/integration/shifts.test.js`, `docs/financial-baseline.md` | Accounting Engineer | **FAIL** | Reconcile departmental sums strictly against `order_sessions` subtotal and ensure single source of truth. |
| **DEF-09** | Cashier Blindness | Cashier UI could expose expected cash, variances, or allow cross-shift selection | `public/eod.html`, `src/domain/shifts/service.js` | `test/security/security.test.js`, `test/integration/shifts.test.js` | Accounting Engineer | **FAIL** | Enforce blind cash declaration for cashier roles; expected cash strictly visible only to `OWNER` / `OP_MANAGER`. |
| **DEF-10** | Inventory / BOM | BOM reconciliation screen showed `undefined` material names while marking rows matched | `public/inventory.html`, `src/http/routes/inventory.js` | `test/integration/orders.test.js`, `docs/inventory-ledger.md` | Inventory Lead | **FAIL** | Correct DTO property names and mark missing/unmatched BOM mappings as `ERROR` or `UNRECONCILED`, never matched. |
| **DEF-11** | Tables & KDS Sync | Tables map retained contradictory check request states and lacked real-time synchronization | `public/tables.html`, `public/pos.html`, `src/domain/tables/service.js` | `test/integration/orders.test.js`, `public/pos.html` | Realtime Lead | **FAIL** (Overhauled; pending multi-client test) | Added `getTableSessionDetails`, `updateTableLifecycle`, POS table map modal, and WebSocket synchronization. |
| **DEF-12** | Ultimate Void Rule | Paid/closed orders could previously be voided without owner authorization | `src/domain/payments/service.js`, `src/http/routes/orders.js` | `test/security/security.test.js` | Security Engineer | **PASS** | Enforced that closed/paid order voids require `OWNER` / `SUPER_ADMIN` and create append-only reversal records. |

---

## 3. Runtime Verification Status

- **Mocha Automated Suites:** 23 passing tests (Unit, Concurrency, BOM Ledger, RBAC, Security, ESC/POS Printing)
- **Database Consistency:** `PRAGMA integrity_check` = `ok`
- **Backup Verification:** Checksums match (`cafe_baseline_backup.db` == `cafe_baseline_restore_test.db`)
