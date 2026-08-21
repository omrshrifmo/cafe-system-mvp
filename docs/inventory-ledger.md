# Inventory Ledger & Bill of Materials (BOM) Architecture

## 1. High-Precision Micro-Units Representation

To achieve exact fractional measurement without floating-point accumulation errors when tracking grams, milliliters, or single items (e.g. `18.5g` of espresso beans or `3.7ml` of vanilla syrup), all raw material quantities are stored in **micro-units**:

$$1\text{ Standard Unit (KG, L, Unit)} = 1,000,000\text{ Micro-Units}$$

- $1\text{ Gram (g)} = 1,000\text{ Micro-Units}$
- $1\text{ Milliliter (ml)} = 1,000\text{ Micro-Units}$
- $18.5\text{g Espresso Shot} = 18,500\text{ Micro-Units}$

---

## 2. Double-Entry Style Append-Only Ledger (`inventory_ledger`)

Direct destructive updates (`UPDATE inventory SET stock = stock - X`) are strictly forbidden. All stock movements are recorded as immutable event rows in `inventory_ledger`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER PK | Unique ledger sequence ID |
| `inventory_item_id`| INTEGER FK | Reference to raw material item |
| `event_type` | TEXT | `PURCHASE`, `SALE_BOM`, `WASTE`, `TRANSFER_IN`, `TRANSFER_OUT`, `REVERSAL`, `AUDIT_ADJUSTMENT` |
| `quantity_delta_microunits` | INTEGER | Signed integer (+ for credits, - for debits) |
| `unit` | TEXT | Base unit symbol (`g`, `ml`, `unit`, `kg`) |
| `source_type` | TEXT | Originating document (`ORDER_ITEM`, `PURCHASE_INVOICE`, `WASTE_LOG`, `TRANSFER_LOG`) |
| `source_id` | TEXT | Unique ID of originating document |
| `idempotency_key` | TEXT | Deduplication key preventing double-consumption |
| `reason` | TEXT | Human-readable audit explanation |
| `actor_id` | INTEGER | Staff member responsible |
| `created_at` | DATETIME | ISO 8601 timestamp |

### Current Balance Calculation
The true on-hand balance for any raw material item is computed via aggregate summation:

$$\text{Current Balance} = \sum \text{quantity\_delta\_microunits} \quad \text{for item } i$$

---

## 3. Bill of Materials (BOM) Consumption Pipeline

When an order is submitted via POS, Waiter PWA, or QR Menu:

```
[Order Item Submitted: "لاتيه كلاسيك", Qty: 2]
                     |
                     v
   [Resolve Active Recipe for Menu Item]
   - Espresso Beans : 18.5g * 2 = 37.0g (37,000 micro-units)
   - Fresh Milk     : 200ml * 2 = 400.0ml (400,000 micro-units)
   - Cup 12oz       : 1 unit * 2 = 2 units (2,000,000 micro-units)
                     |
                     v
  [Single Atomic Mutex Transaction]
   1. Insert Order Session & Order Items
   2. Insert signed negative deltas into `inventory_ledger`:
      - Item #1 (Espresso Beans) -> delta: -37000
      - Item #2 (Fresh Milk)     -> delta: -400000
      - Item #3 (Cup 12oz)       -> delta: -2000000
   3. Dispatch real-time KDS prep ticket to Barista station
```

---

## 4. Configurable Stock Policies

The system supports 3 operational stock policies when raw materials reach low or zero balance:
1. `BLOCK`: Rejects order creation with error code `INSUFFICIENT_STOCK`.
2. `ALLOW_WITH_ALERT` (Default for Cafe operations): Allows order completion to avoid operational bottlenecks during peak hours, generating a low-stock alert on manager dashboards.
3. `BACKORDER`: Flags raw material as negative balance requiring urgent purchasing replenishment.
