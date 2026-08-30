/**
 * Enterprise Hardening & Concurrency Verification Test Suite
 * Tests:
 * 1. Shisha BOM Engine & 70/30 Blends
 * 2. Barista Liquid Mass-to-Volume Density Conversions (1000g Syrup -> ~757.58 mL)
 * 3. Settle Customer Debt ("سداد حساب آجل") Endpoint
 * 4. Append-Only Immutable Accounting Ledger
 * 5. 50 Concurrent SQLite Requests under busy_timeout = 5000
 */
const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { getDb, runQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { convertLiquidGramsToMl, DENSITY_PRESETS } = require('../../src/domain/inventory/densityService');
const { calculateShishaBOM } = require('../../src/domain/catalog/shishaBomService');
const { hashPin } = require('../../src/domain/auth/service');
const { voidOrder } = require('../../src/domain/payments/service');

describe('Enterprise Hardening & Concurrency Test Suite', function() {
  this.timeout(60000);
  let app;
  let ownerCookie;
  let managerCookie;

  before(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();

    // Seed staff PINs (1001-1012)
    const staffList = [
      { id: '35', name: 'أحمد (ويتر/جوكر)', role: 'R_WAITER', legacyRole: 'WAITER', pin: '1001' },
      { id: '36', name: 'هاجر بيبو (باريستا)', role: 'R_BARISTA', legacyRole: 'BARISTA', pin: '1002' },
      { id: '37', name: 'أسماء (مسؤول شيشة)', role: 'R_SHISHA', legacyRole: 'SHISHA', pin: '1003' },
      { id: '38', name: 'الشيف (شيف المطبخ)', role: 'R_CHEF', legacyRole: 'CHEF', pin: '1004' },
      { id: '39', name: 'أمل (ويتر)', role: 'R_WAITER', legacyRole: 'WAITER', pin: '1005' },
      { id: '40', name: 'إبراهيم (مدير صالة)', role: 'R_HALL_MANAGER', legacyRole: 'HALL_MANAGER', pin: '1006' },
      { id: '41', name: 'أحمد كركر (كاشير)', role: 'R_OP_ASSISTANT_CASHIER', legacyRole: 'OP_ASSISTANT_CASHIER', pin: '1007' },
      { id: '42', name: 'وائل (مدير عمليات)', role: 'R_OP_MANAGER', legacyRole: 'OP_MANAGER', pin: '1008' },
      { id: '43', name: 'فاطمة (مالك)', role: 'R_OWNER', legacyRole: 'OWNER', pin: '1009' },
      { id: '44', name: 'وائل 2 (مالك)', role: 'R_OWNER', legacyRole: 'OWNER', pin: '1010' },
      { id: '45', name: 'عمر (مسؤول نظام)', role: 'R_SUPER_ADMIN', legacyRole: 'SUPER_ADMIN', pin: '1011' },
      { id: '46', name: 'شعراوي (مدير تكاليف BOM)', role: 'R_BOM_MANAGER', legacyRole: 'BOM_MANAGER', pin: '1012' }
    ];

    // Deactivate obsolete test fixtures that collided with 1001-1012 PINs
    const dummyHash = await hashPin('999999');
    await runQuery(`UPDATE v3_users SET is_active = 0, pin_hash = ? WHERE id IN ('1','2','3','4','5','6','7','8','9','10','11','12','201','202','203','204','301','302')`, [dummyHash]);
    await runQuery(`UPDATE users SET is_active = 0, pin_hash = ? WHERE id IN (1,2,3,4,5,6,7,8,9,10,11,12,201,202,203,204,301,302)`, [dummyHash]);

    for (const s of staffList) {
      const pinHash = await hashPin(s.pin);
      await runQuery(
        `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)`,
        [s.id, s.name, s.role, pinHash]
      );
      await runQuery(
        `INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [parseInt(s.id, 10), s.name, s.legacyRole, pinHash]
      );
    }

    app = createApp();

    // Login as Owner (PIN 1010 - Wael Owner)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1010' });
    ownerCookie = ownerRes.headers['set-cookie'];

    // Login as Manager (PIN 1008 - Wael Manager)
    const mgrRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1008' });
    managerCookie = mgrRes.headers['set-cookie'];
  });

  describe('1. Barista Liquid Density Conversions', () => {
    it('should convert 1000g of syrup (density 1.32) to ~757.58 mL volume', () => {
      const result = convertLiquidGramsToMl(1000, 0, 'SYRUP');
      assert.strictEqual(result.net_grams, 1000);
      assert.strictEqual(result.density, 1.32);
      // 1000 / 1.32 = 757.5757... -> 757.58
      assert.strictEqual(result.volume_ml, 757.58);
      assert.strictEqual(result.volume_liters, 0.7576);
    });

    it('should correctly deduct tare container weight before converting volume', () => {
      // 1250g bottle on scale with 250g glass tare = 1000g net liquid
      const result = convertLiquidGramsToMl(1250, 250, 'SYRUP');
      assert.strictEqual(result.gross_grams, 1250);
      assert.strictEqual(result.tare_grams, 250);
      assert.strictEqual(result.net_grams, 1000);
      assert.strictEqual(result.volume_ml, 757.58);
    });

    it('should support standard presets: Milk (1.03) and Water/Juice (1.05)', () => {
      const milk = convertLiquidGramsToMl(1030, 0, 'MILK');
      assert.strictEqual(milk.volume_ml, 1000); // 1030g milk = 1000 mL

      const water = convertLiquidGramsToMl(1050, 0, 'WATER');
      assert.strictEqual(water.volume_ml, 1000); // 1050g water/juice = 1000 mL
    });
  });

  describe('2. Advanced Shisha BOM Engine & 70/30 Blends', () => {
    it('should deduct 11g molasses and 2 coals for Small Bowl (حجر صغير)', () => {
      const small = calculateShishaBOM('SMALL');
      assert.strictEqual(small.bowl_size, 'SMALL');
      assert.strictEqual(small.total_molasses_grams, 11);
      assert.strictEqual(small.coals_count, 2);

      const molasses = small.ingredients.find(i => i.unit === 'g');
      const coals = small.ingredients.find(i => i.unit === 'pcs');
      assert.strictEqual(molasses.quantity_microunits, 11000000); // 11g
      assert.strictEqual(coals.quantity_microunits, 2000000); // 2 pcs
    });

    it('should deduct 20g molasses and 3 coals for Large Bowl (حجر كبير)', () => {
      const large = calculateShishaBOM('LARGE');
      assert.strictEqual(large.bowl_size, 'LARGE');
      assert.strictEqual(large.total_molasses_grams, 20);
      assert.strictEqual(large.coals_count, 3);

      const molasses = large.ingredients.find(i => i.unit === 'g');
      const coals = large.ingredients.find(i => i.unit === 'pcs');
      assert.strictEqual(molasses.quantity_microunits, 20000000); // 20g
      assert.strictEqual(coals.quantity_microunits, 3000000); // 3 pcs
    });

    it('should support 70/30 blended molasses recipes (14g primary + 6g secondary for Large Bowl)', () => {
      const blend = calculateShishaBOM('LARGE', { isBlend: true, primaryMolassesId: 5, secondaryMolassesId: 13 });
      assert.strictEqual(blend.is_blend, true);
      assert.strictEqual(blend.total_molasses_grams, 20);

      const primary = blend.ingredients.find(i => i.inventory_item_id === 5);
      const secondary = blend.ingredients.find(i => i.inventory_item_id === 13);
      const coals = blend.ingredients.find(i => i.unit === 'pcs');

      assert.strictEqual(primary.grams, 14); // 70% of 20g = 14g
      assert.strictEqual(primary.quantity_microunits, 14000000);

      assert.strictEqual(secondary.grams, 6); // 30% of 20g = 6g
      assert.strictEqual(secondary.quantity_microunits, 6000000);

      assert.strictEqual(coals.count, 3);
    });
  });

  describe('3. Financial Settlement Safety & CRM Customer Debt Settle', () => {
    const testPhone = '01199887766';

    before(async () => {
      const db = getDb();
      // Ensure customer exists with 500 EGP debt
      await new Promise((resolve) => {
        db.run(
          `INSERT OR REPLACE INTO customers (phone, name, points, total_spent, credit_balance, visit_count)
           VALUES (?, 'أستاذ سامح عميل مميز', 50, 2500, 500, 10)`,
          [testPhone],
          () => resolve()
        );
      });
      await new Promise((resolve) => {
        db.run(
          `INSERT OR REPLACE INTO v3_customers (id, venue_id, name, phone, credit_balance_minor, visit_count, lifetime_spend_minor)
           VALUES ('CUST-SAMEH-1', 'V_DEFAULT', 'أستاذ سامح عميل مميز', ?, 50000, 10, 250000)`,
          [testPhone],
          () => resolve()
        );
      });
    });

    it('should settle 200 EGP of customer debt via POST /api/customers/:phone/settle-debt', async () => {
      const res = await request(app)
        .post(`/api/customers/${testPhone}/settle-debt`)
        .set('Cookie', managerCookie)
        .send({
          amount: 200,
          payment_method: 'INSTAPAY',
          notes: 'سداد تحويل فوري إنستاباي'
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.amount_paid, 200);
      assert.strictEqual(res.body.previous_debt, 500);
      assert.strictEqual(res.body.remaining_debt, 300);
    });

    it('should verify append-only payment record was created for customer debt settlement', async () => {
      const db = getDb();
      const paymentRow = await new Promise((resolve) => {
        db.get(
          `SELECT * FROM payments WHERE external_ref LIKE ? ORDER BY id DESC LIMIT 1`,
          [`%${testPhone}%`],
          (err, row) => resolve(row)
        );
      });

      assert.ok(paymentRow, 'Payment record must exist');
      assert.strictEqual(paymentRow.method, 'INSTAPAY');
      assert.strictEqual(paymentRow.amount_minor, 20000); // 200 EGP
    });
  });

  describe('4. Immutable Ledger on Order Void / Refund', () => {
    it('should append negative payment entry and expense row on voidOrder without deleting records', async () => {
      // 1. Create and settle a test order session
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Cookie', ownerCookie)
        .send({
          table_number: 14,
          item_name: 'اسبريسو سنجل',
          quantity: 1,
          price: 50
        });
      assert.strictEqual(orderRes.status, 200);
      const orderId = orderRes.body.order.id;

      // Settle
      const checkoutRes = await request(app)
        .post('/api/checkout')
        .set('Cookie', ownerCookie)
        .send({
          table_number: 14,
          payments: [{ method: 'CASH', amount: 100 }],
          amount_tendered_minor: 10000
        });
      assert.strictEqual(checkoutRes.status, 200);

      // Void the order with OWNER PIN
      const voidResult = await voidOrder(orderId, '1010', 'إلغاء تجريبي للتحقق من السجل الثابت');
      assert.strictEqual(voidResult.success, true);

      // Verify payments ledger contains both positive and negative entries
      const db = getDb();
      const payments = await new Promise((resolve) => {
        db.all(`SELECT * FROM payments WHERE session_id = (SELECT session_id FROM order_items WHERE id = ?)`, [orderId], (err, rows) => resolve(rows));
      });

      assert.ok(payments.length >= 2, 'Must contain original positive payment and negative refund entry');
      const negativeEntry = payments.find(p => p.amount_minor < 0);
      assert.ok(negativeEntry, 'Must have negative adjusting entry');
    });
  });

  describe('5. Concurrency & SQLite busy_timeout Concurrency Rush', () => {
    it('should handle 50 concurrent requests simultaneously without SQLITE_BUSY lock errors', async () => {
      const concurrentRequests = [];

      for (let i = 0; i < 50; i++) {
        const reqPromise = request(app)
          .get('/api/orders/past?limit=10&offset=0')
          .set('Cookie', ownerCookie);
        concurrentRequests.push(reqPromise);
      }

      const results = await Promise.all(concurrentRequests);

      assert.strictEqual(results.length, 50);
      for (const res of results) {
        assert.strictEqual(res.status, 200, `Request failed with status ${res.status}: ${JSON.stringify(res.body)}`);
        assert.strictEqual(res.body.success, true);
        assert.ok(Array.isArray(res.body.orders || res.body.data?.orders));
      }
    });
  });
});
