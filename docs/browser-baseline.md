# Cafe System MVP — Browser & UI Baseline

**Target Browser Environments:** Chromium-based POS Terminals, Desktop Browsers, Mobile QR Ordering  
**Primary Typography:** Cairo (`font-cairo`), RTL First  
**Theme:** Enterprise Slate Dark Theme (`dark` mode)  
**Service Worker Version:** `cafe-os-v3`

---

## 1. Page Inventory (22 HTML Pages)

| Page | URL | Purpose & Target Users | State Contract |
|---|---|---|---|
| Index / Login | `/index.html` | PIN Keypad authentication | Ready, Submitting, Error |
| Owner Portal | `/portal.html` | Central hub for managers & owners | Live KPIs, Tool grid |
| POS & Cashier | `/pos.html` | Fast order entry, floor map, checkout | Live Tables, Cart, Active Orders |
| Tables Map | `/tables.html` | Full floor layout, zones, seating | Vacant, Seated, Check Requested |
| Kitchen KDS | `/kds.html` / `/kitchen.html` | Kitchen order queue & status | Pending, Accepted, Ready |
| Barista KDS | `/kds.html` | Barista espresso/drinks station | Pending, Accepted, Ready |
| Shisha KDS | `/shisha.html` | Shisha coal & preparation station | Active Shisha orders |
| Runner Display | `/runner.html` | Food runners & table delivery | Ready items for dispatch |
| Menu Manager | `/menu-manager.html` | Item catalog, prices, categories | Dynamic price editing |
| QR Guest Menu | `/qr-menu.html` | Guest self-ordering via table QR | Table-bound cart |
| Inventory & BOM | `/inventory.html` | Stock balances, BOM reconciliation | Microunits ledger |
| Purchasing | `/purchasing.html` | Supplier purchase logs | Invoice entry |
| Suppliers | `/suppliers.html` | Vendor CRM & contact book | List & Add |
| CRM / Loyalty | `/crm.html` | Customer visits, loyalty points | Search & Redemptions |
| Reservations | `/reservations.html` | Table reservation slots | Calendar / Time slots |
| HR & Payroll | `/hr.html` | Employee attendance, hourly rates | Clock in/out logs |
| EOD Settlement | `/eod.html` | Cash declaration, Z-Report | Blind Cash count |
| BI Analytics | `/bi.html` | Sales metrics, hourly revenue | Charts & KPIs |
| Shareholders | `/shareholders.html` | Capital, withdrawals, dividends | Statement audit |
| Quality QA | `/qa.html` | Customer feedback & complaints | Severity logs |
| Settings | `/settings.html` | Tax, printers, venue configuration | Key-value settings |
| Legacy Admin | `/admin-menu.html` | Legacy compatibility fallback | Deprecated redirect |

---

## 2. Universal Screen State Standard

Every UI component adheres to the 10-state life-cycle:
1. `LOADING`: Visual spinner / skeleton placeholder.
2. `READY`: Complete interactive state with server data.
3. `EMPTY`: Informative empty-state icon and action prompt.
4. `ERROR`: Localized Arabic error message with retry trigger.
5. `OFFLINE`: Top banner warning with offline queue indicator.
6. `STALE`: Indicating data is cached and attempting sync.
7. `RETRYING`: Exponential backoff network retry.
8. `QUEUED`: Offline order saved to IndexedDB / localStorage.
9. `REJECTED`: Validation or permission refusal banner.
10. `SETTLED`: Confirmed payment or transaction commit.
