# Complete Data Model & Entity Relationship Specification

## 1. Entity Overview & Core Relational Groups

```
+-------------------------------------------------------------------------------+
|                             Mazaj Entity Groups                               |
|                                                                               |
|  [Auth & Organization]      [Catalog & BOM]         [Orders & KDS]            |
|  - users                    - menu_categories       - order_sessions          |
|  - user_sessions            - menu_items            - order_items             |
|  - shifts                   - menu_item_prices      - table_sessions          |
|  - system_config            - recipe_versions       - tables                  |
|                             - recipe_ingredients                              |
|                             - inventory_items                                 |
|                                                                               |
|  [Accounting & Cash]        [Stock Movements]       [Reliability & Outbox]    |
|  - payments                 - inventory_ledger      - print_jobs              |
|  - payment_reversals        - purchases             - outbox_events           |
|  - drawer_declarations      - purchase_items        - idempotency_keys        |
|  - daily_expenses           - material_transfers    - audit_logs              |
|  - employee_advances        - waste_log                                       |
|  - shareholder_ledger                                                         |
+-------------------------------------------------------------------------------+
```

---

## 2. Table Specifications

### 2.1 `users`
- `id` (INTEGER PK AUTOINCREMENT)
- `name` (TEXT NOT NULL)
- `role` (TEXT NOT NULL) - Enum of 11 Mazaj roles
- `pin_hash` (TEXT NOT NULL) - Bcrypt hash
- `phone`, `salary_base_minor`, `active` (INTEGER DEFAULT 1)

### 2.2 `order_sessions`
- `id` (INTEGER PK AUTOINCREMENT)
- `session_uuid` (TEXT UNIQUE NOT NULL)
- `table_id` (INTEGER FK -> tables)
- `status` (TEXT NOT NULL) - `ACTIVE`, `CHECK_REQUESTED`, `SETTLED`, `VOIDED`
- `subtotal_minor`, `discount_minor`, `service_charge_minor`, `vat_minor`, `total_minor` (INTEGER)
- `opened_by`, `closed_by` (INTEGER FK -> users)
- `created_at`, `closed_at` (DATETIME)

### 2.3 `inventory_ledger`
- `id` (INTEGER PK AUTOINCREMENT)
- `inventory_item_id` (INTEGER FK -> inventory_items)
- `event_type` (TEXT NOT NULL)
- `quantity_delta_microunits` (INTEGER NOT NULL)
- `unit` (TEXT NOT NULL)
- `source_type`, `source_id`, `idempotency_key`
- `reason`, `actor_id`, `created_at`

### 2.4 `payments`
- `id` (INTEGER PK AUTOINCREMENT)
- `order_session_id` (INTEGER FK -> order_sessions)
- `payment_method` (TEXT NOT NULL) - `CASH`, `VISA`, `INSTAPAY`, `WALLET`, `POINTS`
- `amount_minor` (INTEGER NOT NULL)
- `amount_tendered_minor`, `change_returned_minor` (INTEGER)
- `actor_id`, `created_at`
