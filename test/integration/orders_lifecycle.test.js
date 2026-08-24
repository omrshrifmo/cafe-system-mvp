const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { allQuery, getQuery } = require('../../src/db/connection');

describe('Orders Lifecycle & BOM Integration Tests', () => {
  let app;
  let waiterToken;
  let baristaToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Login as Waiter
    const waiterRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1001' });
    waiterToken = waiterRes.body.token;

    // Login as Barista
    const baristaRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1002' });
    baristaToken = baristaRes.body.token;
  });

  it('should submit order with table, deduct exact BOM inventory ledger atomically', async () => {
    // Check initial stock for coffee beans item
    const initialInv = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE name LIKE '%بن%' OR name LIKE '%قهوة%' LIMIT 1`);
    const itemId = initialInv.id;
    const initialStock = initialInv.current_stock_microunits;

    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({
        table_number: 2,
        item_name: 'لاتيه',
        quantity: 2,
        sugar_level: 'مظبوط'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.order.table_number, 2);

    const orderId = res.body.order.id;

    // Verify BOM consumption in inventory_items
    const postInv = await getQuery(`SELECT current_stock_microunits FROM inventory_items WHERE id = ?`, [itemId]);
    const { getMenuItemWithActivePriceAndBOM } = require('../../src/domain/catalog/service');
    const latteBom = await getMenuItemWithActivePriceAndBOM('لاتيه');
    const ingDef = latteBom && latteBom.ingredients ? latteBom.ingredients.find(i => i.inventory_item_id === itemId) : null;
    const perUnitMicro = ingDef ? ingDef.quantity_microunits : 18000000;
    const expectedConsumption = 2 * perUnitMicro;
    assert.strictEqual(postInv.current_stock_microunits, initialStock - expectedConsumption);

    // Verify inventory_ledger entry
    const ledger = await allQuery(`SELECT * FROM inventory_ledger WHERE source_id = ? AND event_type = 'CONSUMPTION'`, [String(orderId)]);
    assert.ok(ledger.length >= 1);
  });

  it('should transition KDS state from PENDING -> ACCEPTED -> READY -> DELIVERED', async () => {
    // Create new order
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ table_number: 4, item_name: 'اسبريسو', quantity: 1 });

    const orderId = orderRes.body.order.id;

    // Barista accepts
    const acceptRes = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Cookie', [`session_token=${baristaToken}`])
      .send({ status: 'ACCEPTED' });
    assert.strictEqual(acceptRes.status, 200);
    assert.strictEqual(acceptRes.body.result.kds_status, 'ACCEPTED');

    // Barista marks ready
    const readyRes = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Cookie', [`session_token=${baristaToken}`])
      .send({ status: 'READY' });
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.body.result.kds_status, 'READY');

    // Waiter delivers
    const deliverRes = await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ status: 'DELIVERED' });
    assert.strictEqual(deliverRes.status, 200);
    assert.strictEqual(deliverRes.body.result.kds_status, 'DELIVERED');
  });

  it('should handle cancellation handshake for ACCEPTED orders', async () => {
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ table_number: 6, item_name: 'لاتيه', quantity: 1 });
    const orderId = orderRes.body.order.id;

    // Barista accepts
    await request(app)
      .put(`/api/orders/${orderId}/status`)
      .set('Cookie', [`session_token=${baristaToken}`])
      .send({ status: 'ACCEPTED' });

    // Waiter requests cancel
    const cancelReqRes = await request(app)
      .post(`/api/orders/${orderId}/cancel-request`)
      .set('Cookie', [`session_token=${waiterToken}`])
      .send({ reason: 'الزبون غير رأيه' });
    assert.strictEqual(cancelReqRes.body.edit_request, 'CANCEL_REQUESTED');

    // Barista approves cancel handshake
    const resolveRes = await request(app)
      .post(`/api/orders/${orderId}/cancel-resolve`)
      .set('Cookie', [`session_token=${baristaToken}`])
      .send({ approved: true });
    assert.strictEqual(resolveRes.body.success, true);

    // Verify order item is cancelled
    const item = await getQuery(`SELECT status, kds_status FROM order_items WHERE id = ?`, [orderId]);
    assert.strictEqual(item.status, 'CANCELLED');
    assert.strictEqual(item.kds_status, 'CANCELLED');
  });
});
