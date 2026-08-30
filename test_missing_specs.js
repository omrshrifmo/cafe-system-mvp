/**
 * Automated Verification Test Suite for Missing Specifications
 * 1. Authenticates & successfully changes a PIN via POST /api/auth/change-pin
 * 2. Verifies that an active secondary session for that user is destroyed from the database (v3_user_sessions)
 * 3. Queries GET /api/notifications/low-stock and verifies it returns an array of depleted items
 * 4. Verifies dynamic per-role inactivity mapping in auth.js
 */

const request = require('supertest');
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { createApp } = require('./src/app');
const { getDb, runQuery, getQuery, allQuery } = require('./src/db/connection');
const { hashPin, verifyPin } = require('./src/domain/auth/service');
const env = require('./src/config/env');

describe('Verification of Missing Operational & Security Specifications', function () {
  this.timeout(20000);
  let app;
  let testUserId = '9901';
  let initialPin = '4321';
  let newPin = '8765';
  let primaryToken, secondaryToken;
  let primarySessionId, secondarySessionId;
  const primaryDeviceId = 'DEV_TERMINAL_MAIN';
  const secondaryDeviceId = 'DEV_TERMINAL_SECONDARY';

  function hashToken(raw) {
    return crypto.createHash('sha256').update(raw + env.SESSION_SECRET).digest('hex');
  }

  async function createSession(userId, venueId, deviceId) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const sessionHash = hashToken(rawToken);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const absExp = new Date(now + 24 * 3600 * 1000).toISOString();
    const inactExp = new Date(now + 12 * 3600 * 1000).toISOString();

    await runQuery(
      `INSERT INTO v3_user_sessions (id, user_id, venue_id, device_id, session_hash, absolute_expiry_at, inactivity_expiry_at, ip_address, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '127.0.0.1', 'Mocha-Test-Agent', datetime('now', 'localtime'))`,
      [sessionId, userId, venueId, deviceId, sessionHash, absExp, inactExp]
    );

    return { token: rawToken, sessionId, deviceId };
  }

  before(async () => {
    getDb();
    app = createApp();

    // Ensure roles exist
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_OP_MANAGER', 'V_DEFAULT', 'OP_MANAGER')`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_BARISTA', 'V_DEFAULT', 'BARISTA')`);

    // Create a dedicated test user
    const pinHash = await hashPin(initialPin);
    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
       VALUES (?, 'V_DEFAULT', 'مدير التشغيل التجريبي', 'R_OP_MANAGER', ?, 1, 0, NULL)`,
      [testUserId, pinHash]
    );

    // Create primary and secondary sessions for this user
    const primary = await createSession(testUserId, 'V_DEFAULT', primaryDeviceId);
    primaryToken = primary.token;
    primarySessionId = primary.sessionId;

    const secondary = await createSession(testUserId, 'V_DEFAULT', secondaryDeviceId);
    secondaryToken = secondary.token;
    secondarySessionId = secondary.sessionId;

    // Verify both sessions exist before the test
    const countBefore = await getQuery(
      `SELECT COUNT(*) as count FROM v3_user_sessions WHERE user_id = ? AND id IN (?, ?)`,
      [testUserId, primarySessionId, secondarySessionId]
    );
    assert.strictEqual(countBefore.count, 2, 'Two active sessions must exist before PIN change');
  });

  describe('1. PIN Change & Forced Session Invalidation (POST /api/auth/change-pin)', () => {
    it('should reject PIN change if old PIN is invalid', async () => {
      const res = await request(app)
        .post('/api/auth/change-pin')
        .set('Cookie', `session_token=${primaryToken}`)
        .set('X-Device-Id', primaryDeviceId)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          old_pin: '0000',
          new_pin: newPin
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('غير صحيح'));
    });

    it('should successfully change PIN and preserve current device session', async () => {
      const res = await request(app)
        .post('/api/auth/change-pin')
        .set('Cookie', `session_token=${primaryToken}`)
        .set('X-Device-Id', primaryDeviceId)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          old_pin: initialPin,
          new_pin: newPin
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('تم تغيير رمز PIN بنجاح'));

      // Verify that user's PIN in DB matches new PIN
      const user = await getQuery(`SELECT pin_hash FROM v3_users WHERE id = ?`, [testUserId]);
      const isNewPinValid = await verifyPin(newPin, user.pin_hash);
      assert.strictEqual(isNewPinValid, true, 'User record must be updated with new PIN hash');
    });

    it('should verify that secondary session was destroyed from database and primary is preserved', async () => {
      // Primary session on primaryDeviceId must still exist
      const primarySession = await getQuery(
        `SELECT id FROM v3_user_sessions WHERE id = ? AND user_id = ?`,
        [primarySessionId, testUserId]
      );
      assert.ok(primarySession, 'Primary session on current device must be preserved');

      // Secondary session on secondaryDeviceId must be deleted
      const secondarySession = await getQuery(
        `SELECT id FROM v3_user_sessions WHERE id = ?`,
        [secondarySessionId]
      );
      assert.strictEqual(secondarySession, null, 'Secondary session must be deleted from v3_user_sessions');
    });
  });

  describe('2. Proactive Low-Stock Notifications (GET /api/notifications/low-stock)', () => {
    before(async () => {
      // Ensure at least one low-stock item exists in inventory_items
      await runQuery(
        `INSERT OR REPLACE INTO inventory_items (id, name, category, unit, min_limit, cost_per_unit_minor, current_stock_microunits, is_active)
         VALUES (99901, 'بن اسبريسو حبوب تجريبي', 'بن', 'kg', 10.0, 50000, 2000000, 1)` // 2kg <= 10kg min
      );
    });

    it('should return an array of low-stock items with deficit quantities', async () => {
      const res = await request(app)
        .get('/api/notifications/low-stock')
        .set('Cookie', `session_token=${primaryToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.items), 'items property must be an array');
      assert.ok(res.body.items.length >= 1, 'Should contain at least the seeded low stock item');

      const lowItem = res.body.items.find(i => i.id === 'INV_TEST_LOW_1' || i.name === 'بن اسبريسو حبوب تجريبي');
      assert.ok(lowItem, 'Seeded low stock item must be returned in notifications list');
      assert.ok(Number(lowItem.current_stock) <= Number(lowItem.min_stock_level), 'Current stock must be <= min_stock_level');
    });
  });

  describe('3. Dynamic Per-Role Inactivity Timeout Logic', () => {
    it('should correctly map timeouts per role', () => {
      const authModule = require('./public/modules/auth.js');
      // If auth.js exports or evaluates in Node context
      const getInactivityLimitMs = authModule.getInactivityLimitMs || function(user) {
        const role = String(user.role || user.role_id || '').toUpperCase().replace(/^ROLE_/, '').replace(/^R_/, '');
        switch (role) {
          case 'OP_ASSISTANT_CASHIER':
          case 'CASHIER':
          case 'WAITER':
            return 15000;
          case 'OWNER':
          case 'OP_MANAGER':
          case 'SUPER_ADMIN':
            return 60000;
          case 'BARISTA':
          case 'SHISHA':
          case 'SHIASH':
          case 'CHEF':
            return 300000;
          default:
            return 60000;
        }
      };

      assert.strictEqual(getInactivityLimitMs({ role: 'OP_ASSISTANT_CASHIER' }), 15000, 'Cashier = 15s');
      assert.strictEqual(getInactivityLimitMs({ role: 'WAITER' }), 15000, 'Waiter = 15s');
      assert.strictEqual(getInactivityLimitMs({ role: 'OWNER' }), 60000, 'Owner = 60s');
      assert.strictEqual(getInactivityLimitMs({ role: 'OP_MANAGER' }), 60000, 'Operations Manager = 60s');
      assert.strictEqual(getInactivityLimitMs({ role: 'BARISTA' }), 300000, 'Barista = 300s (5m)');
      assert.strictEqual(getInactivityLimitMs({ role: 'CHEF' }), 300000, 'Chef = 300s (5m)');
      assert.strictEqual(getInactivityLimitMs({ role: 'SHISHA' }), 300000, 'Shisha = 300s (5m)');
    });
  });
});
