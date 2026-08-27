# Runtime Provenance (Prompt 0 — verified 2026-08-27)

## The split-brain problem, and how it was stopped

Before this stage, the browser-served process reported divergent builds and migrations. Now, a single source of truth is established and enforced across all sub-systems.

## How identity is now proven

1. **Single source per fact**
   - Commit/branch/repo: read from git at process start (`getGitMetadata()`).
   - Schema/migration version: read from the **applied** `schema_migrations`
     table of the active database, with checksum and a source flag
     (`database` vs `directory-fallback`).
   - Service worker: parsed from the served `public/sw.js` content
     (`CACHE_NAME`) plus its SHA-256.
2. **Browser ≡ checkout proof**: after restarting the PM2 app `cafe-server`, `GET /api/build-info` returns
   `commitSha == 830e4b1a780bf74e145d96c3bdfb105b794df87c == git rev-parse HEAD`.
   Continuous alignment is asserted by `test/unit/build_info.test.js`.
3. **Disclosure safety**: the endpoint exposes no secrets, PINs or raw session
   identifiers (asserted by test).

## Live identity block (post-repair)

```
repository : /home/omrshrifmo/cafe-system-mvp  (origin https://github.com/omrshrifmo/cafe-system-mvp.git)
branch     : main
commit     : 830e4b1a780bf74e145d96c3bdfb105b794df87c
buildId    : build-830e4b1a-v2
schema/mig : 028_floor_ledger_linking.sql / 028  (source=database, checksum d791e70d209b2c1af1ddd803295dcc7f)
sw         : cafe-os-v3.1 (sha256 57cb96548fb033563f83c71dfdcff69c3be1c80dab759753b8e3ed191ddd5811)
env        : NODE_ENV=development, appMode=LIVE (.app_mode.json)
database   : cafe.db (fixtureId=null) sha256 434bc1901865647dfb2fc03b0eea5874ee0cdf9806b68c576b3218eca69af03e
process    : PM2 cafe-server pid 3143350 started 2026-08-27T05:35:28.267Z, port 3000
instanceId : f813482c-3281-4921-9ef4-13cc2e49b55a
```

Full pre/post capture: `artifacts/baseline/runtime-identity.txt`.

## Operational rule going forward

Every future prompt prints this identity block at start and end. If the
served build-info does not match the edited checkout's git HEAD, the result is
**BLOCKED**, not PASS. Restart procedure: `npx -y pm2 restart all`.