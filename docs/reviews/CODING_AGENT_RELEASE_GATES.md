# Cafe System MVP — Coding-Agent Release Gates

This document is a companion to `CODING_AGENT_EXECUTION_PROMPT_FINAL.md`. Every gate is mandatory. A gate is `PASS` only when the implementation, automated test, and evidence artifact all agree on the same repository commit, process, database, schema, and build ID.

## Gate status rules

Use only `PASS`, `FAIL`, or `BLOCKED`. `BLOCKED` is not a pass. Any unresolved P0 or P1 gate means **NO-GO**. A screenshot without an assertion, a status-200 check without payload validation, or a hand-edited report is not evidence.

| Gate | PASS criteria | Minimum evidence |
|---|---|---|
| Provenance | Browser, process, source checkout, database, schema, migration, and build ID are identical | `artifacts/baseline/runtime-identity.txt`, build-info response, commit SHA |
| Backup | Consistent backup is checksum-verified and restored to a separate database | `artifacts/backup-restore/` logs and checksums |
| Migration | Empty and legacy fixtures migrate transactionally with counts/totals/reconciliation and restore procedure | migration logs, before/after JSON, rollback/restore output |
| Auth | PINs hashed, no production defaults/shortcuts, rate limit/lockout/rotation documented | security tests and configuration scan |
| Sessions | Secure server sessions, expiry, revocation, logout, stale-tab/back-button denial | browser traces and session integration tests |
| RBAC | Every private page/API/export/job/WebSocket is default-deny and returns 401/403 correctly | full route/API permission matrix |
| Error safety | No SQL, stack, path, secret, or raw exception exposed | API contract/security test output |
| Catalog | One canonical published catalog and price snapshot across POS, QR, manager, receipt, EOD, BI, exports | catalog reconciliation report and browser screenshots |
| POS | Known menu cards render on clean load and hard refresh; cart, modifiers, table, quote, custom-item/feature removal work | browser trace with build ID |
| Order lifecycle | Illegal transitions rejected; legal flow is audited and idempotent | integration/concurrency tests |
| KDS | Authenticated station routing, acknowledgement, replay, reconnect, deduplication, and visible health | realtime test logs and browser trace |
| QR | Signed/scoped/expiring/replay-safe table token; invalid 9999 and wrong venue rejected | QR security tests and browser evidence |
| Pricing | Server computes minor-unit quote, tax, service, discount, tip, change, and receipt snapshot | quote/property tests and reconciliation |
| Settlement | No duplicate settlement; split payments, retries, voids/refunds are append-only and audited | payment/concurrency/reversal tests |
| Cash/EOD | One shift ID and cash formula; cashier blind count; approvals/locks/reopen audit | financial invariant report and role browser traces |
| Accounting | EOD, BI, portal, shareholder, payroll, and exports reconcile to immutable source events | reconciliation workbook/JSON and drill-down screenshots |
| Inventory | Ledger balances, BOM, waste, transfers, counts, costs, and negative stock policy reconcile | inventory invariant report; no undefined/false-green rows |
| Purchasing | Supplier, invoice/GRN, receiving, tax, cost, approval, attachment, history, idempotency | integration and browser evidence |
| Payroll | Bounded period, approved attendance, effective rates, deductions, locks, corrections; no impossible hours/negative unexplained pay | payroll test output and fixture report |
| CRM/privacy | Masked/scoped customer data and stable loading/error/retry states | security/browser tests |
| Reservations | Date/timezone, conflict detection, customer/table linkage, lifecycle, audit | integration/browser tests |
| QA | Complaint lifecycle with severity, evidence, owner, corrective action, due date, audit | integration/browser tests |
| UX states | Every screen handles loading timeout, empty, error, offline/stale, retry, success, focus/modal recovery | screen-state matrix and screenshots |
| Responsive/accessibility | 320–1920px, touch, keyboard, RTL, zoom, contrast, labels, KDS wall, QR mobile pass | device screenshots/traces and accessibility report |
| Performance | Budgets for cold start, POS menu readiness, API p95/p99, realtime reconnect, print, concurrency, memory/timers | performance report and command output |
| Offline | Durable queue, exactly-once sync, conflict/rejection, no false payment settlement | offline test artifacts |
| Printing | Durable, acknowledged, retryable, duplicate-safe print jobs and safe drawer kick | printer outage/retry tests |
| Operations | Readiness/liveness, graceful shutdown, restart, DB lock, disk/log/worker monitoring, alerts | resilience logs and runbook |
| 24/7 readiness | Soak, backup/restore, RPO/RTO, monitoring, incident and disaster-recovery rehearsal completed | operations evidence; limitations stated |
| CI | `npm test` and all required scripts are real, deterministic, and wired to CI | CI run URL/logs and package scripts |
| Documentation | Implementation, security, finance, data, operations, browser, performance, and limitations docs are current | docs review checklist |

## Required commands

The release candidate must run these commands from a clean checkout and record exit code and commit SHA:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run test:concurrency
npm run test:e2e
npm run test:offline
npm run test:migrations
npm run test:backup-restore
npm run test:performance
npm run audit:production
npm run db:migrate
npm run db:status
npm run db:backup
npm run db:restore
```

## Mandatory no-go triggers

Release is automatically **NO-GO** if any of the following occurs:

- POS has no canonical menu cards or a normal order cannot be completed safely.
- A private API/page/WebSocket/export/job exposes data without valid authorization.
- Any report, receipt, settlement, or inventory effect trusts client totals or actor identity.
- A payment, refund, void, purchase, BOM deduction, print job, loyalty award, or cash event duplicates on retry.
- EOD shift/declaration context differs, expected cash is exposed to a blind cashier, or a close can be submitted for the wrong shift.
- BI, EOD, portal, shareholder, payroll, inventory, or receipt totals do not reconcile.
- `undefined`, raw SQL errors, misleading zeros, false green matches, or infinite loading appear in a core workflow.
- Migration or backup/restore evidence is absent, destructive tests use a shared database, or unknown legacy records are silently discarded.
- `npm test` is a placeholder, a test suite is untracked/not CI-wired, failures are ignored, or tests only assert HTTP 200.
- Mobile/touch/keyboard/RTL/accessibility/performance evidence is missing while those capabilities are claimed.
- 24/7/one-year reliability is claimed without monitoring, soak, outage, and recovery evidence.

## Final sign-off format

```text
Release status: PASS | FAIL | BLOCKED
Repository/branch/commit:
Runtime/build ID:
Database/fixture/schema/migration:
P0 gates: <count PASS> PASS, <count FAIL> FAIL, <count BLOCKED> BLOCKED
P1 gates: <count PASS> PASS, <count FAIL> FAIL, <count BLOCKED> BLOCKED
Automated command summary:
Browser/device summary:
Financial reconciliation summary:
Backup/restore summary:
Known limitations:
Evidence directory:
Approver:
Timestamp:
```

The sign-off must not use the phrase “all fixed” unless every gate is PASS and the evidence directory is complete.
