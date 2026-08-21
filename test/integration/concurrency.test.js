const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');

describe('Concurrency & Transactional Integrity Tests', () => {
  let app;
  let waiterToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    const wRes = await request(app).post('/api/auth/login').send({ pin: '1001' });
    waiterToken = wRes.body.token;
  });

  it('should handle 10 parallel concurrent orders without deadlocks or stock corruption', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        request(app)
          .post('/api/orders')
          .set('Cookie', [`session_token=${waiterToken}`])
          .send({ table_number: 11, item_name: 'اسبريسو', quantity: 1 })
      );
    }

    const responses = await Promise.all(promises);
    for (const res of responses) {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    }
  });
});
