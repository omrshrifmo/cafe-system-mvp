const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');

describe('Security & RBAC Protection Tests', () => {
  let app;
  let cashierToken;
  let managerToken;
  let ownerToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Clean test table 8
    const { runQuery } = require('../../src/db/connection');
    await runQuery(`UPDATE order_sessions SET status = 'SETTLED' WHERE table_id IN (SELECT id FROM tables WHERE table_number = 8)`);

    // Login Cashier (1007)
    const cRes = await request(app).post('/api/auth/login').send({ pin: '1007' });
    cashierToken = cRes.body.token || cRes.body.data?.token || (cRes.headers['set-cookie'] ? cRes.headers['set-cookie'][0].split(';')[0].split('=')[1] : null);

    // Login OP Manager (1008)
    const mRes = await request(app).post('/api/auth/login').send({ pin: '1008' });
    managerToken = mRes.body.token || mRes.body.data?.token || (mRes.headers['set-cookie'] ? mRes.headers['set-cookie'][0].split(';')[0].split('=')[1] : null);

    // Login Owner (1009)
    const oRes = await request(app).post('/api/auth/login').send({ pin: '1009' });
    ownerToken = oRes.body.token || oRes.body.data?.token || (oRes.headers['set-cookie'] ? oRes.headers['set-cookie'][0].split(';')[0].split('=')[1] : null);
  });

  it('P0-01: Unauthenticated GET /api/users must return 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/users');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  it('P0-02: Unauthenticated GET /api/reports/eod must return 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/reports/eod');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  it('P0-03: Unauthenticated GET /api/reports/bi must return 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/reports/bi');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  it('P0-04: Unauthenticated GET /api/config must return 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/config');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  it('P0-11: Public table validation should reject non-existent table 9999 with 404', async () => {
    const res = await request(app).get('/api/public/tables/9999');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'INVALID_TABLE');
  });

  it('P0-11: Public table validation should accept valid registered table', async () => {
    const res = await request(app).get('/api/public/tables/1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.table);
  });

  it('Financial Blindness: Should block Cashier (OP_ASSISTANT_CASHIER) from GET /api/reports/eod with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/reports/eod')
      .set('Cookie', [`session_token=${cashierToken}`]);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
    assert.strictEqual(res.body.success, false);
  });

  it('Should allow Operations Manager to access GET /api/reports/eod', async () => {
    const res = await request(app)
      .get('/api/reports/eod')
      .set('Cookie', [`session_token=${managerToken}`]);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.summary);
  });

  it('Ultimate Void Rule: Paid/Closed orders CANNOT be voided by OP_MANAGER and must be rejected', async () => {
    // 1. Submit and settle order on table 8
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Cookie', [`session_token=${managerToken}`])
      .send({ table_number: 8, item_name: 'اسبريسو', quantity: 1 });
    const orderId = orderRes.body.order?.id || orderRes.body.data?.order?.id;

    await request(app)
      .post('/api/checkout')
      .set('Cookie', [`session_token=${cashierToken}`])
      .send({
        table_number: 8,
        payments: [{ method: 'CASH', amount: 50 }]
      });

    // Attempt void with OP_MANAGER PIN (1008) -> Should fail with 500/403 forbidden message
    const voidResFail = await request(app)
      .post(`/api/orders/${orderId}/void`)
      .set('Cookie', [`session_token=${managerToken}`])
      .send({ manager_pin: '1008', reason: 'محاولة إلغاء' });

    assert.ok(voidResFail.status >= 400);
    assert.ok(voidResFail.body.error.includes('حصرياً على المالك'));

    // Attempt void with OWNER PIN (1009) -> Should succeed
    const voidResSuccess = await request(app)
      .post(`/api/orders/${orderId}/void`)
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({ manager_pin: '1009', reason: 'إلغاء معتمد من المالك' });

    assert.strictEqual(voidResSuccess.status, 200);
    assert.strictEqual(voidResSuccess.body.success, true);
  });
});
