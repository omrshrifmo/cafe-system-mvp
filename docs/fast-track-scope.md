# Fast-Track Scope (established at Prompt 0 baseline)

Source of requirements: `docs/reviews/CODING_AGENT_FAST_TRACK_NO_CODE_CONFIG_PROMPTS.md`
(Prompt Series), gated by `docs/reviews/CODING_AGENT_RELEASE_GATES.md`.

## Product boundary for the first complete release

A **single-cafe, internally configurable, role-based operational system** that
ordinary (non-technical) staff can configure and operate without code or SQL.
The data model supports multiple branches; branch-franchise management,
advanced accounting integrations, predictive analytics and cosmetic polish are
deferred until core gates pass.

## Stage order and dependency chain

| Stage | Prompt | Depends on | Deliverable |
|---:|---|---|---|
| 0 | Baseline & split-brain stop | none | Exact runtime link, defect ledger, fixtures, verified backup |
| 1 | DEMO/LIVE modes + first-run onboarding | 0 | Blank-live startup, resumable no-code wizard |
| 2 | Configuration Center, staff/RBAC, simulation viewer | 1 | Internal administration without coding |
| 3 | Catalog, recipes/BOM, units/costs | 1–2 | Canonical menu + production definitions |
| 4 | Opening stock / first purchase, suppliers, expenses | 1–3 | Safe initial inventory + supply cycle |
| 5 | Tables, POS, discounts, payments, receipts | 2–4 | Safe hospitality & settlement workflow |
| 6 | KDS, waiter/runner, shifts/EOD, reporting | 2–5 | Full morning/night operating cycle |
| 7 | Update packages, backup/restore, usability | 0–6 | Safe internal updates |
| 8 | Integrated acceptance + repair loop | 0–7 | Evidence-based pilot/release decision |

**Rule:** one prompt at a time; do not advance while a stage gate is FAIL or
BLOCKED. Every prompt begins and ends by printing repository path, commit SHA,
build ID, schema/migration version, service-worker version, environment mode,
database/fixture identity, process start time and port — all now served by
`/api/build-info` (repaired in this stage).

## Non-negotiable safety decisions (unchanged)

1. Demo/test data never covertly mixed with live data; persistent DEMO labeling.
2. No covert dummy identity — server-enforced `DEMO_VIEWER`/`READ_ONLY_SIMULATION`.
3. No arbitrary code uploads via UI; signed, versioned update packages only.
4. Money, stock, payments, payroll, EOD remain server-authoritative.
5. Nothing financial is silently simulated in LIVE mode.

## Current status

- Stage 0 **complete** on 2026-08-26 at commit `5cd54d94…` — see
  `artifacts/release-gate.json` and `docs/defect-ledger.md`.
- Two open findings must be repaired before Prompt 1 sign-off:
  `NEW-PROV-01` (migration 028 file missing from repo) and `NEW-TEST-01`
  (`npm run test:security` standalone isolation failure).