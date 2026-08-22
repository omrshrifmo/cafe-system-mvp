# Cafe System MVP — Legacy Data Inventory & Migration Mapping

**Review Date:** 22 August 2026  
**Preservation Policy:** Strict append-only; zero silent data deletion or destructive table dropping.

---

## 1. Legacy to Canonical Entity Mapping

| Legacy Table / Column | Canonical Table / Column | Transformation / Rule | Integrity Guarantee |
|---|---|---|---|
| `inventory.current_stock` | `inventory_items.current_stock_microunits` | `ROUND(current_stock * 1000000)` | Prevents float loss; microunits precision |
| `inventory.unit_cost` | `inventory_items.cost_per_unit_minor` | `ROUND(unit_cost * 100)` | Integer minor unit in EGP cents |
| `menu_items.base_price` | `menu_prices.amount_minor` | `ROUND(base_price * 100)` | Effective-dated price snapshots |
| `users.pin_code` (plaintext) | `users.pin_hash` | `bcrypt.hash(pin_code, 10)` | Never plaintext; verified on login |
| `orders` | `order_sessions` & `order_items` | Mapped via `session_id` | Atomic table tabs and KDS routing |
| `order_payments` | `payments` | Mapped with `amount_minor` | Split payment tracking with currency |

---

## 2. Legacy Migration Safeguards in `src/db/migrator.js`

1. **Pre-Migration Column Harmonization:** Automatically adds missing columns with default values (`ensureTableColumn`) without rewriting tables.
2. **Deterministic Checksum Verification:** Every migration file calculates an MD5 checksum. If an applied migration's content was altered, migration execution halts immediately with `CHECKSUM_MISMATCH`.
3. **Transactional Safety:** Each SQL migration file executes inside a dedicated SQLite transaction (`runTransaction`). If any statement fails, the entire migration rolls back cleanly.
4. **Idempotent Seeding:** All legacy data converters use `ON CONFLICT DO UPDATE` or `INSERT OR IGNORE` to guarantee safe re-runs.
