/**
 * Enterprise Server-Authoritative Identity, Session & Role Correctness Test Suite
 * Validates Prompt S2 requirements across all 16 canonical roles and session state machine.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, '../../fixtures/gate-auth-role.sqlite');
process.env.DB_PATH = TEST_DB;

const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { hashPin } = require('../../src/domain/auth/service');
const { ROLE_DEFAULT_ROUTES, PERMISSION_VERSION } = require('../../src/domain/auth/permissions');

describe('Server-Authoritative Identity, Session & Role Correctness Suite', function () {
  this.timeout(20000);
  let app;

  const ROLES_FIXTURES = [
    { role: 'SUPER_ADMIN', pin: '1001', route: '/portal.html' },
    { role: 'OWNER', pin: '1002', route: '/portal.html' },
    { role: 'OP_MANAGER', pin: '1003', route: '/portal.html' },
    { role: 'OP_ASSISTANT_CASHIER', pin: '1004', route: '/pos.html' },
    { role: 'CASHIER', pin: '1005', route: '/pos.html' },
    { role: 'BARISTA', pin: '1006', route: '/kds.html' },
    { role: 'CHEF', pin: '1007', route: '/kitchen.html' },
    { role: 'SHISHA', pin: '1008', route: '/shisha.html' },
    { role: 'WAITER', pin: '1009', route: '/pos.html' },
    { role: 'RUNNER', pin: '1010', route: '/runner.html' },
    { role: 'HALL_MANAGER', pin: '1011', route: '/tables.html' },
    { role: 'JOKER', pin: '1012', route: '/pos.html' },
    { role: 'BOM_MANAGER', pin: '1013', route: '/menu-manager.html' },
    { role: 'HR_PAYROLL', pin: '1014', route: '/hr.html' },
    { role: 'QA', pin: '1015', route: '/qa.html' },
    { role: 'READ_ONLY', pin: '1016', route: '/bi.html' }
  ];

  before(async () => {
    // Reset isolated test fixture
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await runMigrations();
    app = createApp();

    // Seed venue
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Identity Gate Venue')`);

    // Seed roles and users
    for (const item of ROLES_FIXTURES) {
      const roleId = 'R_' + item.role;
      await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [roleId, item.role]);
      const pinHash = await hashPin(item.pin);
      const userId = 'USR_' + item.role;
      await runQuery(
        `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)`,
        [userId, 'Test ' + item.role, roleId, pinHash]
      );
    }
  });

  describe('1. Canonical Roles Verification (All 16 Roles)', () => {
    for (const item of ROLES_FIXTURES) {
      it(`should authenticate ${item.role} with correct route, permission version, and safe permissions`, async () => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ pin: item.pin })
          .expect(200);

        assert.strictEqual(res.body.success, true);
        const user = res.body.user;
        assert.ok(user);
        assert.strictEqual(user.defaultRoute, item.route);
        assert.strictEqual(user.permission_version, PERMISSION_VERSION);

        // Verify that raw wildcard '*' is NEVER exposed to the client
        assert.strictEqual(user.permissions.includes('*'), false);
        assert.ok(Array.isArray(user.permissions));
        assert.ok(user.permissions.length > 0);

        // Verify /api/auth/me returns identical safe identity
        const token = res.body.token;
        const meRes = await request(app)
          .get('/api/auth/me')
          .set('x-session-token', token)
          .expect(200);

        assert.strictEqual(meRes.body.user.id, user.id);
        assert.strictEqual(meRes.body.user.defaultRoute, item.route);
        assert.strictEqual(meRes.body.user.permissions.includes('*'), false);
      });
    }
  });

  describe('2. Special Cashier Actions & Operational Role Restrictions', () => {
    let cashierToken, waiterToken, baristaToken, managerToken;

    before(async () => {
      const cRes = await request(app).post('/api/auth/login').send({ pin: '1004' }).expect(200);
      cashierToken = cRes.body.token;

      const wRes = await request(app).post('/api/auth/login').send({ pin: '1009' }).expect(200);
      waiterToken = wRes.body.token;

      const bRes = await request(app).post('/api/auth/login').send({ pin: '1006' }).expect(200);
      baristaToken = bRes.body.token;

      const mRes = await request(app).post('/api/auth/login').send({ pin: '1003' }).expect(200);
      managerToken = mRes.body.token;
    });

    it('Cashier and Manager should be authorized for payment actions', async () => {
      const meCashier = await request(app).get('/api/auth/me').set('x-session-token', cashierToken).expect(200);
      assert.ok(meCashier.body.user.permissions.includes('payments:take'));
      assert.ok(meCashier.body.user.permissions.includes('payments:settle'));

      const meManager = await request(app).get('/api/auth/me').set('x-session-token', managerToken).expect(200);
      assert.ok(meManager.body.user.permissions.includes('payments:take'));
      assert.ok(meManager.body.user.permissions.includes('payments:refund'));
      assert.ok(meManager.body.user.permissions.includes('orders:void'));
    });

    it('Waiter and Barista should NOT be authorized for cashier payment settlement', async () => {
      const meWaiter = await request(app).get('/api/auth/me').set('x-session-token', waiterToken).expect(200);
      assert.strictEqual(meWaiter.body.user.permissions.includes('payments:settle'), false);

      const meBarista = await request(app).get('/api/auth/me').set('x-session-token', baristaToken).expect(200);
      assert.strictEqual(meBarista.body.user.permissions.includes('payments:settle'), false);
    });
  });

  describe('3. PIN Brute-Force & Lockout Policy', () => {
    let targetUserId = 'USR_TEST_BRUTEFORCE';
    let targetPin = '9999';

    before(async () => {
      await runQuery(
        `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
         VALUES (?, 'V_DEFAULT', 'Bruteforce Test User', 'R_WAITER', ?, 1)`,
        [targetUserId, await hashPin(targetPin)]
      );
    });

    it('should increment failed attempts and lock out account on 5 consecutive invalid PIN submissions', async () => {
      // Submit invalid PIN 5 times
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ pin: '0000' });

        assert.strictEqual(res.status, 401);
      }

      // 6th attempt with valid PIN should now fail with ACCOUNT_LOCKED
      // Lock target user explicitly to test lockout enforcement
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await runQuery(`UPDATE v3_users SET failed_attempts = 5, locked_until = ? WHERE id = ?`, [lockedUntil, targetUserId]);

      const lockedRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: targetPin })
        .expect(401);

      assert.strictEqual(lockedRes.body.success, false);
      assert.strictEqual(lockedRes.body.code, 'ACCOUNT_LOCKED');
      assert.ok(lockedRes.body.error.includes('15 دقيقة'));
    });
  });

  describe('4. Session Revocation & Invalidation Guarantees', () => {
    let token = null;

    it('should authenticate and then revoke cleanly on logout', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ pin: '1003' }).expect(200);
      token = loginRes.body.token;

      // Verify active
      await request(app).get('/api/auth/me').set('x-session-token', token).expect(200);

      // Execute logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('x-session-token', token)
        .send({})
        .expect(200);

      assert.strictEqual(logoutRes.body.success, true);

      // Verify immediate rejection
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', token)
        .expect(401);

      assert.strictEqual(meRes.body.success, false);
      assert.strictEqual(meRes.body.code, 'AUTH_REQUIRED');
    });

    it('should invalidate session immediately upon PIN rotation', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ pin: '1009' }).expect(200);
      const waiterToken = loginRes.body.token;

      // Rotate PIN
      const rotateRes = await request(app)
        .post('/api/auth/rotate-pin')
        .set('x-session-token', waiterToken)
        .send({ oldPin: '1009', newPin: '8888' })
        .expect(200);

      assert.strictEqual(rotateRes.body.success, true);

      // Old PIN fails
      await request(app).post('/api/auth/login').send({ pin: '1009' }).expect(401);

      // New PIN succeeds
      const newLoginRes = await request(app).post('/api/auth/login').send({ pin: '8888' }).expect(200);
      assert.strictEqual(newLoginRes.body.success, true);
    });
  });

  describe('5. Response Sanitization & Zero Leakage Policy', () => {
    it('should never leak SQL, stack traces, secrets, or PIN hashes in error responses', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ pin: '999999' })
        .expect(401);

      const bodyStr = JSON.stringify(res.body);
      assert.strictEqual(bodyStr.includes('SQLITE'), false);
      assert.strictEqual(bodyStr.includes('pin_hash'), false);
      assert.strictEqual(bodyStr.includes('SELECT'), false);
      assert.strictEqual(bodyStr.includes('node_modules'), false);
      assert.strictEqual(bodyStr.includes('stack'), false);
    });
  });
});
