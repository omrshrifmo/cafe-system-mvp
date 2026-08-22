# Cafe System MVP — Data Model Before & Migration State

**Database:** `cafe.db`  
**Current Migration Level:** `005_canonical_prices.sql`  
**Schema Integrity:** `PRAGMA integrity_check` = `ok`

---

## 1. Core Entity Relationship Summary

```
                      +-------------------+
                      |      tables       |
                      +-------------------+
                                | 1
                                |
                                | *
                      +-------------------+
                      |  order_sessions   |
                      +-------------------+
                       /        |        \
                   1  /       1 |         \ 1
                     /          |          \
                    v *         v *         v *
            +-------------+  +----------+  +--------------------+
            | order_items |  | payments |  | payment_reversals  |
            +-------------+  +----------+  +--------------------+
                    |             |
                    | (BOM)       | (Cash/Reconciliation)
                    v             v
            +------------------+  +-------------------+
            | inventory_ledger |  | drawer_declares   |
            +------------------+  +-------------------+
```

---

## 2. Table Inventory (42 Tables Tracked)

| Table Name | Primary Key | Description | Row Count (Baseline) |
|---|---|---|---|
| `audit_logs` | `id` | Security and administrative audit trail | 0 |
| `complaints` | `id` | Customer QA complaints and resolution | 0 |
| `customers` | `id` | CRM, loyalty points, visit stats | 0 |
| `customer_feedback` | `id` | Guest ratings and reviews | 0 |
| `daily_expenses` | `id` | Petty cash shift expenses | 0 |
| `drawer_declarations` | `id` | Cashier blind count records | 0 |
| `employee_advances` | `id` | Cash advances against salary | 0 |
| `idempotency_keys` | `key` | Request deduplication keys | 0 |
| `inventory` | `id` | Legacy inventory balances table | 8 |
| `inventory_items` | `id` | Canonical inventory items & microunits stock | 8 |
| `inventory_ledger` | `id` | Immutable inventory event stream | 0 |
| `item_addons` | `id` | Add-on options (milk, syrup, etc.) | 0 |
| `item_variants` | `id` | Size/roast variants | 0 |
| `material_transfers`| `id` | Inter-station transfer logs | 0 |
| `menu_categories` | `id` | Menu groups (Barista, Kitchen, Shisha) | 5 |
| `menu_items` | `id` | Menu items catalog | 18 |
| `menu_prices` | `id` | Authoritative effective-dated prices | 18 |
| `orders` | `id` | Legacy single-order records | 52 |
| `order_items` | `id` | Active and historical order items with KDS state | 0 |
| `order_payments` | `id` | Legacy payment split records | 25 |
| `order_sessions` | `id` | Active table tabs and checkout sessions | 0 |
| `outbox_events` | `id` | Realtime event streaming queue | 0 |
| `payments` | `id` | Authoritative split payments ledger | 0 |
| `payment_reversals`| `id` | Append-only voids and refund records | 0 |
| `penalties` | `id` | HR employee disciplinary deductions | 0 |
| `print_jobs` | `id` | Hardware ESC/POS print buffer queue | 0 |
| `purchase_items` | `id` | Lines on purchase orders | 0 |
| `purchases` | `id` | Supplier purchase invoices | 0 |
| `recipe_ingredients`| `id` | BOM materials and gram quantities | 5 |
| `recipe_versions` | `id` | Versioned recipes history | 1 |
| `recipes` | `id` | Recipe headers per menu item | 5 |
| `reservations` | `id` | Table booking slots | 0 |
| `schema_migrations` | `version`| Applied migration files and checksums | 5 |
| `shareholder_ledger`| `id` | Partner equity, capital, withdrawals | 0 |
| `shifts` | `id` | Staff shifts and attendance records | 8 |
| `staff_allowances` | `id` | Bonuses and tips distribution | 0 |
| `suppliers` | `id` | Vendor database | 0 |
| `system_config` | `key` | Tax rates, currency, service fees | 5 |
| `tables` | `table_number` | Cafe floor tables and live lifecycle | 20 |
| `table_sessions` | `id` | Legacy table sessions | 0 |
| `users` | `id` | User accounts with roles and hashed PINs | 11 |
| `user_sessions` | `session_token`| Active authentication tokens | 2 |
| `waste_log` | `id` | Spoiled/spilled ingredients waste log | 0 |
