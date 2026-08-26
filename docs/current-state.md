# Current State (as of Prompt 0 completion — 2026-08-26)

## Runtime identity (live, verified)

| Item | Value |
|---|---|
| Repository | `/home/omrshrifmo/cafe-system-mvp` |
| Remote | `https://github.com/omrshrifmo/cafe-system-mvp.git` |
| Branch / HEAD | `main` @ `5cd54d94db0a4feb0555aedc64c9a0d209baa432` |
| Build ID served to browser | `build-5cd54d94-v2` (== HEAD, proven post-restart) |
| Process manager | PM2 v7.0.3, app `cafe-server`, PID 1774901, port 3000 |
| Environment mode | `development` (NODE_ENV), appMode `LIVE` via `.app_mode.json` |
| Database | `cafe.db` (LIVE-named; fixtureId null) |
| Applied migration (DB truth) | `028_analytics_feature.sql` (checksum `2693aed2…`) |
| Migrations in repo | 001–027 (**028 file missing** → NEW-PROV-01) |
| Service worker | `cafe-os-v3.1`, sha256 `57cb9654…` |

## What works today (evidence-based)

- **Provenance**: `/api/build-info` exposes build/commit/branch/schema/migration
  (database-sourced with checksum + source flag), SW version+hash, env mode,
  database identity, process start time, server instance id — body and `X-*`
  headers; no secrets or session IDs. Locked by regression tests.
- **Canonical test suite**: `npm test` = 39/39 suites, 296 tests, exit 0.
- **Live-DB safety**: cafe.db SHA unchanged across fixture generation and the
  full suite; mutation guard active; backup restored into a separate file with
  exact metric parity (103 tables / 6439 rows / 28 migrations).
- **Fixtures**: clean, demo-normal, demo-low-stock, concurrency, offline
  regenerated with checksums (`artifacts/fixtures/fixture_manifest.json`).
- Historical P0s DEF-004..DEF-011 verified green by today's suites.

## What is broken / open

| Finding | Severity | Status |
|---|---|---|
| Migration `028_analytics_feature.sql` applied in live DB but absent from repo | P0 | FAIL — repair before Prompt 1 sign-off |
| `npm run test:security` standalone fails (exit 48) from cross-suite state pollution | P1 | FAIL — canonical `npm test` unaffected |
| Logout revocation & lock overlay browser verification | P0 | BLOCKED — needs interactive session on isolated fixture (Prompt 2/8) |
| `format:check`, `typecheck`, `audit:production` are placeholder echo scripts | P1 | Known gap vs release-gate CI requirements |

## Not started

Prompts 1–8 of the fast-track series (modes/onboarding, configuration center,
catalog/BOM, inventory/purchasing, POS/settlement, KDS/EOD, update packages,
integrated acceptance). No feature work has begun; this stage only established
the verifiable baseline.

## Key artifacts

- `artifacts/baseline/runtime-identity.txt` — pre/post-repair identity
- `artifacts/baseline/database-integrity.json` (+ `-restored.json`) — metrics
- `artifacts/baseline/backup-manifest.json` — backup sha256 + parity
- `artifacts/baseline/test-command-results.txt` — every command + exit code
- `artifacts/fixtures/fixture_manifest.json` — fixture checksums
- `artifacts/release-gate.json` — honest gate statuses
- `docs/defect-ledger.md` — all defects with PASS/FAIL/BLOCKED