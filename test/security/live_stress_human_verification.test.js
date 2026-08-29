/**
 * Live Stress & Human Verification Protocol Suite
 * Tests the 4 core live operational stress scenarios for Mazaj OS.
 */
const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { closeDb, runQuery, getQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');

describe('Live Human Verification & Stress Protocols', () => {
  let app;
  let krkrCookie;
  let amalCookie;
  let beboCookie;
  let fatmaCookie;

  before(async function () {
    this.timeout(60000);
    await runMigrations();
    app = createApp();

    // Ensure staff accounts are active
    const staff = [
      { id: '35', name: 'أحمد', role: 'R_WAITER', legacyRole: 'WAITER', pin: '1001' },
      { id: '36', name: 'هاجر بيبو', role: 'R_BARISTA', legacyRole: 'BARISTA', pin: '1002' },
      { id: '38', name: 'الشيف', role: 'R_CHEF', legacyRole: 'CHEF', pin: '1004' },
      { id: '39', name: 'أمل', role: 'R_WAITER', legacyRole: 'WAITER', pin: '1005' },
      { id: '41', name: 'أحمد كركر', role: 'R_OP_ASSISTANT_CASHIER', legacyRole: 'OP_ASSISTANT_CASHIER', pin: '1007' },
      { id: '43', name: 'فاطمة', role: 'R_OWNER', legacyRole: 'OWNER', pin: '1009' }
    ];

    const dummyHash = await hashPin('999999');
    await runQuery(`UPDATE v3_users SET is_active = 0, pin_hash = ? WHERE id IN ('1','2','3','4','5','6','7','8','9','10','11','12','201','202','203','204','301','302')`, [dummyHash]);
    await runQuery(`UPDATE users SET is_active = 0, pin_hash = ? WHERE id IN (1,2,3,4,5,6,7,8,9,10,11,12,201,202,203,204,301,302)`, [dummyHash]);

    for (const s of staff) {
      const hash = await hashPin(s.pin);
      await runQuery(`INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active) VALUES (?, ?, ?, ?, 1)`, [parseInt(s.id, 10), s.name, s.legacyRole, hash]);
      await runQuery(`INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)`, [s.id, s.name, s.role, hash]);
    }

    // Login Ahmed Krkr (1007 - Cashier)
    const krkrRes = await request(app).post('/api/auth/login').send({ pin: '1007' });
    krkrCookie = krkrRes.headers['set-cookie'];

    // Login Amal (1005 - Waiter)
    const amalRes = await request(app).post('/api/auth/login').send({ pin: '1005' });
    amalCookie = amalRes.headers['set-cookie'];

    // Login Hager Bebo (1002 - Barista)
    const beboRes = await request(app).post('/api/auth/login').send({ pin: '1002' });
    beboCookie = beboRes.headers['set-cookie'];

    // Login Fatma (1009 - Owner)
    const fatmaRes = await request(app).post('/api/auth/login').send({ pin: '1009' });
    fatmaCookie = fatmaRes.headers['set-cookie'];
  });

  after(async () => {
    await closeDb();
  });

  describe('Protocol 1: Financial Blindness & Auto-Lock Test', () => {
    it('should verify 15-second inactivity auto-lock is enforced in client code', () => {
      const authJs = fs.readFileSync(path.join(__dirname, '../../public/modules/auth.js'), 'utf8');
      assert.ok(authJs.includes('15000'), 'auth.js must specify 15000ms idle limit');
    });

    it('should reject Ahmed Krkr (Cashier) with 403 when attempting to access EOD or BI reports', async () => {
      // EOD report API
      const eodRes = await request(app)
        .get('/api/reports/eod')
        .set('Cookie', krkrCookie);
      assert.strictEqual(eodRes.status, 403, 'Cashier must be blocked from EOD report');

      // BI report API
      const biRes = await request(app)
        .get('/api/reports/bi')
        .set('Cookie', krkrCookie);
      assert.strictEqual(biRes.status, 403, 'Cashier must be blocked from BI executive sales');
    });
  });

  describe('Protocol 2: Waiter vs. Barista Dispute Handshake', () => {
    it('should create order, move to accepted, request cancel, reject dispute and keep order alive', async () => {
      // Step A: Amal (Waiter) places order for Table 2
      const createRes = await request(app)
        .post('/api/orders')
        .set('Cookie', amalCookie)
        .send({
          table_number: 2,
          item_name: 'اسبريسو سنجل',
          quantity: 1,
          sugar_level: 'مظبوط',
          roast_type: 'غامق'
        });
      assert.strictEqual(createRes.status, 200);
      const itemId = createRes.body.order.id;

      // Step B: Hager Bebo (Barista) moves order to ACCEPTED (جاري التجهيز)
      const acceptRes = await request(app)
        .put(`/api/orders/${itemId}/status`)
        .set('Cookie', beboCookie)
        .send({ status: 'ACCEPTED' });
      assert.strictEqual(acceptRes.status, 200);
      assert.strictEqual(acceptRes.body.data.kds_status, 'ACCEPTED');

      // Step C: Amal (Waiter) attempts to cancel order
      const cancelReqRes = await request(app)
        .post('/api/orders/request-cancel')
        .set('Cookie', amalCookie)
        .send({ order_id: itemId, reason: 'العميل تراجع عن الطلب' });
      assert.strictEqual(cancelReqRes.status, 200);
      assert.strictEqual(cancelReqRes.body.data.edit_request, 'CANCEL_REQUESTED');

      // Step D: Hager Bebo (Barista) rejects the cancellation request on KDS
      const resolveRes = await request(app)
        .post('/api/orders/cancel-resolve')
        .set('Cookie', beboCookie)
        .send({ order_id: itemId, approve: false, notes: 'المشروب قيد التحضير بالفعل' });
      assert.strictEqual(resolveRes.status, 200);
      assert.strictEqual(resolveRes.body.success, true);

      // Verify in database that order item remains ACCEPTED and active
      const itemRow = await getQuery(`SELECT kds_status, edit_request FROM order_items WHERE id = ?`, [itemId]);
      assert.strictEqual(itemRow.kds_status, 'ACCEPTED');
      assert.strictEqual(itemRow.edit_request, null);
    });
  });

  describe('Protocol 3: Panic Double-Tap Checkout Idempotency Test', () => {
    it('should process payment exactly once and reject subsequent rapid taps with 409 Conflict', async () => {
      // Step A: Ring up Table 5 order for 100 EGP
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Cookie', fatmaCookie)
        .send({
          table_number: 5,
          item_name: 'شيشة فاخر',
          quantity: 1
        });
      assert.strictEqual(orderRes.status, 200);
      const sessionId = orderRes.body.order.session_id;

      // Step B: Rapid fire 5 concurrent checkout requests for the same session
      const payload = {
        session_id: sessionId,
        payments: [{ method: 'CASH', amount: 500 }],
        amount_tendered_minor: 50000
      };

      const promises = [
        request(app).post('/api/checkout').set('Cookie', fatmaCookie).send(payload),
        request(app).post('/api/checkout').set('Cookie', fatmaCookie).send(payload),
        request(app).post('/api/checkout').set('Cookie', fatmaCookie).send(payload),
        request(app).post('/api/checkout').set('Cookie', fatmaCookie).send(payload),
        request(app).post('/api/checkout').set('Cookie', fatmaCookie).send(payload)
      ];

      const results = await Promise.all(promises);
      if (results.some(r => r.status !== 200 && r.status !== 409)) {
        console.error('DEBUG CHECKOUT RESULTS:', results.map(r => ({ status: r.status, body: r.body })));
      }
      const successCount = results.filter(r => r.status === 200).length;
      const conflictCount = results.filter(r => r.status === 409).length;

      assert.strictEqual(successCount, 1, 'Exactly 1 checkout attempt must succeed');
      assert.strictEqual(conflictCount, 4, '4 rapid duplicate attempts must be rejected with 409 Conflict');

      // Verify payment was recorded once in payments table
      const paymentRows = await getQuery(`SELECT COUNT(*) as cnt FROM payments WHERE session_id = ?`, [sessionId]);
      assert.strictEqual(paymentRows.cnt, 1, 'Payments table must have exactly 1 record for this session');
    });
  });

  describe('Protocol 4: Hardware & PWA Sanity Check', () => {
    it('should verify PWA manifest contains required standalone configuration', () => {
      const manifestPath = path.join(__dirname, '../../public/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(manifest.display, 'standalone');
      assert.strictEqual(manifest.name, 'كافيه مزاج - Mazaj OS');
      assert.ok(manifest.theme_color, 'Theme color must be specified');
    });

    it('should verify Caffeine mode can be toggled without error', async () => {
      const enableRes = await request(app)
        .post('/api/auth/caffeine')
        .set('Cookie', fatmaCookie)
        .send({ duration_minutes: 60 });
      assert.strictEqual(enableRes.status, 200);
      assert.strictEqual(enableRes.body.enabled, true);
    });

    it('should format ESC/POS receipt and kitchen ticket without server error', async () => {
      const kitchenTicketRes = await request(app)
        .post('/api/print/kitchen')
        .set('Cookie', fatmaCookie)
        .send({
          table_number: 1,
          waiter_name: 'أمل',
          items: [{ name: 'اسبريسو سنجل', quantity: 1, modifiers: { sugar: 'مظبوط' } }]
        });
      assert.strictEqual(kitchenTicketRes.status, 200);
      assert.ok(kitchenTicketRes.body.buffer_length > 0);

      const receiptRes = await request(app)
        .post('/api/print/receipt')
        .set('Cookie', fatmaCookie)
        .send({
          order_id: 'ORD-TEST-99',
          items: [{ name: 'شيشة فاخر', price: 100, quantity: 1 }],
          payment_method: 'CASH',
          kick_drawer: true
        });
      assert.strictEqual(receiptRes.status, 200);
      assert.strictEqual(receiptRes.body.drawer_kicked, true);
    });
  });
});
