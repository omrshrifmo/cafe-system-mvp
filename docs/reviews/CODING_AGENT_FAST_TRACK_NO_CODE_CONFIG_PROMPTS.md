# Cafe System — Fast-Track No-Code Configuration and Completion Prompt Series

**Purpose:** Give the coding agent a shorter, dependency-ordered path to a usable and safe cafe system that ordinary staff can configure and operate internally without coding.

**Important status clarification:** The existing live runtime has previously failed critical production gates. This package reduces scope and removes unnecessary enterprise polish from the first milestone, but it does **not** permit the agent to declare the system ready until the mandatory gates pass. The goal is to finish faster by building one coherent configuration and operations spine, not by hiding failures or skipping financial controls.

## How to use this package

Send **one prompt at a time**. The coding agent must implement only that stage, run the stage gate, show the exact command output and browser evidence, and return the required handoff. Do not send the next prompt while the current gate is `FAIL` or `BLOCKED`. Use the repair loop in Prompt 8 when necessary.

The coding agent must work on the exact checkout that serves the browser. At the beginning and end of every prompt it must print the repository path, commit SHA, build ID, schema/migration version, service-worker version, environment mode, database/fixture identity, process start time, and port. If these do not match the browser-served process, the result is `BLOCKED`, not `PASS`.

## Fast-track product boundary

The first complete release is a **single-cafe, internally configurable, role-based operational system**. It must support multiple branches in the data model, but branch-franchise management, advanced accounting integrations, predictive analytics, and cosmetic refinements are deferred until the core gates pass.

| Priority | Must work before pilot | Can follow after pilot |
|---|---|---|
| P0 | First-run setup, demo/live isolation, staff/RBAC, no-code master data, opening stock or first purchase, recipes/BOM, POS quote/settlement, tables, KDS, waiter/runner, cash/tips/splits, shifts/EOD, inventory and report reconciliation, audit, backup/restore, package update | Advanced forecasting, multi-branch consolidation, complex promotions, deep BI modeling, external accounting integrations |
| P0 | No default live seed, no hidden fake live data, no raw SQL errors, no false green/zero masking, no session/logout/lock failures | Visual redesign, optional loyalty campaigns, optional customer messaging |
| P1 | Simple guided workflows, search-first data entry, Arabic/English labels, clear retry/error/empty states, responsive POS/tablet/KDS use | Advanced drag-and-drop customization |

## Non-negotiable safety decisions

1. **Demo/test data must never be covertly mixed with live data.** Demo mode has a persistent `DEMO` label and a separate tenant/database/fixture identity. Live mode has no demo users, fake balances, fake sales, fake inventory, or simulated successful payments.
2. **Do not create a covert dummy identity.** Implement a server-enforced `DEMO_VIEWER` or `READ_ONLY_SIMULATION` account class that sees only a clearly separated fictional dataset. The owner/admin audit view may identify the account and mode. Do not mislead an employee, auditor, or regulator about whether data is real.
3. **Do not allow arbitrary code uploads through the UI.** The one-file update feature must accept a signed, versioned package containing approved configuration schemas, translations, assets, migrations, and feature metadata. It must reject executable scripts, unsigned packages, incompatible schemas, downgrade attempts, and packages that bypass migration/backup checks.
4. **Money, stock, payments, payroll, and EOD remain server-authoritative.** The browser may propose intent; it may not choose totals, tax, discounts, actor, shift, stock, settlement status, or report values.
5. **A purchase, stock count, expense, payment, payroll post, or EOD close must never be silently simulated in LIVE mode.** If a provider is unavailable, display `PENDING`, `UNKNOWN_REQUIRES_RECONCILIATION`, or `BLOCKED` as appropriate.

## Dependency order

| Stage | Prompt | Depends on | Deliverable |
|---:|---|---|---|
| 0 | Baseline and fast-track scope | None | Exact runtime link, defect ledger, fixtures, backup |
| 1 | Demo/live and first-run onboarding | 0 | Blank-live startup and resumable no-code wizard |
| 2 | Configuration center, staff, roles, dummy viewer | 1 | Internal administration without coding |
| 3 | Catalog, recipes, BOM, costs, units | 1–2 | Canonical menu and production definitions |
| 4 | Opening stock, purchasing, suppliers, expenses | 1–3 | Safe initial inventory and supply cycle |
| 5 | Tables, POS, discounts, payments, receipts | 2–4 | Safe hospitality and settlement workflow |
| 6 | KDS, waiter/runner, shifts, EOD, reporting | 2–5 | Full morning/night operating cycle |
| 7 | Update package, backup, recovery, usability | 0–6 | Safe internal updates and operational readiness |
| 8 | Integrated acceptance and repair loop | 0–7 | Evidence-based pilot/release decision |

---

# Prompt 0 — Establish the fast-track baseline and stop the split-brain runtime

```text
You are the principal engineer responsible for making the Cafe System internally configurable and safe for non-technical cafe staff. Do not begin feature work until the exact code served by the browser is identified.

Read these files before changing behavior:
- BROWSER_ENTERPRISE_QA_REVIEW_AFTER_AGENT4.md
- BROWSER_FULL_DAY_TRIAL_REVIEW_AFTER_FINISH.md
- AGENT_CLAIM_AUDIT_AFTER_ATTACHMENTS_8_9.md if present
- browser_qa_notes_round3.md
- CODING_AGENT_RELEASE_GATES.md
- CODING_AGENT_FINANCIAL_CONTROLS.md
- CODING_AGENT_PROMPT_SERIES_COMPLETE_SYSTEM.md

Print and save:
- absolute repository path, remote, branch, commit SHA, dirty status
- Node/npm versions and package scripts
- process manager, process ID, port listener, start time
- browser build-info response
- environment mode, database/fixture identity, schema and migration checksums
- service-worker version/hash
- all existing test commands and their actual exit codes

Create or update:
- docs/fast-track-scope.md
- docs/current-state.md
- docs/runtime-provenance.md
- docs/configuration-boundary.md
- docs/defect-ledger.md
- artifacts/baseline/runtime-identity.txt
- artifacts/baseline/database-integrity.json
- artifacts/baseline/backup-manifest.json
- artifacts/release-gate.json

Create isolated fixtures:
- fixtures/clean.sqlite
- fixtures/demo-normal.sqlite
- fixtures/demo-low-stock.sqlite
- fixtures/concurrency.sqlite
- fixtures/offline.sqlite

The LIVE database must not be used for destructive tests. Take a checksum-verified backup and restore it into a separate file. Record row counts, monetary totals, stock totals, and migration checksums before and after.

Repair build-info so the browser response and a response header expose build ID, commit SHA, branch, schema version, migration version, service-worker version, environment mode, database/fixture identity, process start time, and server instance ID. Do not expose secrets or raw session IDs.

Gate:
- The browser runtime and edited checkout are provably identical.
- The live database is not a test fixture and is not mutated by the test suite.
- Clean and demo fixtures are isolated and reproducible.
- Backup restore succeeds into a separate file.
- Every prior P0 defect remains in the ledger with PASS, FAIL, or BLOCKED status.

Return the exact identity block, changed files, commands, exit codes, fixture paths, backup hashes, and gate status. If identity or isolation cannot be proven, return BLOCKED and stop.
```

# Prompt 1 — Server-enforced DEMO/LIVE modes and blank first-run onboarding

```text
Implement a server-enforced mode and onboarding lifecycle for ordinary cafe staff. Do not pre-setup the live system with cafe-specific data.

Modes:

DEMO/TEST:
- Use an isolated demo tenant/database/fixture.
- Show a persistent DEMO banner on every screen, receipt, export, report, and simulated KDS event.
- Provide optional fictional scenarios: empty cafe, normal day, low stock, reservation conflict, printer failure, payment unknown, offline queue, payroll period, and report exception.
- Show that sales, inventory, expenses, and customers are fictional. Use a visible fixture ID.
- Demo reset requires authorized admin reauthentication and typed confirmation, and cannot touch LIVE.
- Disable real payment capture, cash-drawer kick, live printer, SMS, email, and customer notification. Simulated outcomes must say SIMULATED.

LIVE/PRODUCTION:
- Start blank except for the minimum system bootstrap required to create the first owner/admin.
- Do not include default staff PINs, fake cafe data, fake purchases, fake balances, demo menu items, or simulated successful payments.
- Require owner/admin confirmation, recent reauthentication, backup confirmation, mode confirmation, timezone/currency confirmation, and readiness checks before activation.
- Record an immutable cutover event with operator, time, build, schema, migration, database identity, backup checksum, and rollback plan.

First-run wizard:
1. Select DEMO or LIVE and explain the consequences in simple Arabic/English.
2. Create the first owner/admin account securely.
3. Enter cafe name, logo, address, contact details, timezone, currency, business date, tax, service charge, rounding, operating hours, and receipt identity.
4. Add branches/venues if needed; default single cafe must be simple.
5. Add stations and devices: cashier/POS, Barista, Shisha, Chef, Waiter, Runner, Hall, Inventory, HR, QA, Admin.
6. Choose the startup path: `Opening stock count` or `First purchase receiving`.
7. Configure morning/night shifts, opening float, EOD policy, expenses, payroll period, tips, loyalty, reservations, and quality workflow.
8. Run a readiness checklist and publish the configuration.

Every step must support save/resume, back, cancel, validation, clear completion state, retry, request ID, Arabic/English text, and a final summary. Incomplete setup must not expose misleading operational controls.

Gate:
- A fresh clean fixture can complete onboarding without coding or direct SQL.
- Refreshing, direct URLs, APIs, WebSocket handshakes, exports, and background jobs cannot bypass mode enforcement.
- Demo reset never changes LIVE.
- Live mode is not populated with demo data or default credentials.
- Interruption/resume does not duplicate cafe, owner, device, policy, or configuration rows.
```

# Prompt 2 — No-code Configuration Center, staff, roles, access, and simulation viewer

```text
Build one simple Configuration Center for non-technical administrators. Staff must configure the cafe through forms, tables, guided choices, and import templates—not code or SQL.

Configuration areas:
- Cafe identity, branches, stations, devices, printers, cash drawers, payment methods, tax/service charge, currency, rounding, receipt template, business-date policy, operating hours, morning/night shifts, EOD, expenses, payroll, tips, loyalty, reservations, quality, inventory, and notification policies.
- Effective-dated policy versions. Historical orders, purchases, stock, payroll, and reports retain the policy version used.
- Preview impact before publishing. Tax, price, discount, cash, payroll, mode, reset, and accounting-policy changes require permission and recent reauthentication.
- Every change records before/after values, actor, device, timestamp, reason, request ID, and configuration version.

Staff and roles:
- Secure owner/admin bootstrap, user lifecycle, disabled users, credential rotation, PIN hashing, rate limiting, session revocation, logout, recent reauthentication, and device/session visibility.
- Define and enforce least-privilege bundles for Owner, Super Admin, Operations Manager, Operations Assistant, Cashier, Barista, Chef, Shisha, Waiter, Runner, Hall Manager, Inventory/BOM Manager, HR/Payroll, QA, and reporting users.
- Separate view, create, edit, approve, post, settle, refund, void, reopen, export, configure, reset, and administer permissions.
- Scope by venue, station, department, shift, device, and sensitive data.
- Implement a 15-second inactivity lock by default and a working manual lock button. Lock the view immediately and require server reauthentication for sensitive actions. Logout must revoke the server session, clear private caches, close realtime connections, and make `/api/auth/me` immediately return AUTH_REQUIRED.
- After relogin, offer the last safe route plus a visible “new updates available” notice when build, permission, shift, or data versions changed. Never restore unauthorized or stale work.

Simulation viewer:
- Add a server-enforced account class `DEMO_VIEWER` or `READ_ONLY_SIMULATION`.
- It can only view an isolated fictional dataset with less sales, less inventory, and more expenses than the normal demo scenario.
- It cannot create, edit, approve, post, settle, print, open a drawer, export sensitive data, change settings, inspect real customer/staff data, or access LIVE APIs.
- All fake rows carry a fixture/tenant identity. The owner/admin audit view must identify the account and simulation mode; do not covertly disguise it from authorized oversight.
- If the user is shown the simulation screen, label it clearly as simulated/read-only.

Gate:
- Every private page, API, export, WebSocket, printer, drawer, job, and setup operation is default-deny.
- Role tests prove allowed and forbidden behavior server-side, not only by hiding buttons.
- Logout, lock, direct URL, stale tab, back button, and revoked-session tests pass.
- Demo viewer cannot read or mutate LIVE data.
- A non-technical tester can create a user, assign a role, change a policy, preview it, publish it, and audit the change without coding.
```

# Prompt 3 — Canonical menu, ingredients, recipes, BOM, waste, costs, and unit conversion

```text
Create one canonical catalog and production-definition layer consumed by POS, QR, receipts, KDS, inventory, EOD, BI, and exports.

Menu administration:
- Customer categories are separate from internal routing departments.
- Items have stable SKU, Arabic/English name, description, availability, tax class, modifiers, allergens, image, sort order, venue scope, lifecycle, and publication version.
- Workflow: draft -> review -> approved -> published -> retired.
- Detect duplicate SKU/name/semantic duplicates, empty legacy categories, invalid routes, missing prices, and missing recipes. Quarantine ambiguity; never silently merge.
- Prices use integer minor units, explicit currency, effective dates, author, reason, approval, publication version, and historical snapshots.
- Offers support eligibility, schedule, venue, customer segment, stacking rules, usage limit, approval, and audit. The server calculates offers.

Ingredients and recipes:
- Every raw material has a canonical base unit, allowed input units, conversion rules, storage location, supplier/cost history, batch/expiry where needed, reorder level, allergen/traceability metadata, and active state.
- Recipes are versioned. A recipe referenced by an accepted order or stock calculation is immutable.
- BOM lines contain ingredient, quantity, unit, yield, preparation loss, station, optional/alternative rule, cost basis, effective date, and recipe version.
- Separate expected BOM, automatic process loss/spill, approved manual waste, returns, and actual consumption.
- Any missing mapping, invalid unit, zero/unpriced ingredient, stale version, or undefined value is UNRECONCILED/ERROR, never green MATCHED.

Units and conversions:
- Use three explicit measurement families: COUNT (`each`, `pack`), MASS (`mg`, `g`, `kg`), and VOLUME (`ml`, `L`). Store a canonical base unit in the ledger.
- Countable materials remain count-based unless an approved packaging conversion exists. Non-liquids remain in g/kg or count.
- Liquids remain in ml/L for stock and recipes. Allow a staff member to enter a liquid purchase/count by weight in grams, but convert using an ingredient-specific density record: `volume_ml = mass_g / density_g_per_ml`. Do not use a universal grams-to-ml conversion.
- Store density source, temperature/condition if relevant, effective date, uncertainty/approval, and who configured it. Permit an authorized calibration/override with reason and audit.
- Show staff a simple input selector: “I counted by pieces / grams / kilograms / milliliters / liters.” Display the converted canonical amount and the conversion explanation before posting.
- Reject incompatible or ambiguous conversions. Do not silently convert flour, cups, bottles, milk, oil, and water with one generic factor.

Costing:
- Choose and document one approved cost method, such as weighted average. Preserve purchase lot/cost history and recipe cost snapshots.
- Ingredient cost, expected BOM cost, actual consumption cost, waste cost, and gross-margin calculations must be reproducible.

Gate:
- POS, QR, Menu Manager, KDS, inventory, receipt, EOD, BI, and exports use the same published catalog/version.
- Duplicate and missing definitions are visible and block publication where required.
- Test count-by-piece, count-by-gram, liquid-by-ml, liquid-by-gram with density, and invalid conversion cases.
- Expected BOM versus actual BOM, automatic waste, manual waste, yield, and cost reconcile exactly.
```

# Prompt 4 — Start with purchase or stocktake; suppliers, receiving, stock, expenses, and indirect costs

```text
Implement the fast opening workflow and ledger-based inventory for non-technical staff.

Startup choice:
- On first setup, offer two clear buttons: `Start with opening stock count` and `Start with first purchase`.
- Both paths require venue, business date, actor, device, source reference, currency, and review before posting.
- Opening stock is an auditable opening-balance event, not an invisible seed. A draft count or draft purchase does not change stock.

Stocktaking:
- Search/barcode-friendly list with category, storage location, current expected balance, last count, unit selector, and variance display.
- Support partial counts, blind counts if configured, count by pieces, grams, kilograms, milliliters, liters, and approved density conversion for liquid weighed by gram.
- Flow: start -> draft -> count -> review -> post -> locked. Reopen requires permission, reason, and audit.
- Capture expected quantity, counted quantity, variance, unit/conversion, batch/expiry, counter, reviewer, time, location, reason, request ID, and idempotency key.
- Never hide variance; never make a negative or missing balance look like zero or green.

Purchasing/suppliers:
- Supplier master with name, contacts, tax/payment terms, status, items, price history, lead time, minimum order, documents, and audit.
- Purchase states: draft -> submitted -> approved -> partially received -> received -> closed -> reversed.
- Require supplier, invoice/GRN/reference, venue/location, date, currency, lines, units, quantities, unit costs, tax, server-calculated total, attachments, actor, approval, and idempotency.
- Receiving posts stock exactly once. A retry or duplicate invoice cannot double stock/cost. Reversal is append-only.

Inventory ledger:
- Append-only events for opening, purchase receipt, BOM consumption, automatic spill/waste, approved waste, transfer, count, adjustment, return, and reversal.
- Balance equals the ledger sum. Every balance has a drill-down to source events. Negative stock is blocked or explicitly escalated according to policy; it is never a false success.

Expenses/utilities/indirect costs:
- Support rent, electricity, water, gas, internet, maintenance, supplies, delivery, bank/payment fees, subscriptions, and other approved expenses.
- Utility bill requires vendor, billing period, due date, meter/reference if applicable, amount/currency, tax, attachment, approval, payment status, and allocation.
- Separate direct product cost, direct operating cost, and indirect cost. Indirect allocation uses a versioned policy such as revenue, covers, hours, area, or consumption. Unallocated costs remain visible as UNALLOCATED; never invent an allocation.

Gate:
- A non-technical staff member can create a supplier, record a draft purchase, receive it once, and see the stock ledger change.
- A stock count can be drafted, reviewed, posted, and reconciled in the selected unit.
- Duplicate receive, retry, invalid units, missing supplier, zero cost, and unauthorized posting are rejected safely.
- Expected stock versus actual stock, expected BOM versus actual BOM, purchase cost, waste, and indirect expenses reconcile.
```

# Prompt 5 — Hall, tables, POS, manager discounts, tips, split payments, receipts, and drawer safety

```text
Implement the safe hospitality and sales path. This stage is release-blocking.

Tables and hospitality:
- Table map with area, number, internal custom name, capacity, position, QR token, status, assigned waiter, customer linkage, opened time, elapsed time, order value, order count, turnover, and version.
- Server-controlled states: AVAILABLE, HELD, OCCUPIED, ORDER_OPEN, REQUESTED_CHECK, PAYMENT_PENDING, PAID_PENDING_CLEAR, CLEANING, OUT_OF_SERVICE.
- Opening a table captures table, people count, time, optional internal name, optional known customer, actor, device, and idempotency. Two devices cannot claim the same table.
- Waiter assist suggests a visit after the configured 30–45 minute no-new-order interval, showing table, elapsed time, prior order context, and recommended service actions. It must not pressure a customer or auto-add an order.

POS and quote:
- Staff selects table/customer/order context and menu items/modifiers. The server loads current published prices, tax, service, offers, policy, and recipe versions.
- Quote is calculated in integer minor units and includes line snapshots, subtotal, approved discount, service, tax, tip, total, currency, versions, rounding, expiry, request ID, and idempotency.
- Never trust browser totals, prices, tax, discount amount, actor IDs, table IDs, or settlement status.

Manager discounts:
- Create policy-controlled discount profiles for Operations Manager and Operations Assistant only, with explicit permission `pos.discount.apply.custom`.
- Configure percentage/fixed caps, eligible items, time/venue limits, daily/user limits, stacking rules, minimum order, required reason, and optional supervisor approval through the Configuration Center.
- Cashier can see that a discount requires manager authorization but cannot apply a custom manager discount from a forged role or hidden field. The server checks the authenticated actor and policy.
- Every discount records actor, approving actor if applicable, rule version, reason, amount, order, device, time, and request ID. Never allow a discount to make the total negative.

Settlement:
- Accept only order/version, intended payment method, amount allocation, external reference, tip, and idempotency key. Recompute the quote in one transaction.
- Support cash exact/overpayment/change, Visa/card, wallet, InstaPay, failed, timeout, unknown, split payments, and tips on cash or non-cash methods.
- Unknown payment is UNKNOWN_REQUIRES_RECONCILIATION, never PAID. Duplicate keys return the original result; changed payload with the same key is IDEMPOTENCY_MISMATCH.
- One accepted settlement produces one payment set, one receipt, one BOM consumption set, one logical outbox event set, one audit set, and one loyalty award.

Receipts and drawer:
- Configurable receipt template includes cafe identity, reference, table, items, quantities, prices, discounts, tax, service, tips, total, payment allocation, change, currency, business date/timezone, versions, and settlement status.
- Printing is durable, retryable, deduplicated, and dead-lettered. Reprint does not create a sale.
- Cash drawer kick only happens after confirmed cash settlement. Digital payments never kick the drawer. Printer/drawer failure must not show false success.

Gate:
- Use a clean DEMO fixture for the test sale; do not settle a live/shared sale.
- Verify table open, waiter order, quote, manager discount, tip, cash change, digital tip, split payment, receipt preview, print failure, retry, duplicate click, and table clear.
- Reconcile order, quote, payment, receipt, tips, cash, inventory/BOM, KDS event, loyalty, EOD, and audit exactly.
```

# Prompt 6 — KDS, waiter/runner, CRM/loyalty, shifts, morning/night EOD, and reporting

```text
Link the operational floor and day-management cycle to the authoritative sales, inventory, cash, and audit ledgers.

KDS and floor:
- Route order lines to Barista, Shisha, or Chef from canonical item routing and modifiers.
- States: NEW, ACKNOWLEDGED, IN_PROGRESS, READY, PICKED_UP, SERVED, CANCELLED. Each transition needs authenticated actor, station, device, version, and timestamp.
- Waiter/Runner receives ready notifications, claims pickup, delivers to the correct table, handles assistance requests, and completes the handoff once. Two devices cannot claim or complete the same task.
- Realtime clients show CONNECTED, DEGRADED, RECONNECTING, OFFLINE, STALE, and last event/cursor. Reconnect replays from a cursor or loads a snapshot. No manual refresh may be required for an accepted event.
- If realtime is down, use visible polling/degraded mode. Never claim payment, stock receipt, payroll, or EOD success offline.

CRM and loyalty:
- Customer assignment is optional and consent-based. Mask sensitive data by default.
- Loyalty earns/redeems only after authoritative accepted settlement, exactly once, with policy/version/audit. Failed or unknown payments earn nothing.
- Reservations prevent conflicts and link customer/table/party size/timezone/business date.

Shifts and day management:
- Server-authoritative morning and night shifts with venue, business date, opening float, assigned staff, device, opened/handed-over/closed state, and immutable cash events.
- Morning close and night close are separate declarations bound to the correct shift/business date. A cashier must not see expected cash if blind-close policy requires blindness.
- Handover records outgoing/incoming staff, counted cash, pending orders, open tables, KDS tasks, stock exceptions, printer/payment exceptions, notes, actor, time, and approval.
- EOD computes expected cash from one immutable shift scope: opening float + cash sales + approved cash inflows - approved cash expenses - cash refunds/returns, with tips and drawer transfers separately visible according to policy.
- Counted cash, variance, payment methods, tips, discounts, expenses, stock movement, BOM, payroll inputs, and report totals must reconcile. Closing is blocked on unresolved unknown payments or critical mismatches unless an authorized exception is documented.

Reports/BI:
- Dashboard/report failure must show an error with request ID, not zero sales or empty success.
- Reports must carry venue, business date, shift, currency, policy/catalog versions, source event counts, reconciliation status, and last updated time.
- Portal, EOD, BI, inventory, payroll, and shareholder summaries must reconcile to source events. Department totals cannot exceed total revenue.

Gate:
- In an isolated DEMO fixture, run a morning and night shift with representative tables and linked orders without writing to LIVE.
- Verify order creation -> KDS -> ready -> runner -> served -> quote -> cash/card/split/tips -> receipt -> BOM/stock -> audit -> EOD.
- Verify morning close, handover, night open, night close, expected cash, counted cash, stock, payroll inputs, and reports.
- Verify concurrent KDS/table/payment attempts, disconnect/reconnect, replay, duplicate commands, and unresolved-payment handling.
```

# Prompt 7 — One-file internal update packages, backup, restore, and simple usability

```text
Implement a safe update mechanism that allows an authorized non-technical administrator to load and choose one approved package file through the UI, without recoding the application.

Package format:
- Versioned archive with manifest: package ID, semantic version, compatibility range, build/commit, schema target, migrations, service-worker version, translations/assets, configuration schema versions, checksum, signature, release notes, required backup, and rollback metadata.
- Only approved package types are accepted. Reject arbitrary executable code, unsigned packages, incompatible versions, malformed migrations, downgrade attempts, duplicate package IDs, and packages that target the wrong environment.
- Verify signature/checksum before inspection. Show a plain-language summary of changes and affected modules.

Update flow:
1. Admin uploads/selects the package.
2. System validates signature, checksum, compatibility, available disk space, current mode, active sessions, and backup status.
3. System displays a dry-run migration/configuration impact report and requires recent reauthentication and typed confirmation.
4. System creates a verified backup and records its checksum.
5. System applies migrations transactionally with schema checksum tracking.
6. System updates static assets/service worker with cache versioning and safe rollback.
7. System health-checks API, auth, database, reports, printing, realtime, and critical configuration.
8. System marks the package ACTIVE only after checks pass; otherwise it rolls back or leaves the system visibly in UPDATE_FAILED/RECOVERY_REQUIRED.
9. The UI shows current version, last update, backup, migration status, release notes, and rollback option.

Usability:
- Search-first lists, sensible defaults, large touch targets, Arabic/English labels, simple vocabulary, inline validation, autosave drafts, clear required fields, visible loading/empty/error/timeout/offline/stale/queued/rejected/conflict/success states, finite retries, and no silent no-op buttons.
- Test 320, 375, 390, 768, 1024, 1366, and 1920 widths plus 200% zoom, keyboard navigation, RTL overflow, and KDS wall layout. Record actual evidence; do not claim every device is covered from one browser.
- Cache only safe public/static content. Never cache private financial data or credentials. Offline commands are explicit, authenticated, idempotent, durable, and never falsely settle money.

Gate:
- A non-technical admin can upload/select a signed package, preview it, back up, apply it, and see the result without coding.
- Invalid, unsigned, incompatible, duplicate, failed, and interrupted updates recover safely.
- Backup restore is proven in an isolated file.
- Refresh and service-worker update do not serve stale private data or old route contracts.
```

# Prompt 8 — Integrated acceptance, evidence package, and repair loop

```text
Run the final acceptance only against the exact browser-served build and an isolated deterministic DEMO fixture. Never use LIVE for destructive or financial tests.

Execute and save:
- clean setup from blank state
- DEMO onboarding and DEMO_VIEWER read-only scenario
- LIVE onboarding readiness without fake seed data
- cafe configuration, owner/admin, staff, roles, permissions, lock, logout, resume, and updates
- menu/categories/items/prices/offers/modifiers
- ingredients, recipes, instructions, BOM, yields, spills/waste, costs, density conversions
- opening stock count path and first-purchase path
- suppliers, purchase draft/approve/receive/reverse, expenses, utilities, indirect costs
- hall/table map, custom table names, people count, customer assignment, reservations, CRM, loyalty
- morning shift with representative tables, waiter order, Barista/Shisha/Chef KDS, Runner, service, waiter assist, receipt, cash/card/split/tips/change, manager discount
- automatic BOM, expected versus actual BOM, expected versus actual stock, expected versus actual cash
- morning close, handover, night open, night shift, night close, full-day reports, payroll inputs, quality/complaints, shareholders
- realtime two-client behavior, disconnect/reconnect, offline safe queue, printer failure, payment unknown, restart, backup/restore, and package update

For every workflow record:
- expected result
- actual result
- actor/role/device/venue/shift/business date
- request ID/idempotency key
- source event IDs
- before/after balances
- response status and error code
- screenshot or machine-readable evidence path
- PASS, FAIL, or BLOCKED

Required invariants:
- one accepted order = one settlement/payment set, one BOM consumption set, one logical outbox set, one loyalty award, and one audit set
- source-ledger sum = displayed inventory and cash balances
- expected BOM/stock/cash = actual values plus explicitly documented variance
- EOD payment totals = payment ledger totals
- department revenue sum <= and reconciles to total revenue
- approved expenses and indirect allocation reconcile to source expenses
- unknown payment never becomes paid without reconciliation
- demo data never appears in LIVE
- no raw SQL/stack traces/secrets/session IDs/PINs in client responses or logs

Automatic NO-GO conditions:
- browser build cannot be tied to tested commit/database/schema
- any live mutation is used to make tests green
- logout or server session revocation fails
- manual/automatic lock fails
- any role can bypass server authorization
- POS, quote, settlement, receipt, EOD, inventory, BOM, payroll, or report contract is missing/broken
- any negative/zero-masked/undefined/false-green financial or stock state
- any unknown payment is shown as paid
- any test is skipped, mocked as success, deleted, or lacks final exit code
- any update can execute arbitrary uploaded code or leaves an unrecoverable migration/cache state

Return a final evidence index, complete test output with exit codes, exact runtime identity, fixture checksum, database/backup hashes, invariant results, unresolved defects, and a truthful release decision. “All fixed,” “production-ready,” or “bug-free” without this evidence is not an acceptable handoff.
```

## Repair loop — send instead of advancing after any failure

```text
The previous stage is not accepted. Do not add unrelated features and do not change the database to hide the failure.

1. Quote the exact failed gate, request ID, fixture/database identity, actor, device, build, schema, and migration.
2. Reproduce the failure in a new isolated fixture.
3. Identify the smallest root cause in code/schema/configuration/routing/cache/process provenance.
4. Add a regression test that would fail before the fix.
5. Implement the fix with a transactional migration if needed; preserve posted history and use reversals/quarantine for ambiguous data.
6. Re-run the failed test, the full dependent suite, and the browser check against the same build.
7. Compare expected versus actual source events and balances.
8. Return PASS only when the failed gate and all dependent invariants pass. Otherwise return FAIL or BLOCKED with the exact next action.

Never use a hidden role, special query parameter, localStorage flag, direct SQL cleanup, fake API response, disabled assertion, skipped test, or demo data in LIVE to make a gate green.
```

## Definition of “ready for the staff pilot”

The system is ready for a controlled staff pilot only after Prompt 8 passes on an isolated DEMO fixture and a separate LIVE readiness checklist proves blank-live onboarding, no default credentials, backup/restore, server authorization, session/logout/lock, and no fake data. A pilot is not the same as unrestricted production: payment-provider certification, printer/drawer hardware tests, load tests, disaster-recovery rehearsal, security review, and a monitored observation period remain required before declaring full production readiness.

## References

[1]: `CODING_AGENT_PROMPT_SERIES_COMPLETE_SYSTEM.md` — prior linked implementation and acceptance prompt package.  
[2]: `CODING_AGENT_RELEASE_GATES.md` — mandatory release gates and NO-GO triggers.  
[3]: `CODING_AGENT_FINANCIAL_CONTROLS.md` — safe quote, settlement, cash, inventory, payroll, EOD, and reconciliation controls.  
[4]: `BROWSER_ENTERPRISE_QA_REVIEW_AFTER_AGENT4.md` — prior independent browser NO-GO review.  
[5]: `BROWSER_FULL_DAY_TRIAL_REVIEW_AFTER_FINISH.md` — prior full-day trial limitations and evidence.  
[6]: `AGENT_CLAIM_AUDIT_AFTER_ATTACHMENTS_8_9.md` — audit of the latest coding-agent claims.  
[7]: `https://github.com/omrshrifmo/cafe-system-mvp` — repository supplied by the user.
