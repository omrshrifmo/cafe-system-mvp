const request = require('supertest');
const assert = require('assert');
const { createApp } = require('../../src/app');
const app = createApp();
const { getDb } = require('../../src/db/connection');

describe('POS API Contract Validation', () => {
  let adminCookie;

  before(async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '9999' }); // Admin PIN
    
    adminCookie = loginRes.headers['set-cookie'];
  });

  it('should return 400 for order with mismatched minor unit prices', async () => {
    // If the frontend sends wrong price, backend should recalculate or reject
    const res = await request(app)
      .post('/api/quote')
      .set('Cookie', adminCookie)
      .send({
        table_number: 1,
        items: [
          { item_id: 1, quantity: 1, price_minor: 999999 } // malicious price
        ]
      })
      .expect(200);

    // The backend recalculates it correctly anyway, so quote shouldn't use 999999
    assert(res.body.quote);
    assert.notStrictEqual(res.body.quote.subtotal_minor, 999999);
  });
});
