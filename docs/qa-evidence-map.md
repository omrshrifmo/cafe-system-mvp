# Cafe System MVP — Comprehensive QA Evidence Map & Defect Ledger

**Baseline Date:** 22 August 2026  
**Build ID:** `build-d4c1b979-v2`  
**Database:** `cafe.db` (SHA-256 Verified)  
**Permitted Statuses:** `PASS`, `FAIL`, `BLOCKED`

---

| Finding ID | Finding Description | Affected Component / File | API Endpoint | Test File | Owner | Status | Evidence Path |
|---|---|---|---|---|---|---|---|
| **QA-P0-01** | Session revocation failure; `/api/auth/logout` did not handle GET; session remained active | `src/http/routes/auth.js`, `public/nav.js` | `GET/POST /api/auth/logout` | `test/security/auth.test.js` | Security Engineer | **FAIL** | `artifacts/baseline/runtime-identity.txt` |
| **QA-P0-02** | Build-info returned weak payload without commit SHA, schema, or instance identity | `src/app.js` | `GET /api/build-info` | `test/security/security.test.js` | DevOps Lead | **PASS** | `artifacts/baseline/runtime-identity.txt`, `artifacts/release-gate.json` |
| **QA-P0-03** | Default Deny regex prevented access to `/api/menu` without trailing slash | `src/http/middleware/registry.js` | `GET /api/menu` | `test/integration/orders.test.js` | API Lead | **PASS** | `docs/route-permission-matrix.md` |
| **QA-P0-04** | POS blank menu rendering under stale service worker cache | `public/pos.html`, `public/sw.js` | `GET /api/menu` | `test/integration/orders.test.js` | Frontend Lead | **FAIL** | `public/pos.html`, `public/sw.js` |
| **QA-P0-05** | Custom item modal submission failed to update ticket and close modal | `public/pos.html` | Client DOM / Cart | `test/integration/orders.test.js` | Frontend Lead | **FAIL** | `public/pos.html` |
| **QA-P0-06** | BI Report threw `SQLITE_ERROR: no such column: oi.item_name` | `src/http/routes/reports.js`, `src/http/middleware/errors.js` | `GET /api/reports/bi` | `test/security/security.test.js` | Accounting Engineer | **FAIL** | `docs/financial-baseline.md` |
| **QA-P0-07** | Users API threw `SQLITE_ERROR: no such column: phone` | `src/http/routes/users.js` | `GET /api/users` | `test/integration/shifts.test.js` | Database Engineer | **FAIL** | `docs/api-contracts.md` |
| **QA-P0-08** | EOD departmental item counts could exceed total business order count | `src/domain/shifts/service.js`, `src/http/routes/reports.js` | `GET /api/reports/eod` | `test/integration/shifts.test.js` | Accounting Engineer | **FAIL** | `docs/financial-baseline.md` |
| **QA-P0-09** | Cashier UI exposed expected cash and variance during declaration | `public/eod.html` | `POST /api/shifts/declare-cash-extended` | `test/integration/shifts.test.js` | Accounting Engineer | **FAIL** | `public/eod.html` |
| **QA-P0-10** | BOM reconciliation screen showed `undefined` ingredient names with false green match | `public/inventory.html`, `src/http/routes/inventory.js` | `GET /api/reports/bom-reconciliation` | `test/integration/orders.test.js` | Inventory Lead | **FAIL** | `public/inventory.html` |
| **QA-P0-11** | Tables management lacked visual floor map and active order ticket sync | `public/pos.html`, `public/tables.html`, `src/domain/tables/service.js` | `GET /api/tables/:number/session` | `test/integration/orders.test.js` | Realtime Lead | **FAIL** | `public/pos.html`, `public/tables.html` |
| **QA-P0-12** | Ultimate void rule: Paid orders could be canceled by non-owners | `src/domain/payments/service.js`, `src/http/routes/orders.js` | `POST /api/orders/:id/void` | `test/security/security.test.js` | Security Engineer | **PASS** | `test/security/security.test.js` |
| **QA-P0-13** | Database backup consistency & isolated test fixtures | `src/db/cli.js`, `scratch/build_baseline_all.js` | CLI `VACUUM INTO` | `test/integration/backup.test.js` | Database Engineer | **PASS** | `artifacts/baseline/backup-manifest.json` |
| **QA-P0-14** | Multi-method split checkout with exact EGP minor-unit math | `src/domain/payments/service.js` | `POST /api/checkout` | `test/integration/payments.test.js` | Financial Lead | **PASS** | `artifacts/baseline/reconciliation-before.json` |
