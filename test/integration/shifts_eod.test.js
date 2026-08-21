const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');

describe('Shifts & Blind Cash Declaration Integration Tests', () => {
  let app;
  let cashierToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    const cRes = await request(app).post('/api/auth/login').send({ pin: '1007' });
    cashierToken = cRes.body.token;
  });

  it('should allow cashier to clock in, fetch their own shift report, and submit blind cash declaration', async () => {
    // Clock in
    const clockInRes = await request(app)
      .post('/api/shifts/clock-in')
      .set('Cookie', [`session_token=${cashierToken}`])
      .send({ shift_type: 'EVENING' });
    assert.strictEqual(clockInRes.status, 200);

    // Get individual shift report
    const meRes = await request(app)
      .get('/api/shifts/me')
      .set('Cookie', [`session_token=${cashierToken}`]);
    assert.strictEqual(meRes.status, 200);
    assert.ok(meRes.body.expected_cash >= 0);

    // Submit blind cash declaration
    const decRes = await request(app)
      .post('/api/shifts/declare-cash-extended')
      .set('Cookie', [`session_token=${cashierToken}`])
      .send({
        shift_type: 'EVENING',
        opening_float: 500,
        actual_cash: meRes.body.expected_cash
      });

    assert.strictEqual(decRes.status, 200);
    assert.strictEqual(decRes.body.success, true);
    assert.strictEqual(decRes.body.declaration.variance, 0);
  });
});
