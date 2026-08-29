/**
 * Mazaj OS Production Deployment & Hardening Test Suite
 * Verifies the 6 Hardening Pillars:
 * 1. 15-Second Auto-Lock & Caffeine Mode (Auth & State Persistence)
 * 2. KDS 4-Lane State Machine & Order Cancellation Handshake
 * 3. ESC/POS Hardware Print Bridge & RJ11 Cash Drawer Kick Pulse
 * 4. Dynamic Taxes, Currency & Settings Configuration
 * 5. Progressive Web App (PWA) Manifest & Service Worker Shell
 * 6. Mazaj Staff Hierarchy Seeding (1001-1012)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { closeDb, getQuery, runQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');

describe('Mazaj OS Production Deployment & Hardening Suite', () => {
  let app;
  let ownerCookie;
  let waiterCookie;
  let baristaCookie;

  before(async function () {
    this.timeout(60000);
    await runMigrations();
    app = createApp();

    // Synchronize Official Mazaj Staff (1001-1012)
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
      const hash = await hashPin(s.pin);
      await runQuery(`INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active) VALUES (?, ?, ?, ?, 1)`, [parseInt(s.id, 10), s.name, s.legacyRole, hash]);
      await runQuery(`INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)`, [s.id, s.name, s.role, hash]);
    }

    // Login as Owner (1009)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });
    assert.strictEqual(ownerRes.status, 200);
    assert.strictEqual(ownerRes.body.success, true);
    ownerCookie = ownerRes.headers['set-cookie'];

    // Login as Waiter (1001)
    const waiterRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1001' });
    assert.strictEqual(waiterRes.status, 200);
    assert.strictEqual(waiterRes.body.success, true);
    waiterCookie = waiterRes.headers['set-cookie'];

    // Login as Barista (1002)
    const baristaRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1002' });
    assert.strictEqual(baristaRes.status, 200);
    assert.strictEqual(baristaRes.body.success, true);
    baristaCookie = baristaRes.headers['set-cookie'];
  });

  after(async () => {
    await closeDb();
  });

  describe('1. 15-Second Auto-Lock & Caffeine Mode', () => {
    it('should verify INACTIVITY_LIMIT_MS is set to 15000 in auth.js', () => {
      const authJs = fs.readFileSync(path.join(__dirname, '../../public/modules/auth.js'), 'utf8');
      assert.ok(authJs.includes('15000'), 'INACTIVITY_LIMIT_MS must be 15000 ms (15s)');
    });

    it('should enable and disable Caffeine Mode via API', async () => {
      const enableRes = await request(app)
        .post('/api/auth/caffeine')
        .set('Cookie', ownerCookie)
        .send({ duration_minutes: 45, reason: 'PEAK_HOURS' });
      assert.strictEqual(enableRes.status, 200);
      assert.strictEqual(enableRes.body.success, true);
      assert.strictEqual(enableRes.body.enabled, true);

      const statusRes = await request(app)
        .get('/api/auth/caffeine')
        .set('Cookie', ownerCookie);
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.body.enabled, true);

      const disableRes = await request(app)
        .delete('/api/auth/caffeine')
        .set('Cookie', ownerCookie)
        .set('x-requested-with', 'XMLHttpRequest')
        .send({});
      assert.strictEqual(disableRes.status, 200);
      assert.strictEqual(disableRes.body.enabled, false);
    });
  });

  describe('2. KDS 4-Lane State Machine & Dispute Handshake', () => {
    it('should verify kds.html, kitchen.html, and shisha.html have 4 vertical lanes', () => {
      const kdsHtml = fs.readFileSync(path.join(__dirname, '../../public/kds.html'), 'utf8');
      const kitchenHtml = fs.readFileSync(path.join(__dirname, '../../public/kitchen.html'), 'utf8');
      const shishaHtml = fs.readFileSync(path.join(__dirname, '../../public/shisha.html'), 'utf8');

      [kdsHtml, kitchenHtml, shishaHtml].forEach(html => {
        assert.ok(html.includes('lane-pending'), 'Missing lane-pending');
        assert.ok(html.includes('lane-accepted'), 'Missing lane-accepted');
        assert.ok(html.includes('lane-ready'), 'Missing lane-ready');
        assert.ok(html.includes('lane-delivered'), 'Missing lane-delivered');
      });
    });

    it('should execute cancellation request and dispute resolution handshake', async () => {
      // 1. Create table & session
      const table = await getQuery(`SELECT id, table_number FROM tables WHERE table_number = 1`);
      assert.ok(table, 'Table 1 must exist');

      // Create an order item directly
      const sessionRes = await request(app)
        .post('/api/orders')
        .set('Cookie', waiterCookie)
        .send({
          table_number: 1,
          items: [{ item_name: 'لاتيه كافيه', price: 45, quantity: 1, department: 'BARISTA' }]
        });
      assert.strictEqual(sessionRes.status, 200);
      
      const orders = await request(app)
        .get('/api/orders?table_number=1')
        .set('Cookie', waiterCookie);
      assert.strictEqual(orders.status, 200);
      const targetOrder = orders.body.orders[0];
      assert.ok(targetOrder, 'Order must exist');

      // Accept order in KDS (ACCEPTED)
      const acceptRes = await request(app)
        .put(`/api/orders/${targetOrder.id}/status`)
        .set('Cookie', baristaCookie)
        .send({ status: 'ACCEPTED' });
      assert.strictEqual(acceptRes.status, 200);

      // Waiter requests cancel
      const cancelReqRes = await request(app)
        .post(`/api/orders/${targetOrder.id}/cancel-request`)
        .set('Cookie', waiterCookie)
        .send({ reason: 'العميل غير رأيه' });
      assert.strictEqual(cancelReqRes.status, 200);
      assert.strictEqual(cancelReqRes.body.success, true);

      // Barista approves cancel handshake
      const resolveRes = await request(app)
        .post(`/api/orders/${targetOrder.id}/cancel-resolve`)
        .set('Cookie', baristaCookie)
        .send({ approved: true });
      assert.strictEqual(resolveRes.status, 200);
      assert.strictEqual(resolveRes.body.success, true);
    });
  });

  describe('3. Hardware Print Bridge & Cash Drawer Kick', () => {
    it('should generate ESC/POS kitchen ticket via POST /api/print/kitchen', async () => {
      const printRes = await request(app)
        .post('/api/print/kitchen')
        .set('Cookie', waiterCookie)
        .send({
          table_number: 2,
          waiter_name: 'أحمد',
          items: [{ name: 'قهوة تركي مظبوط', quantity: 2, sugar_level: 'مظبوط', roast_type: 'فاتح' }]
        });
      assert.strictEqual(printRes.status, 200);
      assert.strictEqual(printRes.body.success, true);
      assert.ok(printRes.body.buffer_length > 0, 'Must generate ESC/POS buffer');
    });

    it('should generate ESC/POS receipt and trigger RJ11 drawer kick via POST /api/print/receipt', async () => {
      const receiptRes = await request(app)
        .post('/api/print/receipt')
        .set('Cookie', ownerCookie)
        .send({
          order_id: '10042',
          table_number: 3,
          cashier_name: 'أحمد كركر',
          items: [{ name: 'ميكس جريل', price: 150, quantity: 1 }],
          subtotal: 150,
          service_amount: 18,
          vat_amount: 21,
          total_amount: 189,
          kick_drawer: true
        });
      assert.strictEqual(receiptRes.status, 200);
      assert.strictEqual(receiptRes.body.success, true);
      assert.strictEqual(receiptRes.body.drawer_kicked, true);
      assert.ok(receiptRes.body.buffer_length > 0, 'Must generate ESC/POS receipt buffer');
    });
  });

  describe('4. Settings Panel & Dynamic Tax Calculation', () => {
    it('should allow OWNER to read and update tax and system configuration', async () => {
      const configRes = await request(app)
        .get('/api/config')
        .set('Cookie', ownerCookie);
      assert.strictEqual(configRes.status, 200);
      assert.strictEqual(configRes.body.success, true);
      assert.strictEqual(configRes.body.config.vat_percent, 14);
      assert.strictEqual(configRes.body.config.service_percent, 12);
      assert.strictEqual(configRes.body.config.currency, 'ج.م');

      // Update config
      const updateRes = await request(app)
        .post('/api/config')
        .set('Cookie', ownerCookie)
        .send({
          vat_percent: '14',
          service_percent: '12',
          currency: 'ج.م',
          printer_ip: '192.168.1.100'
        });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.success, true);
    });

    it('should reject unauthorized users from modifying system config', async () => {
      const unauthRes = await request(app)
        .post('/api/config')
        .set('Cookie', waiterCookie)
        .send({ vat_percent: '20' });
      assert.strictEqual(unauthRes.status, 403);
    });
  });

  describe('5. Progressive Web App (PWA) Manifest & Service Worker', () => {
    it('should verify manifest.json is valid JSON with standalone display', () => {
      const manifestPath = path.join(__dirname, '../../public/manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(manifest.display, 'standalone');
      assert.strictEqual(manifest.theme_color, '#f59e0b');
    });

    it('should verify sw.js caches static assets and skips API routes', () => {
      const swJs = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
      assert.ok(swJs.includes('/api/'), 'sw.js must bypass /api/ caching');
      assert.ok(swJs.includes('SKIP_WAITING'));
    });
  });

  describe('6. Mazaj Staff Hierarchy Seeding (1001-1012)', () => {
    it('should authenticate all 12 Mazaj staff with their designated PINs', async function () {
      this.timeout(120000);
      const staffList = [
        { pin: '1001', role: 'WAITER' },
        { pin: '1002', role: 'BARISTA' },
        { pin: '1003', role: 'SHISHA' },
        { pin: '1004', role: 'CHEF' },
        { pin: '1005', role: 'WAITER' },
        { pin: '1006', role: 'HALL_MANAGER' },
        { pin: '1007', role: 'OP_ASSISTANT_CASHIER' },
        { pin: '1008', role: 'OP_MANAGER' },
        { pin: '1009', role: 'OWNER' },
        { pin: '1010', role: 'OWNER' },
        { pin: '1011', role: 'SUPER_ADMIN' },
        { pin: '1012', role: 'BOM_MANAGER' }
      ];

      for (const staff of staffList) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ pin: staff.pin });
        assert.strictEqual(res.status, 200, `PIN ${staff.pin} failed to login`);
        assert.strictEqual(res.body.success, true);
        if (staff.pin === '1001') {
          assert.ok(['WAITER', 'JOKER'].includes(res.body.user.role), `PIN 1001 unexpected role ${res.body.user.role}`);
        } else {
          assert.strictEqual(res.body.user.role, staff.role, `PIN ${staff.pin} has unexpected role ${res.body.user.role}`);
        }
      }
    });
  });
});
