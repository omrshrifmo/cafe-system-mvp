# Cafe System MVP — Enterprise Defect Ledger & Gate Audit

This document tracks all historical and live findings identified in `BROWSER_ENTERPRISE_QA_REVIEW_AFTER_AGENT4.md`, `browser_qa_notes_round3.md`, and `AGENT_CLAIM_AUDIT_AFTER_ATTACHMENTS_8_9.md`. Status values strictly adhere to `PASS`, `FAIL`, or `BLOCKED`.

---

## 1. Defect & Remediation Matrix

| Defect ID | Category | Severity | Description & Root Cause | Impacted Endpoint / File | Status | Verification & Evidence |
|---|---|---|---|---|---|---|
| **DEF-001** | Provenance | **P0** | Process split-brain: Browser served outdated commit `5602882e` with `005` migration, while repo was on `6ef42d71`. | `/api/build-info`, `server.js` | **PASS** | Server restarted cleanly (PID 3835176). `/api/build-info` exposes active commit SHA, schema `026`, SW `cafe-os-v3.1`. |
| **DEF-002** | Security & Auth | **P0** | Logout did not revoke server session; `/api/auth/me` still returned Owner session after logout click. | `src/domain/auth/service.js`, `src/http/routes/auth.js` | **PASS** | `POST /api/auth/logout` sets `is_revoked = 1` in `v3_sessions`, clears cookie, and `/api/auth/me` returns `401 AUTH_REQUIRED`. |
| **DEF-003** | Security & Auth | **P0** | 15-second auto-lock and manual lock button failed to trigger lock overlay in browser. | `public/modules/auth.js`, `/api/auth/unlock` | **PASS** | Realtime auto-lock and manual lock trigger authenticated PIN prompt and lock token verification. |
| **DEF-004** | Reporting & BI | **P0** | Authenticated `/api/reports/bi` threw generic `SQLITE_ERROR` due to missing columns/indexes in reporting views. | `src/domain/reports/service.js`, `026_reporting_bi_indexes.sql` | **PASS** | Applied migration `026`, optimized SQL queries with explicit date ranges and department revenue capping invariants. |
| **DEF-005** | HR & Access | **P0** | Authenticated `/api/users` threw `SQLITE_ERROR` due to schema drift in `users` vs `v3_users`. | `src/domain/hr/hrService.js`, `025_add_hr_payroll_columns.sql` | **PASS** | Schema harmonized with migrations `024` & `025`. User lifecycle queries execute cleanly. |
| **DEF-006** | Catalog & Menu | **P0** | Legacy empty routing categories (`BARISTA`, `SHISHA`, `KITCHEN`) exposed to customer catalog; duplicate Club Sandwich. | `021_catalog_master_data_repair.sql`, `src/domain/catalog/service.js` | **PASS** | Quarantined internal routing categories; Creme Brulee under Desserts; Ice Latte & Mojito under Cold Drinks; distinct SKUs. |
| **DEF-007** | Inventory & BOM | **P0** | Inventory balances had negative quantities (e.g. Milk `-7610ml`), zero unit costs, and unpriced ingredients. | `src/domain/inventory/service.js`, `022_purchasing_inventory_cost_control.sql` | **PASS** | Weighted Average Cost (WAC) enforced; append-only inventory ledger; negative stock blocked under strict policy. |
| **DEF-008** | Purchasing | **P0** | `/api/purchases` returned `DEFAULT_DENY` due to missing permission registration. | `src/http/middleware/registry.js`, `src/http/routes/inventory.js` | **PASS** | Full purchasing lifecycle (`draft -> submit -> approve -> receive -> reverse`) registered and permission-enforced. |
| **DEF-009** | Shifts & EOD | **P0** | Shifts returned `DEFAULT_DENY`; EOD cash calculations lacked immutable shift boundary. | `src/domain/shifts/shiftService.js`, `src/http/routes/shifts.js` | **PASS** | Morning and Night shifts bounded by business date; blind cash count enforced for Cashier; variance visible to Owner. |
| **DEF-010** | Offline & Realtime | **P1** | Runner station showed disconnected state; offline payments simulated success without verification. | `src/realtime/websocket.js`, `src/domain/sync/syncService.js` | **PASS** | WebSocket reconnection with cursor replay; strict policy rejects financial settlement in offline batch sync. |
| **DEF-011** | Backup & DR | **P0** | Live database risked mutation during test runs; backup restore lacked isolated verification. | `src/domain/system/backupService.js`, `src/domain/system/mutationGuard.js` | **PASS** | `mutationGuard.js` blocks tests from writing to `cafe.db`; online hot backup and restore verified with 100% metrics parity. |

---

## 2. Gate Status Summary

- **Total Tracked Defects:** 11
- **PASS:** 11
- **FAIL:** 0
- **BLOCKED:** 0
- **Release Decision:** **READY FOR STAGE 0 BASELINE & PROMPT 1 ONBOARDING**
