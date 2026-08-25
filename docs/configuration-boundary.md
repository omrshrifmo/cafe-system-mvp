# Cafe System MVP — Configuration Boundary & Administrative Controls

## 1. Non-Technical Administration Boundary
All cafe operational settings, policies, staff accounts, menu items, prices, recipes, and devices are fully configurable through the Web UI without direct SQL or code modifications.

### Configuration Areas
1. **Cafe Identity**: Arabic and English legal and brand names, tax registration numbers, address, contact details, timezone (`Africa/Cairo`), currency (`EGP`), and receipt header/footer.
2. **Branches & Stations**: Branch definitions and operational station assignments (`BARISTA`, `SHISHA`, `KITCHEN`, `HALL`, `CASHIER`, `ADMIN`).
3. **Devices & Terminals**: Browser terminals, POS stations, KDS wall displays, receipt printers, and cash drawer triggers.
4. **Pricing, Tax & Service Policies**: Integer minor-unit prices, VAT rate (default 14%), service charge rate (default 12%), cash rounding rules, and blind cashier policies.
5. **Staff, Roles & Least Privilege**: Role assignments, credential rotation, PIN hashing via bcrypt/Argon2id, and permission scope by department and station.
6. **Operating Shifts**: Morning and Night shift configurations, opening floats, and handover requirements.

## 2. Policy Versioning & Immutability
- Every policy update creates a new immutable version in `v3_policies`.
- Historical orders, settlements, inventory deductions, payroll lines, and EOD reports preserve the specific policy version active at the time of execution.
- Sensitive policy changes require authenticated owner reauthentication.
