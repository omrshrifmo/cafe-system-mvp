# Configuration Boundary (Prompt 0)

This document defines what may be changed through configuration versus what is
code/schema-owned, and the safety rules that apply at the boundary. It will be
extended by Prompt 1 (modes/onboarding) and Prompt 2 (Configuration Center).

## Layers

| Layer | Owned by | Changed via | Examples |
|---|---|---|---|
| Application code & schema migrations | Repository (git) | Signed update packages / engineering only | Routes, business rules, SQL schema |
| Environment & process | Server operator | PM2/env vars, `.app_mode.json` | NODE_ENV, PORT, app mode LIVE/DEMO |
| Database identity | modeService | Fixture selection at startup | `cafe.db` vs `fixtures/*.sqlite` |
| Cafe configuration data | DB tables (`v3_policies`, config) | Future Configuration Center UI (no code/SQL) | Tax, service charge, currency, receipt identity |

## Boundary rules established at baseline

1. **No configuration through code edits for cafe-specific values.** Cafe name,
   tax/service rates, currency, printer settings etc. live in configuration
   storage; staff must be able to change them via forms (Prompts 1–2), never by
   editing files or running SQL.
2. **Mode enforcement is server-side.** `.app_mode.json` currently holds
   `{"mode":"LIVE"}`. DEMO/LIVE isolation, banner enforcement and reset
   authorization are Prompt 1 deliverables; until then no demo fixture may be
   served on port 3000 against live-named data.
3. **Fixture isolation.** `fixtures/*.sqlite` are the ONLY permitted targets for
   destructive tests; `src/domain/system/mutationGuard.js` blocks writes to
   `cafe.db` from test contexts (verified: live SHA unchanged through the full
   suite).
4. **Provenance is not configurable.** Build/commit/migration/SW identity is
   derived from git + database + file content — it can never be overridden by a
   query parameter, header or client flag.
5. **Sensitive changes require elevated trust** (future): tax, price, discount,
   cash, payroll, mode, reset and accounting-policy changes must demand
   permission + recent reauthentication with before/after audit records
   (Prompt 2 contract).
6. **Placeholders are not controls.** `format:check`, `typecheck` and
   `audit:production` are currently echo placeholders; they satisfy nothing and
   are tracked as gaps against the release-gate CI requirements.

## Current configuration surfaces (as found)

- `.app_mode.json` — application mode (LIVE), updated 2026-08-25.
- `v3_policies` table — venue policy payload (VAT 14%, service 12%, blind
  cashier mode, drawer auto-kick) seeded in fixtures.
- `/api/config` — privileged read of cafe configuration (auth required after
  prior fixes; verified FORBIDDEN for READ_ONLY roles in earlier rounds).
- Printer/drawer hardware settings — present in config payload; production
  hardening (health checks, confirmed-cash kick gating) remains a later-stage
  requirement.

## Out of bounds for non-technical staff (permanent)

- Direct database access, SQL execution, migration manipulation.
- Editing server files, environment variables, or PM2 processes.
- Disabling provenance headers, mutation guards, or audit logging.
- Applying unsigned/unapproved update packages.