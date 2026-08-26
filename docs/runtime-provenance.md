# Runtime Provenance (Prompt 0 — verified 2026-08-26)

## The split-brain problem, and how it was stopped

Before this stage, the browser-served process reported build
`build-6ef42d71-v2` / migration `026` while the checkout HEAD was
`5cd54d94…`, the migrations directory contained up to `027`, and the live
database had applied `028`. Three different "versions of truth" existed at
once. This is the exact failure mode that made prior agent claims unverifiable.

## How identity is now proven

1. **Single source per fact**
   - Commit/branch/repo: read from git at process start (`getGitMetadata()`).
   - Schema/migration version: read from the **applied** `schema_migrations`
     table of the active database, with checksum and a source flag
     (`database` vs `directory-fallback`). Directory listing is fallback only.
   - Service worker: parsed from the served `public/sw.js` content
     (`CACHE_NAME`) plus its SHA-256.
2. **Browser ≡ checkout proof**: after repairing `src/app.js` and restarting
   the PM2 app `cafe-server`, `GET /api/build-info` returns
   `commitSha == 5cd54d94db0a4feb0555aedc64c9a0d209baa432 == git rev-parse HEAD`.
   Any future drift is caught by `test/unit/build_info.test.js`.
3. **Disclosure safety**: the endpoint exposes no secrets, PINs or raw session
   identifiers (asserted by test).

## Live identity block (post-repair)

```
repository : /home/omrshrifmo/cafe-system-mvp  (origin github.com/omrshrifmo/cafe-system-mvp)
branch     : main
commit     : 5cd54d94db0a4feb0555aedc64c9a0d209baa432
buildId    : build-5cd54d94-v2
schema/mig : 028_analytics_feature.sql / 028  (source=database, checksum 2693aed22ae26742accb4e97e4b7eead)
sw         : cafe-os-v3.1 (sha256 57cb96548fb033563f83c71dfdcff69c3be1c80dab759753b8e3ed191ddd5811)
env        : NODE_ENV=development, appMode=LIVE (.app_mode.json)
database   : cafe.db (fixtureId=null) sha256 a611368bade1076e480b4fb725c3cbf9c62cc0ddf18d8f1fe0b4a90bd32d4e9e
process    : PM2 cafe-server pid 1774901 started 2026-08-26T12:12:40.488Z, port 3000
instanceId : 7eb0091f-0e0c-45cc-8e84-6da65b63d7f6
```

Full pre/post capture: `artifacts/baseline/runtime-identity.txt`.

## Operational rule going forward

Every future prompt must print this identity block at start and end. If the
served build-info does not match the edited checkout's git HEAD, the result is
**BLOCKED**, not PASS. Restart procedure:
`node ~/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart cafe-server`.

## Known provenance defect

`NEW-PROV-01`: migration `028_analytics_feature.sql` is recorded as applied in
the live database but its SQL file is absent from `src/db/migrations/`. Until
the file is recovered/recreated and checksum-reconciled, clean rebuilds cannot
reproduce the live schema byte-for-byte. Tracked FAIL in `docs/defect-ledger.md`.