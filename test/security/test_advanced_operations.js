/**
 * Advanced Operations & Profitability Test Suite
 * Validates:
 * 1. BOGO & Advanced Promotions Engine in Checkout
 * 2. Physical Stocktaking & Theft Variance Engine with Owner/Manager PIN Approval
 * 3. Menu Engineering Dynamic Costing & Stars vs Dogs Matrix
 * 4. Entertainment Session Hourly Rental & MikroTik WiFi Vouchers
 */
'use strict';

const path = require('path');
process.env.NODE_ENV = 'test';
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '../fixtures/full_day_fixture.db');
}

const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getDb, runQuery, allQuery, getQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');
const { createPromotion } = require('../../src/domain/promotions/promotionEngine');
const { createStocktakeSession, recordBlindCounts, getStocktakeVarianceReport } = require('../../src/domain/inventory/stocktakeService');

describe('Advanced Operational & Profitability Upgrades Test Suite', function() {
  this.timeout(60000);

  let app;
  let ownerCookie;
  let opManagerCookie;

  before(async () => {
    process.env.NODE_ENV = 'test';
    try {
      await runQuery(`DELETE FROM schema_migrations WHERE version = '032_advanced_operations_and_promotions.sql'`);
    } catch (e) {}
    await runMigrations();
    try {
      await runQuery(`ALTER TABLE entertainment_sessions ADD COLUMN notes TEXT`);
    } catch (e) {}

    app = createApp();

    // Login as Owner (PIN 1010)
    const ownerRes = await request(app).post('/api/auth/login').send({ pin: '1010' });
    ownerCookie = ownerRes.headers['set-cookie'];

    // Login as OP Manager (PIN 1008)
    const opRes = await request(app).post('/api/auth/login').send({ pin: '1008' });
    opManagerCookie = opRes.headers['set-cookie'];
  });

  describe('1. Advanced Promotions Engine & Checkout Integration', () => {
    it('should create a BOGO promotion and apply automatic deduction at checkout', async () => {
      // Clear existing promotions
      await runQuery(`DELETE FROM promotions`);

      // Create BOGO promotion: Buy 1 "شيشة تفاح فاخر" get 2nd free (or buy 2 pay for 1)
      const promoRes = await createPromotion({
        name: 'عرض شيشة 1+1 مجاناً',
        type: 'BOGO',
        target_item_name: 'شيشة تفاح فاخر',
        discount_percent: 0,
        discount_amount: 0
      });
      assert.strictEqual(promoRes.success, true);

      // Perform checkout with 2x "شيشة تفاح فاخر" @ 60 EGP each (Total = 120 EGP, with BOGO discount = -60 EGP, Subtotal = 60 EGP)
      const checkoutRes = await request(app)
        .post('/api/checkout')
        .set('Cookie', ownerCookie)
        .send({
          order_type: 'TAKEAWAY',
          items: [
            { item_name: 'شيشة تفاح فاخر', price: 60, quantity: 2, unit_price_minor: 6000 }
          ],
          subtotal: 120,
          payments: [
            { method: 'CASH', amount: 150 }
          ]
        });

      assert.strictEqual(checkoutRes.status, 200);
      assert.strictEqual(checkoutRes.body.success, true);
      // Verify bill after BOGO discount
      const bill = checkoutRes.body.bill || checkoutRes.body.invoice;
      assert.ok(bill, 'Bill or invoice must be returned');
      assert.ok(bill.total_amount < 120, `Bill total (${bill.total_amount}) should reflect BOGO discount on second item`);
    });
  });

  describe('2. Physical Stocktakes, Blind Counting & Theft Control', () => {
    let stocktakeId;
    let testItemId;

    it('should create a physical stocktake session and record blind counts with deliberate variance', async () => {
      // Find or create test raw material in inventory_items
      let existingItem = await getQuery(`SELECT id FROM inventory_items WHERE name = 'شاي أحمد تي فاخر'`);
      if (existingItem) {
        testItemId = existingItem.id;
        await runQuery(
          `UPDATE inventory_items SET cost_per_unit_minor = 15000, current_stock_microunits = 10000000, is_active = 1 WHERE id = ?`,
          [testItemId]
        );
      } else {
        const invRes = await runQuery(
          `INSERT INTO inventory_items (name, unit, cost_per_unit_minor, current_stock_microunits, is_active)
           VALUES ('شاي أحمد تي فاخر', 'كجم', 15000, 10000000, 1)`
        );
        testItemId = invRes.lastID;
      }

      // Start stocktake session
      const createRes = await createStocktakeSession('V_DEFAULT', 42, 'DAILY', 'جرد تجريبي للتحقق');
      assert.strictEqual(createRes.success, true);
      stocktakeId = createRes.session_id;

      // Staff enters blind count of 7.0 kg (deliberate deficit of -3.0 kg, value -450 EGP)
      const countRes = await recordBlindCounts(stocktakeId, [
        { item_id: testItemId, physical_count: 7.0, reason: 'جرد فعلي بالوزن' }
      ], 42);
      assert.strictEqual(countRes.success, true);

      // Verify variance report detects theft/shrinkage
      const varReport = await getStocktakeVarianceReport(stocktakeId);
      assert.strictEqual(varReport.success, true);
      assert.ok(varReport.summary.theft_suspect_count >= 1, 'Should flag high deficit as theft/shrinkage suspect');
      assert.strictEqual(varReport.summary.requires_manager_approval, true);

      const targetLine = varReport.lines.find(l => l.item_id === testItemId);
      assert.ok(targetLine, 'Target item line must exist');
      assert.strictEqual(targetLine.expected_stock, 10.0);
      assert.strictEqual(targetLine.counted_stock, 7.0);
      assert.strictEqual(targetLine.variance, -3.0);
      assert.strictEqual(targetLine.is_theft_suspect, true);
    });

    it('should reconcile stocktake and adjust inventory only with valid Owner/Manager PIN', async () => {
      // Attempt with invalid PIN -> should reject
      const badRes = await request(app)
        .post(`/api/stocktakes/${stocktakeId}/reconcile`)
        .set('Cookie', opManagerCookie)
        .send({ pin: '0000' });
      assert.ok(badRes.status === 403 || badRes.status === 500);

      // Reconcile with OP_MANAGER PIN (1008)
      const goodRes = await request(app)
        .post(`/api/stocktakes/${stocktakeId}/reconcile`)
        .set('Cookie', opManagerCookie)
        .send({ pin: '1008' });

      assert.strictEqual(goodRes.status, 200);
      assert.strictEqual(goodRes.body.success, true);

      // Verify inventory current_stock_microunits was updated to 7000000 (7.0 kg)
      const updatedItem = await new Promise(resolve => {
        getDb().get(`SELECT current_stock_microunits FROM inventory_items WHERE id = ?`, [testItemId], (err, row) => resolve(row));
      });
      assert.strictEqual(updatedItem.current_stock_microunits, 7000000);
    });
  });

  describe('3. Dynamic Recipe Costing & Menu Engineering Matrix', () => {
    it('should compute real-time food cost and classify item in Menu Engineering Matrix', async () => {
      // Find or create test menu item
      let menuItemId;
      const existingMenu = await getQuery(`SELECT id FROM menu_items WHERE name = 'إسبريسو سينجل فاخر'`);
      if (existingMenu) {
        menuItemId = existingMenu.id;
      } else {
        const menuRes = await runQuery(
          `INSERT INTO menu_items (name, department, is_available)
           VALUES ('إسبريسو سينجل فاخر', 'BARISTA', 1)`
        );
        menuItemId = menuRes.lastID;
      }

      await runQuery(`DELETE FROM menu_prices WHERE menu_item_id = ?`, [menuItemId]);
      await runQuery(
        `INSERT INTO menu_prices (menu_item_id, amount_minor)
         VALUES (?, 4000)`,
        [menuItemId]
      );

      // Find or create ingredient in inventory_items
      let ingId;
      const existingIng = await getQuery(`SELECT id FROM inventory_items WHERE name = 'بن برازيلي فاخر'`);
      if (existingIng) {
        ingId = existingIng.id;
        await runQuery(
          `UPDATE inventory_items SET unit = 'جم', cost_per_unit_minor = 50, current_stock_microunits = 5000000000, is_active = 1 WHERE id = ?`,
          [ingId]
        );
      } else {
        const ingRes = await runQuery(
          `INSERT INTO inventory_items (name, unit, cost_per_unit_minor, current_stock_microunits, is_active)
           VALUES ('بن برازيلي فاخر', 'جم', 50, 5000000000, 1)`
        );
        ingId = ingRes.lastID;
      }

      // Link recipe (18g coffee @ 0.50 EGP/g = 9.0 EGP cost)
      await runQuery(`DELETE FROM recipes WHERE menu_item_id = ?`, [menuItemId]);
      await runQuery(
        `INSERT INTO recipes (menu_item_id, ingredient_id, quantity_required, unit)
         VALUES (?, ?, 18.0, 'جم')`,
        [menuItemId, ingId]
      );

      // Query Menu Engineering endpoint
      const reportRes = await request(app)
        .get('/api/menu-engineering?threshold=40')
        .set('Cookie', ownerCookie);

      assert.strictEqual(reportRes.status, 200);
      assert.strictEqual(reportRes.body.success, true);
      assert.ok(reportRes.body.matrix, 'Matrix object must be present');

      // Verify dynamic cost of item
      const itemCostRes = await request(app)
        .get(`/api/menu-engineering/item/${menuItemId}`)
        .set('Cookie', ownerCookie);

      assert.strictEqual(itemCostRes.status, 200);
      assert.strictEqual(itemCostRes.body.total_cost_egp, 9.0);
    });
  });

  describe('4. Entertainment Sessions & WiFi Hotspot Vouchers', () => {
    it('should start and stop entertainment session and generate WiFi voucher', async () => {
      // 1. Generate MikroTik WiFi voucher
      const wifiRes = await request(app)
        .post('/api/wifi/voucher')
        .set('Cookie', ownerCookie)
        .send({ profile: '1_HOUR', price: 15 });

      assert.strictEqual(wifiRes.status, 200);
      assert.strictEqual(wifiRes.body.success, true);
      assert.ok(wifiRes.body.voucher.code.startsWith('MZJ-'));
      assert.ok(wifiRes.body.voucher.mikrotik_hotspot_command.includes('limit-uptime="60m"'));

      // 2. Start PS5 entertainment rental session
      const resourcesRes = await request(app)
        .get('/api/entertainment/resources')
        .set('Cookie', ownerCookie);

      assert.strictEqual(resourcesRes.status, 200);
      const firstAvailable = resourcesRes.body.data.find(r => r.status === 'AVAILABLE');
      assert.ok(firstAvailable, 'Must have available entertainment resource');

      const startRes = await request(app)
        .post('/api/entertainment/sessions/start')
        .set('Cookie', ownerCookie)
        .send({
          resource_id: firstAvailable.id,
          table_number: 1,
          player_mode: 'SINGLE'
        });

      assert.strictEqual(startRes.status, 200);
      assert.strictEqual(startRes.body.success, true);
      const activeSessionId = startRes.body.session_id;

      // 3. Stop session
      const stopRes = await request(app)
        .post(`/api/entertainment/sessions/${activeSessionId}/stop`)
        .set('Cookie', ownerCookie)
        .set('Content-Type', 'application/json')
        .send({});

      if (stopRes.status !== 200) {
        console.error('STOP_SESSION_FAILURE:', stopRes.status, stopRes.body);
      }
      assert.strictEqual(stopRes.status, 200);
      assert.strictEqual(stopRes.body.success, true);
      assert.ok(stopRes.body.total_amount > 0);
    });
  });
});
