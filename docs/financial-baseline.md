# Cafe System MVP — Financial Controls Baseline & Invariants

**Accounting Standard:** Egyptian / MENA Hospitality Retail Model  
**Currency:** Egyptian Pound (`EGP` / `ج.م`)  
**Base Tax Invariants:** 12% Service Charge + 14% VAT on `(Subtotal + Service)`

---

## 1. Mathematical Invariant Verification

For every order quote and settlement:

$$\text{Subtotal} = \sum_{i=1}^n (\text{Unit Price}_i \times \text{Quantity}_i)$$

$$\text{Service Charge} = \text{ROUND}\left(\text{Subtotal} \times \frac{\text{Service Rate}}{100}\right)$$

$$\text{Taxable Base} = \text{Subtotal} + \text{Service Charge}$$

$$\text{VAT (14\%)} = \text{ROUND}\left(\text{Taxable Base} \times \frac{\text{VAT Rate}}{100}\right)$$

$$\text{Total Amount Due} = \text{Taxable Base} + \text{VAT} - \text{Discount} + \text{Tip}$$

---

## 2. Shift Cash Reconciliation Formula

$$\text{Expected Cash} = \text{Opening Float} + \text{Cash Payments} + \text{Retained Tips} - \text{Cash Expenses} - \text{Cash Advances} - \text{Cash Refunds}$$

$$\text{Cash Variance} = \text{Declared Actual Cash} - \text{Expected Cash}$$

- **Cashier Blindness:** The cashier inputs counted money during blind declaration without knowing the system expected cash.
- **Manager Approval:** Any variance is only revealed to `OWNER` / `OP_MANAGER` upon shift review and close.

---

## 3. Baseline Monetary Audit (from `cafe.db`)

- **Historical Order Records:** 52 legacy orders recorded
- **Historical Order Payments:** 25 payment entries recorded
- **Current Canonical Order Sessions:** 0 open pending sessions (clean baseline ready for fresh test runs)
- **Active Tax Settings in Database:**
  - `vat_percent`: 14
  - `service_percent`: 12
  - `currency`: 'ج.م'
  - `apply_taxes`: true
