# Route Permission Matrix (Default Deny)

| Route Pattern | Required Role/Permission | Description |
|---|---|---|
| `/api/auth/login` | *Public* | Authentication |
| `/api/build-info` | *Public* | Build metadata |
| `/api/public/*` | *Public* | QR Menu access |
| `/api/reports/bi` | `reports:view` | Restricted BI endpoints |
| `/api/menu/categories` | `menu:write` (POST/PUT), *Public* (GET) | Menu management |
| `/api/hr/*` | `hr:manage` | Payroll and shifts |
| `/api/orders/*` | `orders:write` | POS transactions |
| `/api/inventory/*` | `inventory:manage` | Stock management |

**Implementation Strategy:**
Any route that does not explicitly declare a permission requirement, or is not in the explicit allowlist (like login), will be DENIED by the root Express router.
