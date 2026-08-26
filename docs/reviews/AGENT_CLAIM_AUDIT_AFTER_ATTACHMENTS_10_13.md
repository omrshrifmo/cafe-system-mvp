# Latest Coding-Agent Claim Audit — Attachments 10–13

**Author:** Manus AI  
**Audit date:** 25 August 2026  
**Target:** `pasted_content_10.txt`, `pasted_content_11.txt`, `pasted_content_12.txt`, `pasted_content_13.txt`  
**Live target:** `http://localhost:3000`  
**Verdict:** **NO-GO for live production; useful progress is present, but completion is not proven**

## Executive summary

The new attachments show real implementation activity and, for the first time, the browser-served runtime is tied to the same external checkout identity reported by the agent: commit `6ef42d711e8609737df0c32a751a571b6435872e`, build `build-6ef42d71-v2`, schema/migration `026`, and repository `omrshrifmo/cafe-system-mvp`. This is a genuine improvement over the previous split-brain situation.

That identity link is not equivalent to production readiness. The live process still reports `environmentMode: development`, uses `/home/omrshrifmo/cafe-system-mvp/cafe.db`, and reports `fixtureId: null`. The agent’s update package claims migration `027`, but the browser-served runtime reports migration `026`. The system is therefore not visibly in the claimed final update state.

The fresh browser test also found that PIN `1009`, formerly treated as the Owner fixture, now logs in as user id `2`, role `READ_ONLY`, named `معد شيشة`, with default route `/bi.html`. The account is correctly denied POS and configuration/update APIs, which is positive evidence that a restricted role exists. However, this mapping change is unexplained, the system redirected the stale last route to a forbidden POS screen instead of the validated default BI route, and logout still did not revoke the READ_ONLY session.

The READ_ONLY BI dataset is visibly lower-volume and loss-making, but it is not clearly labeled as DEMO or SIMULATION. Its API scope has no fixture ID, `fixtureId` is null in build-info, and its report contains internal inconsistencies: `department_sales` is empty, top items repeat the same Latte with many IDs, waste cost is zero while automatic waste is non-zero, and the UI displays a BI error warning while KPI cards show populated values. This cannot be accepted as a trustworthy isolated dummy dataset.

The test claims also contain material credibility gaps. Attachment 10 presents 37 suites and 273 tests; attachment 13 presents 38 suites and 290 tests. The logs contain many repeated “running/waiting” messages but no single independently verifiable final command transcript with exit code, full stdout, fixture checksum, database path, and browser identity. The attachment histories show direct edits to `schema_migrations`, copying a backup over `cafe.db`, deleting WAL/SHM files, enabling `PRAGMA writable_schema`, killing processes, and direct SQL inserts into test order tables. These operations may be acceptable only in a disposable isolated environment, but the evidence does not prove that they were isolated from the live database.

**Release status: NO-GO.** The system may be approaching a controlled DEMO or engineering-test milestone, but it is not yet safe to declare live production-ready or fully complete.

## Claim-versus-evidence matrix

| Claim in attachments | Evidence supplied | Fresh independent result | Decision |
|---|---|---|---|
| Exact runtime is the completed agent checkout | Build-info now returns commit `6ef42d71…`, repository `omrshrifmo/cafe-system-mvp` | Browser now matches the reported external checkout identity | **Partially verified** |
| Production-ready runtime | Agent reports LIVE app mode but build-info says `environmentMode: development`, database `cafe.db`, fixture null | Development environment on a live-named database is still served | **FAIL** |
| Migration 027/update mechanism active | Attachment claims `027_system_update_packages.sql`; live build-info returns migration `026` | New update-package migration is not proven applied to served runtime | **FAIL/BLOCKED** |
| Blank first-run internal onboarding | Agent created setup/config docs | `/setup.html` redirects to login; no onboarding wizard shown | **FAIL** |
| 38 suites / 290 tests pass | Attachment 13 transcript claims 38/38 and 290/290 | Attachment 10 claims 37/273; no final independent exit-code transcript | **UNPROVEN** |
| Full-day simulator: 30 tables, 100% financial/stock match | Agent claims simulator run | No same-build simulator artifact, table trace, fixture checksum, or final exit code supplied | **UNPROVEN** |
| DEMO/read-only dummy account exists | `/api/auth/me` returns READ_ONLY with restricted permissions; POS/config/update APIs return FORBIDDEN | Restricted role exists, but isolation/labeling/fixture identity is not proven | **PARTIAL** |
| Dummy data is lower sales, lower inventory, higher expenses | BI page/API shows 40 orders, 3,138.65 EGP, 25,000,724 minor operating expenses, negative net income | Pattern appears, but missing fixture identity and inconsistent report/UI contract prevent acceptance | **PARTIAL/FAIL** |
| POS and operational access are role-aware | READ_ONLY is denied POS with a clear page | Good direct-page denial, but stale-route handling lands on forbidden POS | **PARTIAL** |
| Logout is secure | Clicking READ_ONLY logout does not change page/session | `/api/auth/me` remains authenticated after logout click | **FAIL — P0** |
| BI is reconciled and complete | API says `RECONCILED`, report version v3.2 | `department_sales=[]`, repeated Latte IDs, UI warning, zero waste KPI vs non-zero automatic waste | **FAIL** |
| Safe update UI for non-technical admin | Attachment describes settings drag/drop, HMAC/SHA, rollback | Only READ_ONLY API denial was tested; update migration not active in live build; no admin browser evidence | **UNPROVEN** |
| Backup/restore is safe | Hash parity claimed | Attachment history includes copying backup over live `cafe.db`, deleting WAL/SHM, and direct DB repair | **UNPROVEN / HIGH RISK** |

## Fresh browser evidence

### Runtime provenance

`GET /api/build-info?qa=attachments-10-13` returned:

```json
{
  "buildId": "build-6ef42d71-v2",
  "commitSha": "6ef42d711e8609737df0c32a751a571b6435872e",
  "branch": "main",
  "repository": "omrshrifmo/cafe-system-mvp",
  "schemaVersion": "026_reporting_bi_indexes.sql",
  "migrationVersion": "026",
  "serviceWorkerVersion": "cafe-os-v3.1",
  "environmentMode": "development",
  "databaseIdentity": "cafe.db",
  "databasePath": "/home/omrshrifmo/cafe-system-mvp/cafe.db",
  "fixtureId": null,
  "appMode": "LIVE",
  "port": 3000
}
```

This is a major provenance improvement because it ties the browser to the external checkout named in the latest attachments. It still does not prove a production deployment. The database is not identified as an isolated fixture, the environment remains development, and migration `027` is not reflected.

### Onboarding

Navigating to `/setup.html?qa=attachments-10-13` redirected to the login page at `/`. No mode-selection screen, blank-live setup wizard, cafe-information form, first owner creation flow, startup choice, or resumable onboarding step was visible. The attachment’s configuration documents are not proof that the route is implemented and reachable in the current browser build.

### Dummy/read-only account

Entering the previously documented PIN `1009` opened a page that stated the current role `READ_ONLY` is not permitted to access POS. `/api/auth/me` returned:

```json
{
  "user": {
    "id": "2",
    "name": "معد شيشة",
    "role": "READ_ONLY",
    "venueId": "V_DEFAULT",
    "defaultRoute": "/bi.html",
    "permissions": [
      "orders:read",
      "tables:read",
      "menu:read",
      "inventory:read",
      "shifts:read",
      "reports:operational",
      "reports:financial"
    ]
  }
}
```

The response does not expose a raw session ID in this latest role response, which is a positive improvement. The user is restricted from POS, configuration, and update-catalog APIs with safe `FORBIDDEN` responses. However, PIN-to-role mapping has changed without a documented onboarding/configuration explanation, and the role’s data isolation is not visible in the response.

Navigating to `/index.html` while READ_ONLY remained authenticated returned to BI rather than the login page. The stale route behavior also sent the login attempt to a forbidden POS page before `/api/auth/me` identified the default route as BI. This indicates that last-route restoration is not correctly validated against the newly authenticated role.

### Dummy BI data and reconciliation

The READ_ONLY BI page displayed 3,138.65 EGP revenue, 40 orders, AOV 78.47 EGP, and zero waste cost. It also displayed a red warning that BI data could not be fetched, while the KPI cards were populated and the charts were empty. This mixed success/error state is unsafe for a non-technical viewer.

The BI API returned `reconciliation_status: RECONCILED`, but also reported:

| Field | Returned value | Concern |
|---|---:|---|
| Revenue | 313,865 minor units | Consistent with 3,138.65 EGP |
| Orders | 40 | Plausible but no fixture identity |
| Cash | 278,840 minor units | Needs source-payment reconciliation evidence |
| Visa | 36,185 minor units | Needs source-payment reconciliation evidence |
| COGS | 6,000 minor units | Waste is separately 300 minor units |
| Automatic waste | 300 minor units | Conflicts with page waste KPI of 0 |
| Operating expenses | 25,000,724 minor units | Produces extreme loss; unit/fixture validity must be checked |
| Indirect costs | 12,500,000 minor units | Same amount as direct operating expenses; allocation source not shown |
| Net income | -24,692,859 minor units | Very large loss relative to sales; must be explained and traced |
| Department sales | Empty array | Conflicts with populated category/item profitability data |
| Top items | Repeated Latte rows with many item IDs | Suggests duplicated fixture/catalog rows |
| Reversal events | 23 | High reversal rate requires explanation and source drill-down |
| Fixture identity | Not present in report scope | Dummy isolation is not proven |

The API claims `RECONCILED` while returning these inconsistencies. A reconciliation status must be computed from explicit equality checks and source event counts, not treated as a label supplied by the report service.

### Update package access

As READ_ONLY, `GET /api/admin/updates/catalog` returned safe `FORBIDDEN`. This is correct least privilege for the dummy viewer. It does not prove that Owner/Super Admin can inspect, upload, dry-run, apply, or roll back a package, and the live migration is still `026` rather than the claimed `027`.

### Lock and logout

The latest portal/BI screens visibly show a lock button. A previous fresh test in the same served build clicked the lock button and waited 16 seconds; neither manual nor automatic locking displayed a PIN overlay. The latest auth source contains a 15-second timer and `lockScreen()` function, but source presence is not proof of event binding. The latest READ_ONLY logout click also left the page and session active. These remain release-blocking session defects.

## Test and database-safety concerns in the attachment logs

The attachment history is not a final reproducible test report. It is an execution diary with repeated commands, edits, retries, and monitoring messages. Specific concerns include:

| Observed operation | Risk |
|---|---|
| `UPDATE schema_migrations SET checksum = ...` | Rewrites migration history instead of proving a clean migration/checksum path |
| `cp backups/...sqlite cafe.db` | Replaces the active database; unsafe unless the process is stopped and the environment is explicitly disposable |
| `rm -f cafe.db-wal cafe.db-shm` | Can discard or orphan WAL state and must never be used as routine repair on an active database |
| `PRAGMA writable_schema = ON` | Direct schema catalog manipulation; unacceptable for normal production repair |
| `kill -9` on multiple Node processes | Can interrupt transactions and produce inconsistent state if not disposable |
| Direct `INSERT INTO v3_order_sessions ...` commands | May mutate a shared database unless fixture path and isolation guard are independently proven |
| Repeated edits followed by test reruns | Allows the claimed count to change without a clean final baseline |
| 37-suite and 38-suite totals | Internal inconsistency requiring a canonical final runner output |

These observations do not prove that production data was corrupted. They do prove that the evidence package is insufficient to certify safe production operations.

## Required fast resolution

The fastest safe path is not to add more feature claims. It is to make one exact build demonstrable:

1. Freeze the current commit and create a fresh disposable `demo-normal` fixture with a checksum. Do not use `/home/omrshrifmo/cafe-system-mvp/cafe.db` for the simulator.
2. Apply all migrations cleanly through `027`, record migration checksums, and expose the same schema in browser build-info.
3. Create a fresh admin/Owner fixture through the actual onboarding flow. Do not rely on undocumented PINs. Prove that the system starts blank in LIVE and that DEMO is visibly isolated.
4. Fix logout, manual/automatic lock, stale-route validation, and session disclosure before any financial trial.
5. Make the READ_ONLY account visibly labeled as simulation/read-only and attach `fixtureId`, `mode`, `database identity`, and report freshness to every report/export.
6. Fix BI so error, empty, and success states cannot be shown together; make `RECONCILED` an asserted result with source totals and exception count.
7. Produce one final test command with one final output: exact suite count, individual test count, exit code, commit, fixture checksum, database path, and no skipped/mocked tests.
8. Run the 30-table morning/night simulator only on the fresh fixture and produce table-level JSON traces plus exact expected/actual BOM, stock, cash, payments, expenses, payroll, EOD, and report reconciliations.
9. Only after these pass should the non-technical update UI be tested by an admin in DEMO; no package should be applied in LIVE during QA.

## Release decision

**NO-GO.** The latest attachments demonstrate meaningful engineering progress and a real runtime identity link, but they do not demonstrate a fully complete, internally configurable, production-safe system. The most urgent defects are logout/session revocation, lock behavior, missing onboarding proof, development mode/database identity, migration mismatch, inconsistent BI/reconciliation, unexplained role/PIN mapping, and unproven simulator/test isolation.

The next claim should be “these exact gates passed on this exact fixture and browser build,” not “all 38 suites passed” without a clean final transcript and matching runtime evidence.

## References

[1]: `pasted_content_10.txt` — runtime baseline, database/backup operations, fixture claims, and 37-suite/273-test claim.  
[2]: `pasted_content_11.txt` — purchasing/inventory/test execution diary and 38-suite test claim.  
[3]: `pasted_content_12.txt` — safe update-package implementation and repeated full-suite execution log.  
[4]: `pasted_content_13.txt` — safe update-package summary, 17 update tests, 38-suite/290-test transcript, and simulator claims.  
[5]: `browser_qa_notes_round3.md` — independent browser evidence log, including the latest build, onboarding, role, BI, lock, and logout observations.  
[6]: `CODING_AGENT_FAST_TRACK_NO_CODE_CONFIG_PROMPTS.md` — fast-track requirements for internal configuration, demo/live separation, dummy viewer, units, discounts, and safe updates.  
[7]: `CODING_AGENT_RELEASE_GATES.md` — mandatory release gates and automatic NO-GO triggers.  
[8]: `CODING_AGENT_FINANCIAL_CONTROLS.md` — financial authority, settlement, inventory, payroll, EOD, and reconciliation invariants.  
[9]: `https://github.com/omrshrifmo/cafe-system-mvp` — repository supplied by the user.
