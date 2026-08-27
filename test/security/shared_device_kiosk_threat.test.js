/**
 * Shared-Device, Kiosk, Multi-Tab & Perimeter Threat Model Test Suite
 * Validates all security boundaries defined in docs/security/shared-device-threat-model.md
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const crypto = require('crypto');

// Set isolated test environment
process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, '../../fixtures/gate-shared-threat.sqlite');
process.env.DB_PATH = TEST_DB;

const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { hashPin } = require('../../src/domain/auth/service');

describe('Shared-Device, Kiosk & Remote Perimeter Security Suite', () => {
  let app;
  let userOwnerId, userCashierId, userWaiterId;
  let ownerPin = '1111', cashierPin = '2222', waiterPin = '3333';

  before(async () => {
    // Reset isolated test fixture
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await runMigrations();
    app = createApp();

    // Seed baseline venue & roles
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Threat Gate Venue')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OWNER', 'V_DEFAULT', 'OWNER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OP_MANAGER', 'V_DEFAULT', 'OP_MANAGER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`);

    // Seed test users with known PINs
    userOwnerId = 'U_OWNER_' + Date.now();
    userCashierId = 'U_CASHIER_' + Date.now();
    userWaiterId = 'U_WAITER_' + Date.now();

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Threat Owner', 'R_OWNER', ?, 1)`,
      [userOwnerId, await hashPin(ownerPin)]
    );

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Threat Cashier', 'R_CASHIER', ?, 1)`,
      [userCashierId, await hashPin(cashierPin)]
    );

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Threat Waiter', 'R_WAITER', ?, 1)`,
      [userWaiterId, await hashPin(waiterPin)]
    );
  });

  describe('1. Two Users Sharing One Physical Device (Sequential Login/Logout)', () => {
    let cashierSessionCookie = null;
    let waiterSessionCookie = null;

    it('should log in Cashier and issue secure HttpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'POS-COUNTER-01')
        .send({ pin: cashierPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.role, 'OP_ASSISTANT_CASHIER');
      
      const cookies = res.headers['set-cookie'];
      assert.ok(cookies && cookies.length > 0);
      cashierSessionCookie = cookies.find(c => c.startsWith('session_token='));
      assert.ok(cashierSessionCookie);
      assert.ok(cashierSessionCookie.includes('HttpOnly'));
    });

    it('should cleanly log out Cashier and invalidate session server-side', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cashierSessionCookie)
        .send({})
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify that the old cashier cookie is immediately rejected on subsequent requests
      const testRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cashierSessionCookie)
        .expect(401);

      assert.strictEqual(testRes.body.success, false);
      assert.strictEqual(testRes.body.code, 'AUTH_REQUIRED');
    });

    it('should log in Waiter on the same physical terminal with clean isolation', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'POS-COUNTER-01')
        .send({ pin: waiterPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.role, 'WAITER');
      
      const cookies = res.headers['set-cookie'];
      waiterSessionCookie = cookies.find(c => c.startsWith('session_token='));
      assert.notStrictEqual(waiterSessionCookie, cashierSessionCookie);

      // Waiter can access identity
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', waiterSessionCookie)
        .expect(200);

      assert.strictEqual(meRes.body.user.id, userWaiterId);
      assert.strictEqual(meRes.body.user.role, 'WAITER');
    });
  });

  describe('2. Two Tabs Sharing One Session & Explicit Token Overrides', () => {
    let sharedSessionCookie = null;
    let sharedToken = null;

    it('should authenticate and allow requests via Cookie or x-session-token header', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ pin: ownerPin })
        .expect(200);

      sharedToken = res.body.token;
      sharedSessionCookie = res.headers['set-cookie'].find(c => c.startsWith('session_token='));

      // Tab 1: Cookie based request
      const tab1Res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sharedSessionCookie)
        .expect(200);
      assert.strictEqual(tab1Res.body.user.role, 'OWNER');

      // Tab 2: Header based request
      const tab2Res = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', sharedToken)
        .expect(200);
      assert.strictEqual(tab2Res.body.user.role, 'OWNER');
    });

    it('should revoke session across both tabs when logout is executed in Tab 1', async () => {
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', sharedSessionCookie)
        .send({})
        .expect(200);

      // Tab 2 (header) is also immediately revoked
      await request(app)
        .get('/api/auth/me')
        .set('x-session-token', sharedToken)
        .expect(401);
    });
  });

  describe('3. Two Browser Profiles / Separate Devices Isolation', () => {
    let profileAToken = null;
    let profileBToken = null;

    it('should maintain independent session records for distinct devices', async () => {
      const resA = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'TABLET-FLOOR-01')
        .send({ pin: waiterPin })
        .expect(200);
      profileAToken = resA.body.token;

      const resB = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'DESKTOP-MGR-01')
        .send({ pin: ownerPin })
        .expect(200);
      profileBToken = resB.body.token;

      assert.notStrictEqual(profileAToken, profileBToken);

      // Verify profile A is waiter, profile B is owner
      const meA = await request(app).get('/api/auth/me').set('x-session-token', profileAToken).expect(200);
      const meB = await request(app).get('/api/auth/me').set('x-session-token', profileBToken).expect(200);

      assert.strictEqual(meA.body.user.role, 'WAITER');
      assert.strictEqual(meB.body.user.role, 'OWNER');
    });
  });

  describe('4. Kiosk Mode Unauthenticated Boundary', () => {
    it('should allow public access to build-info and sanitized menu', async () => {
      const res = await request(app)
        .get('/api/build-info')
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.buildId);
      // Ensure private DB credentials/paths are not leaked
      assert.strictEqual(res.body.data.dbUser, undefined);
      assert.strictEqual(res.body.data.dbPassword, undefined);
    });

    it('should reject unauthenticated kiosk attempts to mutate orders or payments', async () => {
      await request(app)
        .post('/api/orders')
        .send({ table_number: 5, items: [] })
        .expect(401);

      await request(app)
        .post('/api/payments/settle')
        .send({ order_id: 'ORD-123', total_amount: 100 })
        .expect(401);
    });
  });

  describe('5. Remote Session Revocation (/api/auth/revoke-all)', () => {
    let session1Token = null;
    let session2Token = null;

    it('should create two active sessions for the same user', async () => {
      const res1 = await request(app).post('/api/auth/login').send({ pin: cashierPin }).expect(200);
      const res2 = await request(app).post('/api/auth/login').send({ pin: cashierPin }).expect(200);

      session1Token = res1.body.token;
      session2Token = res2.body.token;

      assert.notStrictEqual(session1Token, session2Token);
    });

    it('should invalidate all user sessions upon revoke-all call', async () => {
      const revokeRes = await request(app)
        .post('/api/auth/revoke-all')
        .set('x-session-token', session1Token)
        .send({})
        .expect(200);

      assert.strictEqual(revokeRes.body.success, true);
      assert.ok(revokeRes.body.count >= 2);

      // Both session 1 and session 2 must now be rejected
      await request(app).get('/api/auth/me').set('x-session-token', session1Token).expect(401);
      await request(app).get('/api/auth/me').set('x-session-token', session2Token).expect(401);
    });
  });

  describe('6. Expired Session Lifecycle Validation', () => {
    it('should immediately reject sessions exceeding absolute expiry or inactivity', async () => {
      // Create an artificially expired session row in the database
      const dummyToken = crypto.randomBytes(32).toString('hex');
      const sessionHash = crypto.createHash('sha256').update(dummyToken + (process.env.SESSION_SECRET || 'cafe-mvp-secret-key-production-change-this')).digest('hex');
      const expiredTime = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour in the past

      await runQuery(
        `INSERT INTO v3_user_sessions (id, user_id, venue_id, session_hash, absolute_expiry_at, inactivity_expiry_at)
         VALUES (?, ?, 'V_DEFAULT', ?, ?, ?)`,
        [crypto.randomUUID(), userOwnerId, sessionHash, expiredTime, expiredTime]
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', dummyToken)
        .expect(401);

      assert.strictEqual(res.body.success, false);
    });
  });

  describe('7. Offline Sync Policy & Financial Settlement Gate', () => {
    it('should reject offline financial payment mutations at the API boundary', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ pin: cashierPin }).expect(200);
      const token = loginRes.body.token;

      // Direct submission of offline sync payload with unsafe settlement action
      const syncPayload = {
        device_id: 'DEV-OFFLINE-TEST',
        commands: [
          { client_command_id: 'CMD-1', action: 'SETTLE_PAYMENT', payload: { order_id: 'ORD-1', amount: 50 } }
        ]
      };

      const res = await request(app)
        .post('/api/sync/batch')
        .set('x-session-token', token)
        .send(syncPayload)
        .expect(200);

      // The sync engine must reject the financial command with REJECTED and UNSAFE_OFFLINE_ACTION
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.results[0].status, 'REJECTED');
      assert.ok(res.body.results[0].error.includes('UNSAFE_OFFLINE_ACTION'));
    });
  });

  describe('8. Dynamic Permission & Role Change During Active Session', () => {
    let activeToken = null;

    it('should authenticate user as WAITER', async () => {
      const res = await request(app).post('/api/auth/login').send({ pin: waiterPin }).expect(200);
      activeToken = res.body.token;
      assert.strictEqual(res.body.user.role, 'WAITER');
    });

    it('should reflect elevated permissions immediately when role is upgraded in DB without re-login', async () => {
      // Upgrade user to R_OP_MANAGER directly in database
      await runQuery(`UPDATE v3_users SET role_id = 'R_OP_MANAGER' WHERE id = ?`, [userWaiterId]);

      // Next request with existing activeToken immediately inherits OP_MANAGER role and permissions
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', activeToken)
        .expect(200);

      assert.strictEqual(meRes.body.user.role, 'OP_MANAGER');
      assert.ok(meRes.body.user.permissions.includes('orders:create'));
      assert.ok(meRes.body.user.permissions.includes('inventory:read'));
    });

    it('should immediately terminate session when user account is deactivated in DB', async () => {
      // Deactivate user account
      await runQuery(`UPDATE v3_users SET is_active = 0 WHERE id = ?`, [userWaiterId]);

      // Next request is rejected with 401
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', activeToken)
        .expect(401);

      assert.strictEqual(meRes.body.success, false);
      assert.strictEqual(meRes.body.code, 'AUTH_REQUIRED');
    });
  });
});
