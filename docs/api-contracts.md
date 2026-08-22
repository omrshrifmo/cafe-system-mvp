# Cafe System MVP — Canonical API Contracts

All endpoints return JSON wrapped in an explicit success envelope. Error envelopes never expose internal SQL syntax, file paths, or raw stack traces.

---

## 1. Authentication Endpoints

### `POST /api/auth/login`
- **Request:**
  ```json
  {
    "pin": "1009"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "d985a73e-4fa0-4a53-b09e-3184dcba926f",
    "user": {
      "id": 43,
      "name": "Owner",
      "role": "OWNER"
    },
    "permissions": ["*"]
  }
  ```

### `GET /api/auth/logout` & `POST /api/auth/logout`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "تم تسجيل الخروج بنجاح"
  }
  ```

---

## 2. Provenance & Build Info

### `GET /api/build-info`
- **Headers Returned:**
  - `X-Build-Id`: `build-d4c1b979-v2`
  - `X-Commit-Sha`: `d4c1b97943d047a06a2e2f3d537f81ef69c11867`
  - `X-Branch`: `master`
  - `X-Schema-Version`: `005_canonical_prices.sql`
  - `X-Migration-Version`: `005`
  - `X-Service-Worker-Version`: `cafe-os-v3`
  - `X-Environment-Mode`: `production`
  - `X-Database-Identity`: `cafe.db`
  - `X-Server-Instance-Id`: `uuid`
- **Success Response (200 OK):**
  ```json
  {
    "status": "OK",
    "buildId": "build-d4c1b979-v2",
    "commitSha": "d4c1b97943d047a06a2e2f3d537f81ef69c11867",
    "branch": "master",
    "schemaVersion": "005_canonical_prices.sql",
    "migrationVersion": "005",
    "serviceWorkerVersion": "cafe-os-v3",
    "environmentMode": "production",
    "databaseIdentity": "cafe.db",
    "processStartTime": "2026-08-22T18:32:00.000Z",
    "serverInstanceId": "783fa291-7650-4eb7-a411-d0793739d481",
    "timestamp": "2026-08-22T18:33:00.000Z"
  }
  ```

---

## 3. Order Quotation & Checkout Endpoints

### `POST /api/quote`
- **Request:**
  ```json
  {
    "items": [
      { "item_id": 1, "quantity": 2, "unit_price": 50 },
      { "item_id": 4, "quantity": 1, "unit_price": 100 }
    ],
    "order_type": "DINE_IN",
    "discount_minor": 0
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "quote": {
      "currency": "ج.م",
      "subtotal_minor": 20000,
      "service_rate": 12,
      "service_minor": 2400,
      "taxable_base_minor": 22400,
      "vat_rate": 14,
      "tax_minor": 3136,
      "discount_minor": 0,
      "tip_minor": 0,
      "total_minor": 25536,
      "subtotal_display": 200.00,
      "total_display": 255.36
    }
  }
  ```

### `POST /api/checkout`
- **Request:**
  ```json
  {
    "table_number": 4,
    "subtotal": 200,
    "total_amount": 255.36,
    "payments": [
      { "method": "CASH", "amount": 255.36 }
    ],
    "items": [
      { "item_name": "اسبريسو دبل", "quantity": 2, "unit_price": 50 }
    ],
    "cashier_name": "الكاشير",
    "customer_phone": "01012345678",
    "points_redeemed": 0,
    "tip_amount": 0
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "تم سداد الفاتورة وإغلاق الحساب بنجاح",
    "sessionId": 12,
    "total_minor": 25536,
    "currency": "ج.م"
  }
  ```

---

## 4. Standard Error Envelope

When any error occurs:
```json
{
  "success": false,
  "error": "وصف واضح للمستخدم باللغة العربية",
  "code": "ERROR_CODE",
  "requestId": "5e13b860-3bf0-410a-bd30-6eaefbc37db0"
}
```
*(No database syntax or internal stack traces are ever exposed)*
