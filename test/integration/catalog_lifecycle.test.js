const request = require('supertest');
const assert = require('assert');
const { createApp } = require('../../src/app');
const app = createApp();
const { getDb } = require('../../src/db/connection');

describe('Catalog Lifecycle & POS Contract Integration Tests', () => {
  let adminCookie;
  let categoryId;
  let itemId;

  before(async () => {
    const { runQuery } = require('../../src/db/connection');
    await runQuery(`DELETE FROM menu_items WHERE sku = 'V60-001'`);

    // Authenticate as Admin
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1001' }); // Admin PIN
    
    adminCookie = loginRes.headers['set-cookie'];
  });

  it('should strictly validate POS nested menu schema and minor-unit prices', async () => {
    const res = await request(app)
      .get('/api/catalog/menu')
      .set('Cookie', adminCookie)
      .expect(200);

    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.menu), 'Menu should be an array of categories');
    
    const category = res.body.menu[0];
    assert(category.id, 'Category must have ID');
    assert(Array.isArray(category.items), 'Category must contain nested items array');
    
    if (category.items.length > 0) {
      const item = category.items[0];
      assert(item.id, 'Item must have ID');
      assert(item.price_minor !== undefined, 'Item must expose minor-unit price');
      assert.strictEqual(item.lifecycle_state, 'PUBLISHED', 'Only published items should be in active POS menu');
    }
  });

  it('should create a new item in DRAFT state', async () => {
    const res = await request(app)
      .post('/api/catalog/menu/items')
      .set('Cookie', adminCookie)
      .send({
        name: 'V60 Coffee Special',
        sku: 'V60-001',
        category_id: 1,
        department: 'BARISTA',
        price_minor: 6000
      })
      .expect(200);

    assert.strictEqual(res.body.success, true);
    itemId = res.body.item_id;
  });

  it('should reject semantic duplicates on SKU', async () => {
    const res = await request(app)
      .post('/api/catalog/menu/items')
      .set('Cookie', adminCookie)
      .send({
        name: 'Another V60',
        sku: 'V60-001',
        category_id: 1,
        department: 'BARISTA',
        price_minor: 6500
      })
      .expect(409);

    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /Duplicate SKU/i);
  });

  it('should publish the item to the catalog', async () => {
    const res = await request(app)
      .post(`/api/catalog/menu/items/${itemId}/publish`)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', '1')
      .send({})
      .expect(200);

    assert.strictEqual(res.body.success, true);
  });
});
