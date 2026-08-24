/**
 * Foundation Repair, Migration Integrity & API Contracts Test Suite
 */
const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getDb, allQuery, getQuery, runQuery } = require('../../src/db/connection');

describe('Foundation Repair, Migration Integrity & API Contracts', function () {
  this.timeout(25000);
  let app;
  let ownerCookies;
  let cashierCookies;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Login as OWNER (User 43 / PIN 1009)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });
    ownerCookies = ownerRes.headers['set-cookie'];

    // Login as CASHIER (User 5 / PIN 1005)
    const cashierRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1005' });
    cashierCookies = cashierRes.headers['set-cookie'];
  });

  describe('1. Schema Migrations & Foreign Key Constraints Integrity', () => {
    it('should have all migrations registered in schema_migrations with valid checksums', async () => {
      const migrations = await allQuery(`SELECT version, checksum, execution_time_ms, status FROM schema_migrations ORDER BY version ASC`);
      assert.ok(migrations.length >= 20, 'At least 20 migrations must be recorded');
      
      const migDir = path.join(__dirname, '../../src/db/migrations');
      const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
      
      for (const file of files) {
        const found = migrations.find(m => m.version === file);
        assert.ok(found, `Migration ${file} must be recorded in schema_migrations`);
        assert.strictEqual(found.status, 'SUCCESS');
        assert.ok(found.checksum && found.checksum.length >= 16, `Checksum for ${file} must be valid`);
      }
    });

    it('should have foreign keys enabled and active in SQLite connection', async () => {
      const fk = await getQuery(`PRAGMA foreign_keys;`);
      assert.strictEqual(fk.foreign_keys, 1, 'PRAGMA foreign_keys must be ON');
    });

    it('should have users.phone and users.department columns present and queryable', async () => {
      const user = await getQuery(`SELECT id, name, role, department, phone FROM users LIMIT 1`);
      assert.ok(user, 'Users row must exist');
      assert.ok('department' in user, 'department column must exist on users table');
      assert.ok('phone' in user, 'phone column must exist on users table');
    });

    it('should have order_items analytical and price fields present', async () => {
      const oi = await getQuery(`SELECT id, item_name_snapshot, unit_price_minor, department, kds_status FROM order_items LIMIT 1`);
      if (oi) {
        assert.ok('item_name_snapshot' in oi, 'item_name_snapshot must exist');
        assert.ok('unit_price_minor' in oi, 'unit_price_minor must exist');
      }
    });
  });

  describe('2. Documented Envelope Format & Error Safety', () => {
    it('should return { success, data, error, requestId } on all successful responses', async () => {
      const res = await request(app)
        .get('/api/menu')
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data !== undefined, 'Envelope must contain data field');
      assert.strictEqual(res.body.error, null, 'Error must be null on success');
      assert.ok(res.body.requestId, 'requestId must be present');
    });

    it('should distinguish 404 NOT_FOUND from 403 FORBIDDEN and 401 AUTH_REQUIRED', async () => {
      // 404 Not Found
      const notFoundRes = await request(app)
        .get('/api/non_existent_endpoint_xyz')
        .expect(404);

      assert.strictEqual(notFoundRes.body.success, false);
      assert.strictEqual(notFoundRes.body.code, 'NOT_FOUND');
      assert.ok(notFoundRes.body.error.includes('NOT_FOUND'));

      // 401 Auth Required
      const unauthRes = await request(app)
        .get('/api/users')
        .expect(401);

      assert.strictEqual(unauthRes.body.success, false);
      assert.strictEqual(unauthRes.body.code, 'AUTH_REQUIRED');

      // 403 Forbidden (Financial blindness for Cashier)
      const forbiddenRes = await request(app)
        .get('/api/reports/eod')
        .set('Cookie', cashierCookies)
        .expect(403);

      assert.strictEqual(forbiddenRes.body.success, false);
      assert.strictEqual(forbiddenRes.body.code, 'FORBIDDEN');
    });

    it('should sanitize database errors and never expose raw SQL syntax or stack traces', async () => {
      const errRes = await request(app)
        .post('/api/tables/999999/seat')
        .set('Cookie', ownerCookies)
        .send({ guest_count: 2 });

      // Should return a clean, safe public error message
      assert.ok(errRes.body.error, 'Error message must exist');
      assert.strictEqual(errRes.body.error.includes('SELECT'), false, 'SQL query must not be exposed');
      assert.strictEqual(errRes.body.error.includes('FROM'), false, 'SQL syntax must not be exposed');
      assert.strictEqual(errRes.body.error.includes('sqlite3'), false, 'Internal driver name must not be exposed');
      assert.ok(errRes.body.requestId, 'requestId must be included for tracing');
    });
  });

  describe('3. The 21 Documented Core Page & System Contracts', () => {
    it('1. GET /api/users - Roster Contract', async () => {
      const res = await request(app).get('/api/users').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.users);
    });

    it('2. GET /api/menu - Catalog Contract', async () => {
      const res = await request(app).get('/api/menu').expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.items);
    });

    it('3. GET /api/inventory - Inventory Contract', async () => {
      const res = await request(app).get('/api/inventory').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.items);
    });

    it('4. GET /api/tables - Floor & Tables Contract', async () => {
      const res = await request(app).get('/api/tables').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.tables);
    });

    it('5. GET /api/orders - Orders Lifecycle Contract', async () => {
      const res = await request(app).get('/api/orders').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.orders);
    });

    it('6. POST /api/quotes - Price & Tax Quotation Contract', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Cookie', cashierCookies)
        .send({ items: [{ name: 'لاتيه', quantity: 1 }] })
        .expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.quote);
    });

    it('7. GET /api/payments - Payments Ledger Contract', async () => {
      const res = await request(app).get('/api/payments').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.payments);
    });

    it('8. GET /api/receipts - Receipts Retrieval Contract', async () => {
      const res = await request(app).get('/api/receipts').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.receipts);
    });

    it('9. GET /api/purchases - Material Purchases Contract', async () => {
      const res = await request(app).get('/api/purchases').set('Cookie', ownerCookies);
      if (res.status !== 200) {
        console.error('PURCHASES ERROR RES:', res.status, res.body);
      }
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.purchases);
    });

    it('10. GET /api/suppliers - Suppliers Roster Contract', async () => {
      const res = await request(app).get('/api/suppliers').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.suppliers);
    });

    it('11. GET /api/expenses - Daily Expenses Contract', async () => {
      const res = await request(app).get('/api/expenses').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || Array.isArray(res.body));
    });

    it('12. GET /api/shifts - Staff Shifts Contract', async () => {
      const res = await request(app).get('/api/shifts').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.shifts);
    });

    it('13. GET /api/payroll - Payroll Calculation Contract', async () => {
      const res = await request(app).get('/api/payroll').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.lines);
    });

    it('14. GET /api/crm - Customer Relationship Contract', async () => {
      const res = await request(app).get('/api/crm').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.customers);
    });

    it('15. GET /api/reservations - Table Reservations Contract', async () => {
      const res = await request(app).get('/api/reservations').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.reservations);
    });

    it('16. GET /api/quality - Quality Assurance Contract', async () => {
      const res = await request(app).get('/api/quality').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.complaints);
    });

    it('17. GET /api/audit - System Audit Trail Contract', async () => {
      const res = await request(app).get('/api/audit').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.logs);
    });

    it('18. GET /api/reports/eod - End of Day Financial Report Contract', async () => {
      const res = await request(app).get('/api/reports/eod').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.summary);
    });

    it('19. GET /api/reports/bi - Business Intelligence Analytics Contract', async () => {
      const res = await request(app).get('/api/reports/bi').set('Cookie', ownerCookies).expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.kpis);
    });

    it('20. GET /api/realtime/health - Realtime WebSocket Health Contract', async () => {
      const res = await request(app).get('/api/realtime/health').expect(200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'HEALTHY');
    });

    it('21. POST /api/sync/commands - Offline Batch Synchronization Contract', async () => {
      const res = await request(app)
        .post('/api/sync/commands')
        .set('Cookie', ownerCookies)
        .send({ commands: [] })
        .expect(200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data || res.body.processed !== undefined);
    });
  });
});
