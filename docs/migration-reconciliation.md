# Database Migration, Schema Harmonization & Reconciliation

## 1. Migration Philosophy: Zero Data Loss & Backward Compatibility

The upgrade from MVP to production involves significant structural enhancements, including:
1. Canonicalizing menu items and recipes with BOM micro-units.
2. Migrating currency calculations to exact integer minor units (`amount_minor`).
3. Adding double-entry append-only tables (`inventory_ledger`, `payments`, `payment_reversals`, `audit_logs`).

To ensure that existing operational data in `cafe.db` is never corrupted or deleted:
- The custom migration engine (`src/db/migrator.js`) executes versioned SQL migrations in sorted sequence.
- Migrations are tracked with MD5 checksums in `schema_migrations`.
- A schema column harmonizer (`ensureTableColumn`) inspects existing SQLite tables (`users`, `system_config`, `tables`) and dynamically adds any missing columns with safe defaults prior to running transactional scripts.

---

## 2. Versioned Migration Catalog (`src/db/migrations/`)

### `001_core_schema.sql`
- Creates foundational organizational tables: `users`, `user_sessions`, `system_config`, `tables`, `table_sessions`, `shifts`, `drawer_declarations`, `customers`, `employee_advances`, `penalties`, `daily_expenses`, `shareholder_ledger`, `complaints`, `reservations`, `customer_feedback`, `staff_allowances`.

### `002_canonical_catalog.sql`
- Sets up the unified menu architecture: `menu_categories`, `menu_items`, `menu_item_prices`, `recipe_versions`, `recipe_ingredients`, `inventory_items`, `suppliers`.
- Seeds canonical Mazaj categories and BOM items.

### `003_orders_and_accounting.sql`
- Implements authoritative financial and stock accounting: `order_sessions`, `order_items`, `payments`, `payment_reversals`, `inventory_ledger`, `purchases`, `purchase_items`, `material_transfers`, `waste_log`.

### `004_outbox_and_idempotency.sql`
- Establishes reliability infrastructure: `print_jobs`, `outbox_events`, `idempotency_keys`, `audit_logs`.
