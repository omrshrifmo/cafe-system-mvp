# Automated Testing Strategy, Test Matrix & Coverage Verification

## 1. Test Architecture & Pyramids

The testing suite for `cafe-system-mvp` is organized into three distinct validation tiers using Mocha, Chai, and Supertest:

```
                  / \
                 /   \
                / Sec \   Security & RBAC Enforcement Suites
               /-------\  (Financial Blindness, Ultimate Void Rule)
              /  Integ  \ Integration & Concurrency Suites
             /-----------\(Orders, BOM, Quotes, Payments, Shifts, Sync)
            /    Unit     \ Unit & Formatter Suites
           /---------------\(Bcrypt Auth, ESC/POS Binary Formatters)
```

---

## 2. Test Suite Directory Structure

- `test/unit/`
  - `auth.test.js`: Validates salted bcrypt PIN hashing, token generation, and permission resolution.
  - `printing.test.js`: Validates raw binary ESC/POS formatting for drawer kicks (`0x1B 0x70`), cut commands (`0x1D 0x56`), receipt headers, and Z-reports.
- `test/integration/`
  - `orders_lifecycle.test.js`: Full lifecycle test from order submission, BOM raw material ledger deductions, KDS state progression, and cancellation handshake.
  - `payments_checkout.test.js`: Server-authoritative quote calculation (Subtotal + 12% Service + 14% VAT) and multi-tender split settlement.
  - `shifts_eod.test.js`: Cashier shift clock-in, individual performance reporting, and blind cash declaration with variance calculation.
  - `sync.test.js`: Offline command queue batch submission and idempotent processing.
  - `concurrency.test.js`: 10 parallel concurrent orders testing mutex queue execution and stock consistency.
  - `backup.test.js`: Hot online database backup (`VACUUM INTO`) and integrity validation.
- `test/security/`
  - `rbac.test.js`: Verifies `403 Forbidden` enforcement on financial endpoints for cashiers and blocks unauthorized voids on paid orders.

---

## 3. Running Automated Tests

```bash
# Execute entire test suite
npm test

# Generate test coverage report
npm run coverage
```

### Coverage Standard
- Statements: > 85%
- Branches: > 80%
- Functions: > 85%
- Lines: > 85%
