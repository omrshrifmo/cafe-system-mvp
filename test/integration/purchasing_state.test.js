const assert = require('assert');
const { createPurchaseOrder, addPurchaseOrderLine, submitPurchaseOrder, approvePurchaseOrder, receivePurchaseOrder } = require('../../src/domain/inventory/purchasingService');
const { runQuery, getQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');

describe('Purchasing State Machine', () => {
  before(async () => {
    await runMigrations();
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Main Branch')`);
    await runQuery(`INSERT OR IGNORE INTO suppliers (id, name) VALUES (1, 'Main Supplier')`);
    await runQuery(`INSERT OR IGNORE INTO inventory_items (id, name, unit, cost_per_unit_minor) VALUES (1, 'Coffee Beans', 'KG', 5000)`);
  });

  it('should transition through draft, approval, and receipt idempotently', async () => {
    // 1. DRAFT
    const poId = 'PO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const idemKey = 'KEY-' + Date.now();
    await createPurchaseOrder({ id: poId, supplier_id: 1, venue_id: 'V_DEFAULT', actor_id: 1 });
    
    const lineId = 'LINE-1-' + Date.now();
    await addPurchaseOrderLine({ id: lineId, purchase_order_id: poId, inventory_item_id: 1, expected_quantity_microunits: 1000, unit: 'KG', unit_cost_minor: 5000 });

    // 2. SUBMIT
    await submitPurchaseOrder(poId, 1);

    // 3. APPROVE
    await approvePurchaseOrder(poId, 1);

    // 4. RECEIVE (Idempotency test)
    const result1 = await receivePurchaseOrder(poId, [{ line_id: lineId, quantity_microunits: 1000, location_id: 'LOC_DEFAULT', unit_cost_minor: 5000 }], 1, idemKey);
    assert.strictEqual(result1.status, 'SUCCESS');

    const result2 = await receivePurchaseOrder(poId, [{ line_id: lineId, quantity_microunits: 1000, location_id: 'LOC_DEFAULT', unit_cost_minor: 5000 }], 1, idemKey);
    assert.strictEqual(result2.status, 'IDEMPOTENT_RETRY');
  });
});
