# Cafe System MVP — Fast-Track Scope & Operational Boundary

## 1. Product Boundary & Target Deliverable
The release target is a **single-cafe, internally configurable, role-based operational ERP system** for cafe staff and management.

### P0 Capabilities (Must Work Before Pilot)
1. **First-Run Setup & Onboarding**: Blank-live startup without fake demo data; wizard for cafe profile, stations, devices, policies, and initial stock/purchasing path.
2. **Demo/Live Isolation**: Server-enforced environment modes (`DEMO` vs `LIVE`). In Demo mode, persistent visual banners and simulated hardware actions; in Live mode, strict blank bootstrap with zero fake seeds.
3. **Staff & Least-Privilege RBAC**: Server-side permission enforcement for Super Admin, Owner, Operations Manager, Operations Assistant/Cashier, Barista, Chef, Shisha, Waiter, Runner, Hall Manager, BOM Manager, HR/Payroll, and QA.
4. **Canonical Catalog, Recipes & BOM**: Single source of truth for categories, menu items, prices, versioned recipes, raw materials, waste allowances, and unit conversions.
5. **Hospitality & Table Context**: Dynamic table status, service timers, customer linkage, and waiter assistance requests.
6. **POS Quotation & Settlement**: Server-authoritative integer minor-unit quotes (VAT 14%, Service 12%, discounts, tips), exact/split/cash/digital payments, and append-only reversals.
7. **Kitchen/Station Operations (KDS)**: Realtime outbox event dispatching, station filtering (Barista/Shisha/Chef), pickup claiming, and runner delivery.
8. **Shifts & Cash Reconciliation (EOD)**: Morning and Night shift lifecycles, blind cashier count, owner variance approval, and immutable expected cash formula.
9. **Accounting, BI & Audit**: Reconciled sales, inventory consumption, expenses, payroll, and shareholder equity drill-downs without zero-masking or SQL errors.
10. **Operations, Backup & DR**: Non-blocking SQLite hot backups via `VACUUM INTO`, AES-256-GCM encryption, and safe restore verification.

### Deferred (Post-Pilot Scope)
- Multi-branch consolidation and franchise franchise-level billing.
- Complex third-party predictive analytics integrations.
- External POS hardware drivers outside standard ESC/POS thermal protocols.
