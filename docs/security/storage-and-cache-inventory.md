# Storage, Cache & Native Dialog Inventory
**MENA Cafe ERP Enterprise Platform — Security Audit Specification**

---

## 1. Cookie Inventory

| Cookie Name | Scope / Domain | Flags | Expiration | Content / Payload | Risk Assessment & Control |
|---|---|---|---|---|---|
| `session_token` | `Path=/` | `HttpOnly`, `SameSite=Lax`, `Secure` (in prod) | 24 Hours (`SESSION_TTL_HOURS`) | 32-byte Cryptographic Token (Random Hex) | **Strictly Protected**: Inaccessible to JavaScript; server compares SHA-256 hash against `v3_user_sessions`. |

---

## 2. Web Storage Inventory (`localStorage` & `sessionStorage`)

| Key Name | Storage Type | Data Format | Sensitive? | Purpose | Lifecycle / Purge Trigger |
|---|---|---|:---:|---|---|
| `currentUser` | `localStorage` | JSON Object | No | UI profile display (name, role, venue ID, safe permission array). | Purged on `auth.logout()` and `nav.js` cleanup. |
| `user` | `localStorage` | JSON Object | No | Legacy fallback for role display in QA/HR. | Purged on `auth.logout()`. |
| `cafe_device_id` | `localStorage` | String (`DEV-...`) | No | Unique hardware/browser installation fingerprint. | Persisted permanently per browser profile. |
| `cafe_events_cursor_*` | `localStorage` | Number (Integer) | No | Last acknowledged sequence number for WebSocket replay. | Persisted for offline gap recovery. |
| `active_shift_type` | `localStorage` | String (`MORNING`/`NIGHT`) | No | Active UI shift filter preference. | Persisted across page reloads. |
| `sidebar_collapsed` | `localStorage` | Boolean String | No | Responsive sidebar display preference. | Persisted per user preference. |
| `sessionStorage.*` | `sessionStorage` | Key-Value Pairs | No | Ephemeral in-tab navigational state. | **Purged Completely** on logout via `sessionStorage.clear()`. |

---

## 3. IndexedDB Inventory (`CafeSystemOfflineDB` v2)

| Object Store | Key Path | Indexes | Stored Data | Security Policy |
|---|---|---|---|---|
| `offline_commands` | `client_command_id` | `status`, `idempotency_key`, `created_at` | Queued mutations (`SUBMIT_ORDER`, `CLAIM_RUNNER_TASK`) with `actor_id`, `device_id`, timestamp, and idempotency key. | **Financial Actions Blocked**: Attempting to queue `SETTLE_PAYMENT`, `VOID_PAID`, `EOD_CLOSE` throws `UNSAFE_OFFLINE_ACTION`. |
| `local_snapshots` | `key` | None | Read-only snapshots of menu catalog and active floor tables. | Masked PII; read-only fallback during connectivity loss. |

---

## 4. Service Worker & Cache Storage Inventory

- **Cache Identifier**: `cafe-os-v3.1`
- **Service Worker Hash (SHA-256)**: `57cb96548fb033563f83c71dfdcff69c3be1c80dab759753b8e3ed191ddd5811`
- **Strategy**: Network-First with Cache Fallback for static assets; **Strict Bypass** for dynamic data.

### Pre-Cached Static Shell Assets (31 files):
- `/`, `/pos.html`, `/portal.html`, `/kds.html`, `/kitchen.html`, `/shisha.html`, `/runner.html`
- `/tables.html`, `/inventory.html`, `/purchasing.html`, `/menu-manager.html`, `/admin-menu.html`
- `/crm.html`, `/reservations.html`, `/suppliers.html`, `/hr.html`, `/eod.html`, `/bi.html`
- `/shareholders.html`, `/qa.html`, `/settings.html`, `/qr-menu.html`, `/nav.js`, `/manifest.json`
- `/modules/ui-state.js`, `/modules/api.js`, `/modules/auth.js`, `/modules/db.js`, `/modules/sync.js`

### Cache Exclusion Rules (Strict Security Boundary):
```javascript
// public/sw.js line 72:
if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
  return; // Strict bypass — never cache API responses or WebSocket frames
}
```

---

## 5. Native Browser Dialog Inventory & Modernization Plan

Native browser dialogs (`window.alert`, `window.confirm`, `window.prompt`) freeze execution threads, disrupt touch kiosks, and cannot be styled for Arabic RTL.

| File | Line | Dialog Type | Current Usage | Modernization / Security Replacement |
|---|---|---|---|---|
| `public/settings.html` | 618 | `prompt()` | Prompt admin for PIN to confirm database restore | Replace with accessible modal PIN dialog (`modal-reauth`) |
| `public/settings.html` | 693 | `confirm()` | Extreme warning before factory reset | Replace with 2-step typed confirmation modal |
| `public/pos.html` | 1278 | `confirm()` | Confirm table checkout & vacate | Replace with touch-friendly action sheet |
| `public/pos.html` | 1343 | `confirm()` | Confirm table order transfer | Replace with touch-friendly action sheet |
| `public/pos.html` | 2111 | `confirm()` | Confirm bill settlement | Replace with payment preview modal |
| `public/menu-manager.html`| 543 | `confirm()` | Confirm menu item deletion | Replace with non-blocking confirmation dialog |
| `public/tables.html` | 533 | `confirm()` | Confirm cancel table opening | Replace with non-blocking confirmation dialog |
| `public/suppliers.html` | 283 | `confirm()` | Confirm supplier deletion | Replace with non-blocking confirmation dialog |
| `public/reservations.html`| 222, 235 | `alert()` | Form validation & connection errors | Replace with floating toast notification (`showToast`) |
| `public/crm.html` | 369 | `alert()` | Customer review saved confirmation | Replace with floating toast notification (`showToast`) |
| `public/purchasing.html` | 230, 249 | `alert()` | Purchase order submission notices | Replace with floating toast notification (`showToast`) |
