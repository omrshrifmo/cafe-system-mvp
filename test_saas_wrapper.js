/**
 * Automated Verification Test Suite for SaaS Productization Wrapper
 * 1. Database empty state detection (v3_users / onboarding_state)
 * 2. POST /api/system/initialize payload execution, bcrypt verification, and config saving
 * 3. CSV Export endpoints (sales & inventory) with standard UTF-8 BOM (\uFEFF) assertions
 * 4. Menu CSV bulk import with multipart upload and catalog persistence
 */

const request = require('supertest');
const assert = require('assert');
const crypto = require('crypto');
const { createApp } = require('./src/app');
const { getDb, runQuery, getQuery, allQuery } = require('./src/db/connection');
const { verifyPin } = require('./src/domain/auth/service');
const env = require('./src/config/env');

describe('SaaS Productization & Zero-Touch Self-Serve Engine', function () {
  this.timeout(20000);
  let app;
  let adminToken;
  const adminPin = '9876';
  const adminName = 'المدير التنفيذي التجريبي';

  function hashToken(raw) {
    return crypto.createHash('sha256').update(raw + env.SESSION_SECRET).digest('hex');
  }

  async function createSession(userId, venueId, deviceId = 'DEV_TEST_SAAS') {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const sessionHash = hashToken(rawToken);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const absExp = new Date(now + 24 * 3600 * 1000).toISOString();
    const inactExp = new Date(now + 12 * 3600 * 1000).toISOString();

    await runQuery(
      `INSERT INTO v3_user_sessions (id, user_id, venue_id, device_id, session_hash, absolute_expiry_at, inactivity_expiry_at, ip_address, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '127.0.0.1', 'Mocha-SaaS-Agent', datetime('now', 'localtime'))`,
      [sessionId, userId, venueId, deviceId, sessionHash, absExp, inactExp]
    );

    return { token: rawToken, sessionId, deviceId };
  }

  before(async () => {
    getDb();
    app = createApp();
  });

  describe('1. Empty State Detection & First-Boot Initialization (POST /api/system/initialize)', () => {
    it('should correctly query users and config state', async () => {
      const usersCount = await getQuery(`SELECT COUNT(*) as count FROM v3_users`);
      assert.ok(typeof usersCount.count === 'number', 'Should return numeric user count');
      
      const configState = await getQuery(`SELECT value FROM system_config WHERE key = 'onboarding_state'`);
      // It can be null or a string
      assert.ok(configState === null || typeof configState.value === 'string');
    });

    it('should reject initialization if PIN is shorter than 4 digits', async () => {
      const res = await request(app)
        .post('/api/system/initialize')
        .send({
          admin_name: adminName,
          admin_pin: '12',
          cafe_name: 'كافيه تجريبي',
          currency: 'ج.م'
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('4 أرقام'));
    });

    it('should successfully initialize system, hash PIN with bcrypt, and save config', async () => {
      const res = await request(app)
        .post('/api/system/initialize')
        .send({
          admin_name: adminName,
          admin_pin: adminPin,
          cafe_name: 'كافيه مزاج الفاخر',
          currency: 'ج.م',
          vat_percent: 14,
          service_percent: 12,
          load_demo_data: true
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.admin_id, '101');

      // Verify SUPER_ADMIN in v3_users
      const adminUser = await getQuery(`SELECT * FROM v3_users WHERE id = '101'`);
      assert.ok(adminUser, 'SUPER_ADMIN user 101 must exist');
      assert.strictEqual(adminUser.name, adminName);
      
      // Verify bcrypt hash verification
      const isPinValid = await verifyPin(adminPin, adminUser.pin_hash);
      assert.strictEqual(isPinValid, true, 'User pin_hash must verify against original PIN');

      // Verify system_config values
      const cafeNameCfg = await getQuery(`SELECT value FROM system_config WHERE key = 'cafe_name'`);
      assert.strictEqual(cafeNameCfg.value, 'كافيه مزاج الفاخر');

      const onboardingCfg = await getQuery(`SELECT value FROM system_config WHERE key = 'onboarding_state'`);
      assert.strictEqual(onboardingCfg.value, 'COMPLETE');

      // Create authenticated session for subsequent authenticated tests
      const session = await createSession('101', 'V_DEFAULT');
      adminToken = session.token;
    });
  });

  describe('2. SaaS Data Export Hub (UTF-8 BOM CSV Exports)', () => {
    it('should export Sales CSV with standard UTF-8 BOM (\\uFEFF) and text/csv content type', async () => {
      const res = await request(app)
        .get('/api/export/sales')
        .set('Cookie', `session_token=${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'), 'Content-Type must be text/csv');
      assert.ok(res.headers['content-disposition'].includes('attachment'), 'Content-Disposition must be attachment');
      
      const text = res.text;
      assert.ok(text.startsWith('\uFEFF'), 'CSV output must start with UTF-8 Byte Order Mark (\\uFEFF)');
      assert.ok(text.includes('رقم الفاتورة'), 'Header must contain Arabic column names');
      assert.ok(text.includes('المجموع الفرعي'), 'Header must contain Arabic financial columns');
    });

    it('should export Inventory CSV with standard UTF-8 BOM (\\uFEFF) and text/csv content type', async () => {
      const res = await request(app)
        .get('/api/export/inventory')
        .set('Cookie', `session_token=${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'), 'Content-Type must be text/csv');
      assert.ok(res.headers['content-disposition'].includes('attachment'), 'Content-Disposition must be attachment');
      
      const text = res.text;
      assert.ok(text.startsWith('\uFEFF'), 'CSV output must start with UTF-8 Byte Order Mark (\\uFEFF)');
      assert.ok(text.includes('كود المادة'), 'Header must contain Arabic item ID column');
      assert.ok(text.includes('اسم الصنف / الخامة'), 'Header must contain Arabic item name column');
    });
  });

  describe('3. SaaS Menu Bulk Import Hub (POST /api/import/menu)', () => {
    it('should import menu items from CSV buffer and persist in database', async () => {
      const csvData = [
        'name,category,price,description,department',
        'موكا شوكولاتة مثلجة,مشروبات باردة,68.50,موكا مع صوص شوكولاتة بلجيكي وكريمة,BARISTA',
        'تشيز كيك فراولة,حلويات ومخبوزات,85.00,تشيز كيك نيويورك مع صوص فراولة طازج,KITCHEN',
        'شيشة فواكه استوائية,شيشة ومعسلات,95.00,خلطة فواكه استوائية منعشة,SHISHA'
      ].join('\r\n');

      const res = await request(app)
        .post('/api/import/menu')
        .set('Cookie', `session_token=${adminToken}`)
        .attach('file', Buffer.from(csvData, 'utf8'), 'menu_sample.csv');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.count, 3, 'Must import 3 items');

      // Verify that items exist in menu_items
      const item1 = await getQuery(`SELECT * FROM menu_items WHERE name = 'موكا شوكولاتة مثلجة'`);
      assert.ok(item1, 'Imported item 1 must exist in menu_items');

      const price1 = await getQuery(`SELECT * FROM menu_prices WHERE menu_item_id = ?`, [item1.id]);
      assert.ok(price1, 'Price must be inserted in menu_prices');
      assert.strictEqual(price1.amount_minor, 6850, 'Price 68.50 must convert to 6850 minor units');

      const item2 = await getQuery(`SELECT * FROM menu_items WHERE name = 'تشيز كيك فراولة'`);
      assert.ok(item2, 'Imported item 2 must exist');
    });
  });
});
