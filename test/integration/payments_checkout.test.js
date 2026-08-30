const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getQuery } = require('../../src/db/connection');

describe('Payments & Checkout Integration Tests', function() {
  this.timeout(20000);
  let app;
  let cashierToken;
  let waiterToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Clean test tables 7
    const { runQuery } = require('../../src/db/connection');
    await runQuery(`UPDATE order_sessions SET status = 'SETTLED' WHERE table_id IN (SELECT id FROM tables WHERE table_number = 7)`);
    await runQuery(`UPDATE system_config SET value = 'true' WHERE key = 'apply_taxes'`);
    await runQuery(`UPDATE system_config SET value = '14' WHERE key = 'vat_percent'`);
    await runQuery(`UPDATE system_config SET value = '12' WHERE key = 'service_percent'`);

    const cRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1007' });
    cashierToken = cRes.body.token;

    const wRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1001' });
    waiterToken = wRes.body.token;
  });

  it('should calculate server-authoritative quote with subtotal, service 12%, and VAT 14%', async () => {
    // Submit order on Table 7
    await request(app)
      .post('/api/orders')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ table_number: 7, item_name: 'لاتيه', quantity: 2 }); // 2 x 50 = 100 EGP

    const quoteRes = await request(app)
      .get('/api/quote?table_number=7')
      .set('Cookie', [`session_token=${cashierToken}`]);

    assert.strictEqual(quoteRes.status, 200);
    const q = quoteRes.body.quote;
    assert.strictEqual(q.subtotal, 100);
    assert.strictEqual(q.service_amount, 12); // 12% of 100
    assert.strictEqual(q.vat_amount, 15.68); // 14% of 112 = 15.68
    assert.strictEqual(q.total_amount, 127.68); // 100 + 12 + 15.68 = 127.68
  });

  it('should process multi-method split checkout and award loyalty points', async () => {
    const customerPhone = '01012345678';

    const checkoutRes = await request(app)
      .post('/api/checkout')
      .set('Cookie', [`session_token=${cashierToken}`])
      .send({
        table_number: 7,
        customer_phone: customerPhone,
        payments: [
          { method: 'CASH', amount: 100 },
          { method: 'VISA', amount: 30 }
        ]
      });

    assert.strictEqual(checkoutRes.status, 200);
    assert.strictEqual(checkoutRes.body.success, true);
    assert.strictEqual(checkoutRes.body.invoice.total_amount, 127.68);
    assert.strictEqual(checkoutRes.body.invoice.change_owed, 2.32); // 130 - 127.68 = 2.32 EGP

    // Verify Customer record & Loyalty Points
    const customer = await getQuery(`SELECT * FROM customers WHERE phone = ?`, [customerPhone]);
    assert.ok(customer);
    assert.ok(customer.points >= 12); // Earned 12 points for ~127.68 EGP spend
  });
});
