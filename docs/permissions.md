# Mazaj RBAC Permission Matrix & Financial Privacy Specification

## 1. Staff Roles & Hierarchy

The Mazaj Cafe platform defines an 11-tier hierarchical role structure:

| Role Identifier | Arabic Title | Description & Typical Staff Assignment |
| :--- | :--- | :--- |
| `SUPER_ADMIN` | المدير التقني للنظام | Full system, database, and infrastructure control (Omar) |
| `OWNER` | مالك الكافيه | Complete financial, pricing, and administrative authority (Fatma, Wael 2) |
| `OP_MANAGER` | مدير العمليات والتشغيل | Operational supervisor, shifts, inventory oversight, reports (Wael) |
| `BOM_MANAGER` | مدير التكاليف والوصفات | Catalog, recipes, ingredients, supplier purchasing, QA (Sharawy) |
| `OP_ASSISTANT_CASHIER` | مساعد كاشير / كاشير | POS sales, table orders, blind cash close only (Ahmed Krkr) |
| `HALL_MANAGER` | مدير الصالة | Table seating, waitstaff coordination, reservations (Ibrahim) |
| `JOKER` | جوكر (متعدد المهام) | Floor operations, POS ordering, and prep station assistance (Ahmed) |
| `WAITER` | ويتر (مباشر) | Seating, taking orders, requesting check, table service (Amal) |
| `BARISTA` | بارستا | Beverage KDS station, accepting, preparing, marking drinks ready (Bebo, Hager) |
| `SHIASH` | شياش | Shisha KDS station, managing coals, flavors, delivery (Asmaa) |
| `CHEF` | شيف / مطبخ | Food & snack KDS station, order preparation (Chef) |

---

## 2. Granular Permission Capabilities

| Capability Code | Description | Authorized Roles |
| :--- | :--- | :--- |
| `menu:read` | View menu items, prices, and categories | *All Roles* |
| `menu:write` | Create, edit, and archive menu items and recipes | `SUPER_ADMIN`, `OWNER`, `BOM_MANAGER` |
| `orders:create` | Open tables and submit new customer orders | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `HALL_MANAGER`, `OP_ASSISTANT_CASHIER`, `WAITER`, `JOKER` |
| `orders:void_unpaid` | Cancel or void open, unpaid items | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `HALL_MANAGER` |
| `orders:void_paid` | **Ultimate Void**: Void closed, settled orders | `SUPER_ADMIN`, `OWNER` |
| `payments:checkout` | Collect payment and print receipts | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `OP_ASSISTANT_CASHIER` |
| `kds:view` | Access Kitchen Display System prep screens | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BARISTA`, `SHIASH`, `CHEF`, `JOKER` |
| `kds:update_status` | Advance orders through preparation stages | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BARISTA`, `SHIASH`, `CHEF`, `JOKER` |
| `inventory:view` | Inspect current raw material balances | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BOM_MANAGER` |
| `inventory:purchase` | Record supplier invoices and add stock | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BOM_MANAGER` |
| `inventory:waste` | Record spoilage and damaged goods | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BOM_MANAGER` |
| `inventory:transfer` | Log physical raw material transfers | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `BOM_MANAGER` |
| `reports:financial` | Access EOD revenue, daily sales, and BI | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER` |
| `reports:blind_shift`| View own shift totals & submit cash declaration | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER`, `OP_ASSISTANT_CASHIER` |
| `hr:manage` | Manage staff records, payroll, advances, penalties | `SUPER_ADMIN`, `OWNER`, `OP_MANAGER` |
| `shareholders:view` | View equity ledger and capital distributions | `SUPER_ADMIN`, `OWNER` |
| `system:config` | Modify taxes, service rates, and printer IP | `SUPER_ADMIN`, `OWNER` |
| `system:factory_reset`| Execute factory data reset | `SUPER_ADMIN`, `OWNER` (explicit confirmation required) |

---

## 3. Financial Blindness Enforcement (Rule P0-C & P1-9)

### 3.1 Policy Definition
Cashiers (`OP_ASSISTANT_CASHIER` and `CASHIER`) are intentionally blocked from seeing:
1. Total revenue figures for the day or shift.
2. System-expected total cash in drawer prior to counting.
3. Profit and loss analytics, BI dashboards, or shareholder ledgers.

### 3.2 Technical Implementation
- Any request from an `OP_ASSISTANT_CASHIER` session to `/api/reports/eod`, `/api/reports/sales-summary`, or `/api/users` is intercepted by `requirePermission('reports:financial')` in `src/http/middleware/permissions.js` and rejected with `403 Forbidden`.
- The cashier is provided with a dedicated **Blind Shift Declaration** endpoint (`POST /api/shifts/declare-blind`) where they submit their actual physical cash count without knowing the system's expected balance.

---

## 4. Ultimate Void Rule Enforcement (Rule P0-E)

### 4.1 Policy Definition
Once an order has been settled and marked as `PAID` / `SETTLED`, it represents a legally closed financial transaction. It cannot be cancelled or deleted by cashiers, waitstaff, or operational managers (`OP_MANAGER`).

### 4.2 Technical Implementation
- In `src/domain/payments/service.js` (`voidPaidOrder`), the server strictly verifies:
  ```javascript
  if (!['OWNER', 'SUPER_ADMIN'].includes(actorRole)) {
    throw new Error('FORBIDDEN: صلاحية إلغاء الفواتير المسددة والمغلقة مالياً مقتصرة حصرياً على المالك (OWNER / SUPER_ADMIN)');
  }
  ```
- Executing a void creates an append-only audit row in `payment_reversals` and reverses raw material deductions in `inventory_ledger` with event type `REVERSAL`.
