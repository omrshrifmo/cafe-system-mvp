# Financial Controls, Money Representation & Reconciliation Architecture

## 1. Zero Floating-Point Policy: Integer Minor Units

To eliminate IEEE 754 binary floating-point rounding errors and discrepancy artifacts (e.g. `15629.100000000008`), all monetary values in the domain logic, database tables, and calculation pipelines are stored and processed as exact **integer minor units** (Piasters / Cents):

$$\text{amount\_minor} = \text{round}(\text{amount\_major} \times 100)$$

- Example: `55.50 ج.م` $\rightarrow$ `5550` minor units.
- Example: `12% Service` on `5550` $\rightarrow$ `Math.round(5550 * 0.12) = 666` minor units.

---

## 2. Server-Authoritative Quote Calculation Engine

The client Cart UI is strictly a preview; final checkout totals and receipts are computed authoritatively by `calculateServerQuote` in `src/domain/payments/service.js`:

```
+----------------------------------------------------------------+
|                   Authoritative Calculation Formula            |
|                                                                |
|   1. Subtotal Minor  = Sum(Item Quantity * Unit Price Minor)   |
|   2. Discount Minor  = Sum(Promotions / Customer Discounts)   |
|   3. Service Minor   = round(Subtotal Minor * ServiceRate%)    |
|   4. Taxable Base    = Subtotal Minor + Service Minor - Disc   |
|   5. VAT Minor       = round(Taxable Base * VatRate%)          |
|                                                                |
|   Grand Total Minor  = Taxable Base + VAT Minor                |
+----------------------------------------------------------------+
```

### Standard Configuration:
- `apply_taxes`: `true`
- `service_percent`: `12.0%`
- `vat_percent`: `14.0%` (Egyptian VAT standard)
- `currency`: `ج.م` (Egyptian Pound)

---

## 3. Multi-Tender Split Settlement & Immutability

1. **Split Payments**: An order session can be settled across multiple tenders (`CASH`, `VISA`, `INSTAPAY`, `WALLET`, `LOYALTY_POINTS`).
2. **Immutable Audit Rows**: Every payment creates an immutable record in `payments`:
   - `order_session_id`
   - `payment_method`
   - `amount_minor`
   - `amount_tendered_minor`
   - `change_returned_minor`
   - `actor_id`, `created_at`
3. **Change Calculation**: Change is strictly returned for `CASH` tenders and computed as:
   $$\text{change\_returned\_minor} = \max(0, \text{tendered\_minor} - \text{amount\_minor})$$

---

## 4. Blind Cash Close & End-of-Day (EOD) Formula

The drawer balance and variance are calculated according to the unified cash flow equation:

$$\text{Expected Cash} = \text{Opening Balance} + \text{Cash Sales} - \text{Drawer Expenses} - \text{Staff Advances}$$

$$\text{Variance} = \text{Declared Physical Cash} - \text{Expected Cash}$$

- **Variance = 0**: Balanced (مطابق تماماً).
- **Variance < 0**: Cash Shortage / Deficit (عجز نقدية).
- **Variance > 0**: Cash Surplus (فائض نقدية).

---

## 5. Append-Only Payment Reversals & Refunds

When a paid order is voided by an `OWNER` or `SUPER_ADMIN`:
1. Original payment records in `payments` remain untouched for audit history.
2. A new compensating row is inserted into `payment_reversals` with `reversal_type = 'VOID'`, `amount_minor = original_amount`, `reason`, and `authorized_by`.
3. Inventory raw materials consumed during the order are credited back in `inventory_ledger` with `event_type = 'REVERSAL'`.
