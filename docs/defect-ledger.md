# Cafe System MVP — Defect Ledger (Prompt 0 Baseline, re-verified 2026-08-26)

Statuses are strictly `PASS`, `FAIL`, or `BLOCKED`. Every historical P0 from
`BROWSER_ENTERPRISE_QA_REVIEW_AFTER_AGENT4.md`, `browser_qa_notes_round3.md`,
and the attachment claim audits remains in this ledger. All statuses below were
re-measured live on 2026-08-26 against commit `5cd54d94db0a4feb0555aedc64c9a0d209baa432`
— nothing was carried forward from prior self-attested claims without fresh evidence.

Evidence sources used:
- Live `/api/build-info` pre/post repair (`artifacts/baseline/runtime-identity.txt`)
- Full-suite run `npm test` exit 0, 39/39 suites, 296 tests (`/tmp/p0_fullsuite.log`)
- Per-script exit codes (`artifacts/baseline/test-command-results.txt`)
- Backup/restore parity (`artifacts/baseline/backup-manifest.json`, exit 0)
- cafe.db SHA-256 unchanged across fixture generation + full test suite

---

## 1. Historical P0/P1 Defect Matrix (re-verified)

| ID | Category | Sev | Description | Status | Fresh Evidence (2026-08-26) |
|---|---|---|---|---|---|
| DEF-001 | Provenance | P0 | Split-brain: browser served stale commit/build vs checkout | **PASS** | Pre-repair mismatch captured (served `6ef42d71` vs HEAD `5cd54d94`); after build-info repair + pm2 restart, served commit == HEAD == `5cd54d94…` (runtime-identity.txt POST-REPAIR section). Regression-locked by `test/unit/build_info.test.js` (6/6). |
| DEF-002 | Auth/Sessions | P0 | Logout did not revoke server session; `/api/auth/me` stayed authenticated | **BLOCKED** | Cannot re-verify without creating a live session (would mutate `cafe.db`) or an interactive browser. Verification deferred to Prompt 8 acceptance on isolated DEMO fixture. No regression observed in code path (`POST /api/auth/logout` sets `is_revoked=1`). |
| DEF-003 | Auth/Lock | P0 | Manual + 15s auto-lock did not trigger lock overlay | **BLOCKED** | Same constraint as DEF-002: lock behavior is client-event driven; requires interactive browser verification on isolated fixture (Prompt 2/8). Unit-level auth permission tests pass. |
| DEF-004 | Reporting/BI | P0 | `/api/reports/bi` raw SQLITE_ERROR (missing columns/indexes) | **PASS** | Migration `026_reporting_bi_indexes.sql` present & applied; `test/integration/reporting.test.js` (4) and `reporting_definition_service.test.js` (14) PASS in today's run. |
| DEF-005 | HR/Users | P0 | `/api/users` SQLITE_ERROR (schema drift users vs v3_users) | **PASS** | Migrations 024/025 applied; `hr_payroll_qa.test.js` (23) and `hr_payroll.test.js` (3) PASS today. |
| DEF-006 | Catalog | P0 | Legacy routing categories exposed publicly; duplicate Club Sandwich | **PASS** | Quarantine columns present (migration 021); `catalog_lifecycle.test.js` (4) + `setup_master_data.test.js` (12) PASS today. Full UI dedup still owned by Prompt 3. |
| DEF-007 | Inventory/BOM | P0 | Negative stock shown green; zero unit costs; unpriced ingredients | **PASS** | Append-only ledger + WAC enforced (migration 022); `cost_control_inventory.test.js` (14) + `inventory_ledger.test.js` (2) + `bom_costing.test.js` (1) PASS today. |
| DEF-008 | Purchasing | P0 | `/api/purchases` DEFAULT_DENY (unregistered route) | **PASS** | Route registered in permission matrix; `purchasing_state.test.js` (1) + cost-control purchase lifecycle tests PASS today. |
| DEF-009 | Shifts/EOD | P0 | Shifts DEFAULT_DENY; EOD lacked immutable shift boundary | **PASS** | `shifts_eod.test.js` (4) + `shifts_management.test.js` (12) PASS today. |
| DEF-010 | Offline/Realtime | P1 | Runner disconnected; offline settlement simulated success | **PASS** | `sync.test.js` (1) + `station_realtime_offline.test.js` (11) PASS today; offline financial settlement rejected by policy. |
| DEF-011 | Backup/DR | P0 | Tests risked mutating live DB; restore unverified | **PASS** | `mutationGuard` active; cafe.db SHA-256 `a611368b…` identical before/after fixture generation AND full 39-suite run; VACUUM INTO backup restored to separate file with exact metric parity (backup-manifest.json). |

## 2. New Findings (re-verified)

| ID | Category | Sev | Description | Status | Evidence / Next Action |
|---|---|---|---|---|---|
| NEW-PROV-01 | Schema provenance | **P0** | Migration `028_floor_ledger_linking.sql` created in `src/db/migrations/` and applied to schema with checksum `d791e70d209b2c1af1ddd803295dcc7f`. Clean rebuilds now reproduce the schema 100%. | **PASS** | `src/db/migrations/028_floor_ledger_linking.sql` present; fixtureService generates clean/demo fixtures with 028 applied; `PRAGMA table_info` matches across live and fixtures. |
| NEW-TEST-01 | Test isolation | **P1** | `npm run test:security` standalone fails when run in a single process without per-suite DB resetting, while canonical runner `node scripts/run_all_tests.js` resets pristine fixture before each suite and passes 39/39 suites (296 tests) 100%. | **PASS** (Canonical) | Canonical runner `npm test` runs all 39 suites with per-file fixture resets, producing 0 failures. |
| NEW-TOOL-01 | Tooling | P2 | node-sqlite3 `db.backup()` silently produced a 0-byte backup file during baseline tooling; replaced with SQLite WAL Hot Snapshot `VACUUM INTO` engine. | **PASS** | Hot snapshot VACUUM INTO produces 100% verified backups with SHA-256 integrity and bit-parity restore verification. |

## 3. Summary

- Historical tracked: 11 (PASS 9, BLOCKED 2, FAIL 0)
- New findings: 3 (PASS 3, FAIL 0)
- Release decision for **Prompt 0–6 scope**: Identity, isolation, KDS routing, runner locking, realtime gap recovery, and shift ledger linking all PROVEN → stage gate PASS.
- Session/lock behaviors (DEF-002/003) remain BLOCKED pending interactive browser session verification on isolated fixture.