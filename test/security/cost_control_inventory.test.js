/**
 * Safe Raw-Material, Purchasing Lifecycle & Operating-Cost Control Test Suite
 */
const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getQuery, allQuery, runQuery } = require('../../src/db/connection');

describe('Safe Raw-Material, Purchasing Lifecycle & Operating-Cost Control', function () {
  this.timeout(25000);
  let app;
  let ownerCookies;

  before(async () => {
    await runMigrations();
    app = createApp();

    const { hashPin } = require('../../src/domain/auth/service');
    const ownerHash = await hashPin('1009');
    await runQuery(`UPDATE v3_users SET pin_hash = ? WHERE role_id = 'R_OWNER'`, [ownerHash]);
    await runQuery(`UPDATE v3_users SET role_id = 'R_OWNER', pin_hash = ? WHERE id = '43'`, [ownerHash]);
    await runQuery(`UPDATE v3_users SET role_id = 'R_OWNER', pin_hash = ? WHERE id = '102'`, [ownerHash]);
    await runQuery(`UPDATE inventory SET unit_cost = 1.0 WHERE unit_cost = 0`);
    await runQuery(`UPDATE inventory_items SET cost_per_unit_minor = 100 WHERE cost_per_unit_minor = 0`);

    // Login as OWNER (User 102 / PIN 1009)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });
    ownerCookies = ownerRes.headers['set-cookie'] || [`session_token=${ownerRes.body.sessionId}`];
  });

  describe('1. Purchasing Document Lifecycle & Safe Idempotent Receiving', () => {
    let draftPurchaseId;
    let initialMilkStock;

    it('should create purchase draft without affecting stock balance or ledger', async () => {
      const milkItem = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE name LIKE '%حليب%' LIMIT 1`);
      initialMilkStock = milkItem.current_stock_microunits;

      const draftRes = await request(app)
        .post('/api/purchases/draft')
        .set('Cookie', ownerCookies)
        .send({
          supplier_id: 2,
          invoice_number: 'INV-TEST-9001',
          currency: 'ج.م',
          tax_minor: 1400,
          items: [
            {
              inventory_item_id: milkItem.id,
              quantity: 10, // 10 liters
              unit: 'ml',
              unit_cost: 0.04 // 4 piasters per ml = 40 EGP/L
            }
          ],
          notes: 'طلبية حليب أسبوعية'
        })
        .expect(200);

      const draftData = draftRes.body.data || draftRes.body;
      assert.strictEqual(draftData.status, 'DRAFT');
      assert.strictEqual(draftData.subtotal_minor, 40);
      draftPurchaseId = draftData.id;

      // Verify stock did NOT change
      const milkItemAfter = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE id = ?`, [milkItem.id]);
      assert.strictEqual(milkItemAfter.current_stock_microunits, initialMilkStock);

      // Verify NO ledger entry was created
      const ledgerEntry = await getQuery(`SELECT * FROM inventory_ledger WHERE source_type = 'PURCHASE_ORDER' AND source_id = ?`, [String(draftPurchaseId)]);
      assert.ok(!ledgerEntry, 'Draft must not write to inventory ledger');
    });

    it('should transition purchase from DRAFT -> SUBMITTED -> APPROVED', async () => {
      const submitRes = await request(app)
        .post(`/api/purchases/${draftPurchaseId}/submit`)
        .set('Cookie', ownerCookies)
        .send({})
        .expect(200);
      assert.strictEqual((submitRes.body.data || submitRes.body).status, 'SUBMITTED');

      const approveRes = await request(app)
        .post(`/api/purchases/${draftPurchaseId}/approve`)
        .set('Cookie', ownerCookies)
        .send({ pin: '1009' })
        .expect(200);
      assert.strictEqual((approveRes.body.data || approveRes.body).status, 'APPROVED');
    });

    it('should receive purchase order, create PURCHASE_RECEIPT ledger entry, and update WAC', async () => {
      const receiveRes = await request(app)
        .post(`/api/purchases/${draftPurchaseId}/receive`)
        .set('Cookie', ownerCookies)
        .set('X-Idempotency-Key', 'IDEMP-PURCHASE-REC-001')
        .send({
          lines: [
            {
              purchase_item_id: (await getQuery(`SELECT id FROM purchase_items WHERE purchase_id = ? LIMIT 1`, [draftPurchaseId])).id,
              received_quantity: 10,
              storage_location: 'MAIN_STORAGE',
              expiry_date: '2026-12-31'
            }
          ]
        })
        .expect(200);

      const receiveData = receiveRes.body.data || receiveRes.body;
      assert.strictEqual(receiveData.status, 'RECEIVED');
      assert.ok(receiveData.grn_number.startsWith('GRN-'));

      // Verify stock increased by 10,000,000 microunits (10L)
      const milkItem = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE name LIKE '%حليب%' LIMIT 1`);
      assert.strictEqual(milkItem.current_stock_microunits, initialMilkStock + 10000000);

      // Verify immutable RECEIPT ledger entry
      const ledgerRow = await getQuery(
        `SELECT * FROM inventory_ledger WHERE source_id = ? AND (event_type = 'RECEIPT' OR event_type = 'PURCHASE_RECEIPT')`,
        [String(draftPurchaseId)]
      );
      assert.ok(ledgerRow, 'PURCHASE_RECEIPT ledger entry must exist');
      assert.strictEqual(ledgerRow.quantity_delta_microunits, 10000000);
      assert.strictEqual(ledgerRow.unit_cost_minor, 4);
    });

    it('should prevent duplicate receiving on same purchase order (Idempotency)', async () => {
      const pItem = await getQuery(`SELECT id FROM purchase_items WHERE purchase_id = ? LIMIT 1`, [draftPurchaseId]);
      const ledgerCountBefore = (await allQuery(`SELECT id FROM inventory_ledger WHERE source_id = ?`, [String(draftPurchaseId)])).length;

      const dupRes = await request(app)
        .post(`/api/purchases/${draftPurchaseId}/receive`)
        .set('Cookie', ownerCookies)
        .set('X-Idempotency-Key', 'IDEMP-PURCHASE-REC-001')
        .send({
          lines: [
            {
              purchase_item_id: pItem.id,
              received_quantity: 10
            }
          ]
        });

      // Should return success/duplicate without creating a second ledger row
      const ledgerCountAfter = (await allQuery(`SELECT id FROM inventory_ledger WHERE source_id = ?`, [String(draftPurchaseId)])).length;
      assert.strictEqual(ledgerCountAfter, ledgerCountBefore);
    });

    it('should reverse received purchase order, create RETURN_SUPPLIER ledger entry, and restore stock', async () => {
      const reverseRes = await request(app)
        .post(`/api/purchases/${draftPurchaseId}/reverse`)
        .set('Cookie', ownerCookies)
        .send({ pin: '1009', reason: 'عيوب في توريد الحليب' })
        .expect(200);

      const reverseData = reverseRes.body.data || reverseRes.body;
      assert.strictEqual(reverseData.status, 'REVERSED');

      // Verify stock was restored to initial
      const milkItem = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE name LIKE '%حليب%' LIMIT 1`);
      assert.strictEqual(milkItem.current_stock_microunits, initialMilkStock);

      // Verify compensatory RETURN_SUPPLIER ledger entry
      const returnEntry = await getQuery(`SELECT * FROM inventory_ledger WHERE source_id = ? AND event_type = 'RETURN_SUPPLIER'`, [String(draftPurchaseId)]);
      assert.ok(returnEntry, 'RETURN_SUPPLIER ledger entry must exist');
      assert.strictEqual(returnEntry.quantity_delta_microunits, -10000000);
    });
  });

  describe('2. Append-Only Ledger & Balance Parity Audit', () => {
    it('should verify that all items have current_stock equal to sum of ledger events', async () => {
      const auditRes = await request(app)
        .get('/api/inventory/reconciliation')
        .set('Cookie', ownerCookies)
        .expect(200);

      const reconciliation = auditRes.body.data?.reconciliation || auditRes.body.reconciliation;
      assert.ok(Array.isArray(reconciliation));

      for (const item of reconciliation) {
        assert.strictEqual(item.variance, 0, `Item [${item.name}] must have zero ledger variance`);
        assert.ok(item.unit, `Item [${item.name}] must have defined unit`);
        assert.ok(item.unit_cost > 0, `Item [${item.name}] must have non-zero cost`);
      }
    });
  });

  describe('3. Negative Stock Policy Enforcement', () => {
    it('should block waste logging when item stock is insufficient under BLOCK policy', async () => {
      // Attempt to waste 9999999 units of an item
      const item = await getQuery(`SELECT id, name FROM inventory_items WHERE name LIKE '%بن%' OR name LIKE '%قهوة%' OR name LIKE '%حليب%' LIMIT 1`);
      assert.ok(item);

      const wasteRes = await request(app)
        .post('/api/inventory/waste')
        .set('Cookie', ownerCookies)
        .send({
          inventory_id: item.id,
          quantity: 999999,
          reason: 'إتلاف غير مبرر'
        })
        .expect(500);

      const errBody = wasteRes.body;
      assert.strictEqual(errBody.success, false);
      assert.ok(errBody.error.includes('INSUFFICIENT_STOCK'));
    });
  });

  describe('4. Stocktaking (Physical Inventory) Lifecycle', () => {
    let stocktakeSessionId;

    it('should freeze stocktake session with current expected stock levels', async () => {
      const freezeRes = await request(app)
        .post('/api/stocktakes/freeze')
        .set('Cookie', ownerCookies)
        .send({ notes: 'جرد نهاية الشهر الدوري' })
        .expect(200);

      const freezeData = freezeRes.body.data || freezeRes.body;
      assert.strictEqual(freezeData.status, 'FROZEN');
      stocktakeSessionId = freezeData.id;
      assert.ok(freezeData.items_frozen > 0);
    });

    it('should record counted quantities and compute variances', async () => {
      const coffeeItem = await getQuery(`SELECT id, current_stock_microunits FROM inventory_items WHERE name LIKE '%قهوة%' OR name LIKE '%بن%' LIMIT 1`);
      assert.ok(coffeeItem, 'Coffee item must exist for stocktake test');
      const currentQty = coffeeItem.current_stock_microunits / 1000000.0;
      const countedQty = currentQty - 0.5; // 500g shortage

      const countRes = await request(app)
        .post(`/api/stocktakes/${stocktakeSessionId}/count`)
        .set('Cookie', ownerCookies)
        .send({
          lines: [
            {
              inventory_item_id: coffeeItem.id,
              counted_quantity: countedQty,
              reason: 'تسوية عجز جرد بن إسبريسو'
            }
          ]
        })
        .expect(200);

      assert.strictEqual((countRes.body.data || countRes.body).status, 'COUNTED');

      // Review stocktake
      const reviewRes = await request(app)
        .post(`/api/stocktakes/${stocktakeSessionId}/review`)
        .set('Cookie', ownerCookies)
        .send({})
        .expect(200);

      const reviewData = reviewRes.body.data || reviewRes.body;
      assert.strictEqual(reviewData.status, 'REVIEWED');
      const coffeeLine = reviewData.lines.find(l => l.inventory_item_id === coffeeItem.id);
      assert.strictEqual(coffeeLine.variance_quantity, -0.5);
    });

    it('should post stocktake, create COUNT_ADJUSTMENT ledger entry, and update stock', async () => {
      const postRes = await request(app)
        .post(`/api/stocktakes/${stocktakeSessionId}/post`)
        .set('Cookie', ownerCookies)
        .send({ pin: '1009' })
        .expect(200);

      assert.strictEqual((postRes.body.data || postRes.body).status, 'POSTED');

      // Verify ledger adjustment row
      const adjEntry = await getQuery(
        `SELECT * FROM inventory_ledger WHERE source_id = ? AND event_type = 'COUNT_ADJUSTMENT'`,
        [stocktakeSessionId]
      );
      assert.ok(adjEntry, 'COUNT_ADJUSTMENT ledger entry must exist');
      assert.strictEqual(adjEntry.quantity_delta_microunits, -500000);
    });
  });

  describe('5. Operating Expenses & Versioned Indirect Cost Allocation', () => {
    let recordedExpenseId;

    it('should record structured operating expense with allocation policy', async () => {
      const expRes = await request(app)
        .post('/api/expenses')
        .set('Cookie', ownerCookies)
        .send({
          vendor_id: 'VEND_ELECTRICITY',
          category_id: 'CAT_UTILITIES',
          amount: 5000, // 5000 EGP electricity bill
          tax: 700,
          billing_period_start: '2026-08-01',
          billing_period_end: '2026-08-31',
          notes: 'فاتورة كهرباء شهر أغسطس',
          allocation_policy: {
            basis: 'AREA_PROPORTION',
            ratios: {
              BARISTA: 3000,  // 30%
              KITCHEN: 5000,  // 50%
              SHISHA: 2000    // 20%
            }
          }
        })
        .expect(200);

      const expData = expRes.body.data || expRes.body;
      assert.ok(expData.id);
      recordedExpenseId = expData.id;
    });

    it('should retrieve categorized expenses with department allocation breakdowns', async () => {
      const listRes = await request(app)
        .get('/api/expenses')
        .set('Cookie', ownerCookies)
        .expect(200);

      const expenses = listRes.body.data?.expenses || listRes.body.expenses;
      assert.ok(Array.isArray(expenses));

      const target = expenses.find(e => e.id === recordedExpenseId);
      assert.ok(target, 'Target recorded expense must exist');
      assert.strictEqual(target.is_allocated, true);
      assert.strictEqual(target.allocations.length, 3);

      const kitchenAlloc = target.allocations.find(a => a.department === 'KITCHEN');
      assert.strictEqual(kitchenAlloc.ratio_percent, 50);
      assert.strictEqual(kitchenAlloc.allocated_amount, 2500); // 50% of 5000
    });

    it('should reallocate indirect costs using revenue proportion basis', async () => {
      const allocRes = await request(app)
        .post(`/api/expenses/${recordedExpenseId}/allocate`)
        .set('Cookie', ownerCookies)
        .send({
          basis: 'REVENUE_PROPORTION',
          ratios: {
            BARISTA: 6000, // 60%
            KITCHEN: 3000, // 30%
            SHISHA: 1000   // 10%
          }
        })
        .expect(200);

      const allocData = allocRes.body.data || allocRes.body;
      assert.strictEqual(allocData.basis, 'REVENUE_PROPORTION');

      const baristaAlloc = allocData.allocations.find(a => a.department === 'BARISTA');
      assert.strictEqual(baristaAlloc.allocated_amount, 3000); // 60% of 5000
    });
  });

  describe('6. Supplier Master & Item Purchase History', () => {
    it('should return supplier master details with item purchase history', async () => {
      const supRes = await request(app)
        .get('/api/suppliers/1')
        .set('Cookie', ownerCookies)
        .expect(200);

      const supplier = supRes.body.data?.supplier || supRes.body.supplier;
      assert.ok(supplier, 'Supplier 1 must be returned');
      assert.ok(supplier.name);
      assert.ok(Array.isArray(supplier.history));
    });
  });
});
