# Cafe System MVP — Runtime Provenance & Environment Integrity

This document establishes the exact cryptographic, process, and architectural identity of the active system runtime.

## 1. Provenance Baseline
- **Repository Location:** `/home/omrshrifmo/cafe-system-mvp`
- **Git Branch:** `main`
- **Git HEAD Commit SHA:** `6ef42d711e8609737df0c32a751a571b6435872e`
- **Node.js Runtime:** `v22.23.1`
- **NPM Version:** `12.0.1`
- **Build ID:** `build-6ef42d71-v2`
- **Service Worker Version:** `cafe-os-v3.1`
- **Live Database File:** `/home/omrshrifmo/cafe-system-mvp/cafe.db`
- **Total Applied Migrations:** 26 (Latest: `026_reporting_bi_indexes.sql`)
- **Port:** `3000` (Listening cleanly on `0.0.0.0:3000`)
- **Server Instance ID:** `a80d4214-6b51-4813-adc9-a349ca66d370`

## 2. Server Response Headers
Every HTTP response from the application server includes the following identity headers:
- `X-Build-Id`: `build-6ef42d71-v2`
- `X-Commit-Sha`: `6ef42d711e8609737df0c32a751a571b6435872e`
- `X-Branch`: `main`
- `X-Repository`: `omrshrifmo/cafe-system-mvp`
- `X-Schema-Version`: `026_reporting_bi_indexes.sql`
- `X-Migration-Version`: `026`
- `X-Service-Worker-Version`: `cafe-os-v3.1`
- `X-Environment-Mode`: `development`
- `X-Database-Identity`: `cafe.db`
- `X-App-Mode`: `LIVE` | `DEMO` | `ONBOARDING`

## 3. Isolated Fixtures Catalog
- `fixtures/clean.sqlite` — Clean, empty schema after 26 migrations with zero operational rows.
- `fixtures/demo-normal.sqlite` — Deterministic 2-shift golden dataset with 12 menu items, 12 raw materials, healthy inventory, 21 tables, 2 shifts, and expenses.
- `fixtures/demo-low-stock.sqlite` — Demo dataset configured with low stock levels for espresso beans, milk, and shisha tobacco to test reorder alerts and purchase flows.
- `fixtures/concurrency.sqlite` — High-stock stress fixture for concurrent order placement, settlement, and stock deductions.
- `fixtures/offline.sqlite` — Dedicated fixture for offline sync batch commands and idempotency validation.
