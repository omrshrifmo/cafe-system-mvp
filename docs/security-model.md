# Mazaj Security Architecture & Threat Model

## 1. Authentication & Credential Storage

- **Bcrypt Salted Hashes**: Staff PIN codes are hashed using `bcryptjs` with a work factor of 10 (`saltRounds = 10`). Plaintext PINs are never stored in the database or written to log files.
- **Session Tokens**: Session identifiers are generated using Node.js `crypto.randomBytes(32).toString('hex')` (256-bit entropy).
- **Session Hash**: Session tokens stored in `user_sessions` are hashed with SHA-256 and an application secret key (`SESSION_SECRET`) to protect against offline token extraction if the database file is copied.
- **Cookie Security**: In web browsers, the session token is set as an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in HTTPS environments).

---

## 2. Protection Against Brute-Force & Abuse

- **Authentication Rate Limiting (`src/http/middleware/rate-limit.js`)**: Limits failed and successful login attempts to 5 requests per minute per IP address. Exceeding this limit returns `429 Too Many Requests`.
- **General API Limiter**: Bounds API traffic to 120 requests per minute per client.
- **Reauthentication for Critical Actions**: Sensitive operational changes (factory reset, voiding settled bills) require explicit PIN reauthentication.

---

## 3. Immutable Audit Trails (`audit_logs`)

Every significant domain action (voiding orders, applying manual discounts, adjusting stock, reauthorizing actions) is logged to `audit_logs`:
- `actor_id` (User ID)
- `action` (e.g. `VOID_PAID_ORDER`, `EXPENSE_CREATE`)
- `target_type` & `target_id`
- `details` (JSON payload of old vs new values)
- `ip_address`
- `created_at`

---

## 4. Multi-Tenant & Venue Boundary Design

All domain schemas and database queries incorporate `venue_id` boundary awareness, ensuring clean data partitioning and compatibility with multi-branch expansion.
