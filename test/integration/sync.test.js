const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');

describe('Offline Sync Batch Commands Integration Tests', () => {
  let app;
  let waiterToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    const wRes = await request(app).post('/api/auth/login').send({ pin: '1001' });
    waiterToken = wRes.body.token;
  });

  it('should process offline batch commands idempotently without duplication', async () => {
    const batchKey = 'SYNC_TEST_' + Date.now();

    const commands = [
      {
        client_command_id: 1,
        idempotency_key: batchKey,
        action: 'SUBMIT_ORDER',
        payload: { table_number: 10, item_name: 'لاتيه', quantity: 1 }
      }
    ];

    // First attempt -> APPLIED
    const firstRes = await request(app)
      .post('/api/sync/commands')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ commands });

    assert.strictEqual(firstRes.status, 200);
    assert.strictEqual(firstRes.body.results[0].status, 'APPLIED');

    // Duplicate attempt with same idempotency key -> DUPLICATE (cached result)
    const secondRes = await request(app)
      .post('/api/sync/commands')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ commands });

    assert.strictEqual(secondRes.status, 200);
    assert.strictEqual(secondRes.body.results[0].status, 'DUPLICATE');
  });
});
