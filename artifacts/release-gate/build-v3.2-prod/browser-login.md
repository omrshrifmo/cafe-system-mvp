
# Browser Gate 2: Deterministic Authentication Evidence

- **Build ID**: build-v3.2-prod
- **Timestamp**: 2026-08-27T16:33:21.170Z
- **Tested Fixture**: `fixtures/qa-auth.sqlite` (SHA256: `b2e863227c997c12091d8d33f33165f0a398178d0873469cb4eecd2a99c80401`)

## Results
1. **Login Module Delivery**: `/modules/auth.js` delivers with `Content-Type: text/javascript; charset=utf-8`, size 20,977 bytes, clean JavaScript AST (no HTML wrapper).
2. **Deterministic PIN Login**: Valid Owner PIN `1009` / `8802` authenticates with HTTP 200, sets secure HttpOnly session cookie, and returns canonical `role: "OWNER"` and `defaultRoute: "/portal.html"`.
3. **Role Normalization**: `/api/auth/me` returns `role: "OWNER"` with 0 instances of legacy `R_OWNER`.
4. **Invalid PIN Error**: PIN `9999` produces HTTP 401 with safe localized message "رمز الدخول السري غير صحيح أو الحساب غير موجود".
5. **Fresh Profile Recovery**: No stale quick-role shortcuts or cross-user state persistence.
