# QA Evidence Map (Round 4)

| ID | Current verified condition (QA) | Required final condition | Code Location | Status |
|---|---|---|---|---|
| P0-01 | POS remains blank even after Ctrl+Shift+R | POS validates and renders canonical menu in a clean profile with caching fixes | `public/pos.html`, `public/sw.js` | Pending |
| P0-02 | POS custom-item entry leaves modal open and cart unchanged | Modal closes, cart updates, safe custom item implementation | `public/pos.html` | Pending |
| P0-03 | Menu Manager duplicate/misassigned catalog remains | One canonical category/routing model with no duplicate rendering | `public/menu-manager.html`, `src/http/routes/catalog.js` | Pending |
| P0-04 | Inventory cards zero, BOM rows undefined but green | Real item mappings, missing mappings are errors | `public/inventory.html`, `src/http/routes/inventory.js` | Pending |
| P0-05 | BI API returns SQLITE_ERROR no such column amount | Fix schema, use stable error envelope | `src/http/routes/reports.js` (BI endpoint) | Pending |
| P0-06 | Cashier UI exposes expected cash/variance despite blindness | Expected cash restricted, no close without approval | `public/eod.html`, `src/http/routes/reports.js` | Pending |
| P0-07 | EOD data changes between tests/Shareholders zero | Immutable journal service, test database isolation | `src/domain/payments/service.js`, `public/shareholders.html` | Pending |
| P0-08 | HR daily data/payroll load errors, negative net | Validated rates, deterministic calculations, visible errors | `public/hr.html`, `src/http/routes/hr.js` | Pending |
| P0-09 | CRM/Reservations loading failures | Shared state machine, timeouts, request IDs | `public/crm.html`, `public/reservations.html` | Pending |
| P0-10 | Table counters/cards contradict | Canonical state machine, cross-screen consistency | `public/tables.html`, `src/http/routes/tables.js` | Pending |
| P0-11 | QR validation internal names leaked | No internal categories in QR | `public/qr-menu.html` | Pending |
| P0-12 | `npm test` is a failing placeholder | Safe fixtures, CI wired test pyramid | `package.json`, `test/**/*.js` | Pending |
| P0-13 | `sw.js` has no build hash, breaks POS | Versioned cache, update UX, offline queues | `public/sw.js` | Pending |
| P0-14 | Missing Mobile/Accessibility tests | Responsive/accessibility matrix | `docs/browser-acceptance.md` | Pending |
