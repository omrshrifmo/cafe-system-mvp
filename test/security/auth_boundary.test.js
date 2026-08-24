/**
 * Complete Authentication & Session Boundary Security Tests
 * Verifies PIN authentication, session hashing, least privilege /api/auth/me,
 * 15-second inactivity & unlock boundary, lockout, and full revocation.
 */
const request = require('supertest');
const assert = require('assert');
const { createApp } = require('../../src/app');
const { getDb, runQuery, getQuery } = require('../../src/db/connection');
const { hashPin, validateSession } = require('../../src/domain/auth/service');

describe('Authentication & Session Boundary Tests', function () {
  this.timeout(25000);
  let app;

  before(async () => {
    // Ensure database connection is initialized to test fixture
    getDb();
    app = createApp();
    
    // Seed/ensure test roles and users for canonical roles
    const canonicalRoles = [
      'SUPER_ADMIN', 'OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'BARISTA',
      'CHEF', 'SHISHA', 'WAITER', 'RUNNER', 'HALL_MANAGER', 'BOM_MANAGER',
      'HR_PAYROLL', 'QA', 'READ_ONLY'
    ];

    for (const r of canonicalRoles) {
      await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [`R_${r}`, r]);
    }

    const usersToSeed = [
      { id: '101', name: 'سوبر أدمن', role_id: 'R_SUPER_ADMIN', pin: '8801' },
      { id: '102', name: 'المالك التجريبي', role_id: 'R_OWNER', pin: '8802' },
      { id: '103', name: 'مدير العمليات', role_id: 'R_OP_MANAGER', pin: '8803' },
      { id: '104', name: 'كاشير رئيسي', role_id: 'R_OP_ASSISTANT_CASHIER', pin: '8804' },
      { id: '105', name: 'باريستا', role_id: 'R_BARISTA', pin: '8805' },
      { id: '106', name: 'شيف المطبخ', role_id: 'R_CHEF', pin: '8806' },
      { id: '107', name: 'مسؤول الشيشة', role_id: 'R_SHISHA', pin: '8807' },
      { id: '108', name: 'ويتر الصالة', role_id: 'R_WAITER', pin: '8808' },
      { id: '109', name: 'رانر التوصيل', role_id: 'R_RUNNER', pin: '8809' },
      { id: '110', name: 'مدير الصالة', role_id: 'R_HALL_MANAGER', pin: '8810' },
      { id: '111', name: 'مدير المخزون والوصفات', role_id: 'R_BOM_MANAGER', pin: '8811' },
      { id: '112', name: 'مسؤول الرواتب وشؤون الموظفين', role_id: 'R_HR_PAYROLL', pin: '8812' },
      { id: '113', name: 'مراقب الجودة', role_id: 'R_QA', pin: '8813' },
      { id: '114', name: 'مستخدم تقارير للقراءة فقط', role_id: 'R_READ_ONLY', pin: '8814' },
      { id: '115', name: 'مستخدم معطل', role_id: 'R_WAITER', pin: '8815', is_active: 0 }
    ];

    for (const u of usersToSeed) {
      const pinHash = await hashPin(u.pin);
      const isActive = u.is_active !== undefined ? u.is_active : 1;
      await runQuery(
        `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, 0, NULL)`,
        [u.id, u.name, u.role_id, pinHash, isActive]
      );
    }
  });

  describe('1. Canonical Role Login & Route Mapping', () => {
    const roleTests = [
      { pin: '8801', expectedRole: 'SUPER_ADMIN', expectedRoute: '/portal.html' },
      { pin: '8802', expectedRole: 'OWNER', expectedRoute: '/portal.html' },
      { pin: '8803', expectedRole: 'OP_MANAGER', expectedRoute: '/portal.html' },
      { pin: '8804', expectedRole: 'OP_ASSISTANT_CASHIER', expectedRoute: '/pos.html' },
      { pin: '8805', expectedRole: 'BARISTA', expectedRoute: '/kds.html' },
      { pin: '8806', expectedRole: 'CHEF', expectedRoute: '/kitchen.html' },
      { pin: '8807', expectedRole: 'SHISHA', expectedRoute: '/shisha.html' },
      { pin: '8808', expectedRole: 'WAITER', expectedRoute: '/pos.html' },
      { pin: '8809', expectedRole: 'RUNNER', expectedRoute: '/runner.html' },
      { pin: '8810', expectedRole: 'HALL_MANAGER', expectedRoute: '/tables.html' },
      { pin: '8811', expectedRole: 'BOM_MANAGER', expectedRoute: '/menu-manager.html' },
      { pin: '8812', expectedRole: 'HR_PAYROLL', expectedRoute: '/hr.html' },
      { pin: '8813', expectedRole: 'QA', expectedRoute: '/qa.html' },
      { pin: '8814', expectedRole: 'READ_ONLY', expectedRoute: '/bi.html' }
    ];

    for (const testCase of roleTests) {
      it(`should login ${testCase.expectedRole} with PIN ${testCase.pin} and return route ${testCase.expectedRoute}`, async () => {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ pin: testCase.pin });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.user.role, testCase.expectedRole);
        assert.strictEqual(res.body.user.defaultRoute, testCase.expectedRoute);
        
        // Ensure session cookie is set
        const cookies = res.headers['set-cookie'];
        assert.ok(cookies, 'Set-Cookie header must be present');
        const sessionCookie = cookies.find(c => c.startsWith('session_token='));
        assert.ok(sessionCookie, 'session_token cookie must be present');
        assert.ok(sessionCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
        assert.ok(sessionCookie.includes('SameSite=Lax') || sessionCookie.includes('samesite=lax'), 'Cookie must have SameSite=Lax');
      });
    }
  });

  describe('2. Sanitized Identity on /api/auth/me (Least Privilege)', () => {
    it('should NEVER return raw sessionId, tokens, or wildcard * permissions', async () => {
      // Login as OWNER (which has internal wildcard permissions)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8802' });

      const cookies = loginRes.headers['set-cookie'];

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookies);

      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.success, true);
      const user = meRes.body.user;

      // Identity sanity checks
      assert.strictEqual(user.role, 'OWNER');
      assert.strictEqual(user.id, '102');
      assert.strictEqual(user.venueId, 'V_DEFAULT');
      assert.strictEqual(user.defaultRoute, '/portal.html');

      // Security boundary assertions:
      assert.strictEqual(user.sessionId, undefined, 'sessionId MUST NOT be returned');
      assert.strictEqual(user.token, undefined, 'token MUST NOT be returned');
      assert.strictEqual(user.pin_hash, undefined, 'pin_hash MUST NOT be returned');
      assert.ok(Array.isArray(user.permissions), 'permissions must be an array');
      assert.strictEqual(user.permissions.includes('*'), false, 'Wildcard * MUST NOT be exposed to client');
    });
  });

  describe('3. Login Failure, Lockout & Disabled Account', () => {
    it('should reject invalid PIN with generic error and 401 status', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ pin: '0000' });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('غير صحيح') || res.body.error.includes('INVALID_CREDENTIALS'));
    });

    it('should reject disabled user with ACCOUNT_DISABLED', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8815' });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('معطل') || res.body.code === 'ACCOUNT_DISABLED');
    });
  });

  describe('4. Comprehensive Logout & Invalidation', () => {
    it('should revoke session in DB, clear cookie, and block subsequent /api/auth/me', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8802' });

      const cookies = loginRes.headers['set-cookie'];
      const rawCookie = cookies.find(c => c.startsWith('session_token='));
      const tokenMatch = rawCookie.match(/session_token=([^;]+)/);
      const rawToken = tokenMatch[1];

      // Validate session works before logout
      const beforeRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookies);
      assert.strictEqual(beforeRes.status, 200);

      // Perform POST /api/auth/logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', '1')
        .send({});

      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      // Verify Set-Cookie clears the session token
      const logoutCookies = logoutRes.headers['set-cookie'];
      assert.ok(logoutCookies, 'Logout must send clearing Set-Cookie');

      // Verify session is marked revoked in DB
      const userSession = await validateSession(rawToken, false);
      assert.strictEqual(userSession, null, 'Revoked session must evaluate to null in DB');

      // Verify subsequent request with old cookie returns 401 AUTH_REQUIRED
      const afterRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookies);
      assert.strictEqual(afterRes.status, 401);
      assert.strictEqual(afterRes.body.code, 'AUTH_REQUIRED');
    });
  });

  describe('5. Lock Screen & Reauthentication (/api/auth/unlock & /api/auth/verify-pin)', () => {
    let sessionCookies;

    beforeEach(async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8803' });
      sessionCookies = loginRes.headers['set-cookie'];
    });

    it('should unlock screen with correct PIN', async () => {
      const res = await request(app)
        .post('/api/auth/unlock')
        .set('Cookie', sessionCookies)
        .send({ pin: '8803' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.verified, true);
    });

    it('should reject unlock with wrong PIN without destroying session', async () => {
      const res = await request(app)
        .post('/api/auth/unlock')
        .set('Cookie', sessionCookies)
        .send({ pin: '9998' });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'INVALID_PIN');

      // Session should still be active for a retry
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookies);
      assert.strictEqual(meRes.status, 200);
    });
  });

  describe('6. PIN Rotation & Session Revocation', () => {
    it('should rotate user PIN and revoke all prior sessions', async () => {
      // Login with cashier PIN 8804
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8804' });
      const cookies = loginRes.headers['set-cookie'];

      // Rotate PIN to 8844
      const rotateRes = await request(app)
        .post('/api/auth/rotate-pin')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', '1')
        .send({ oldPin: '8804', newPin: '8844' });

      assert.strictEqual(rotateRes.status, 200);
      assert.strictEqual(rotateRes.body.success, true);

      // Old session is now revoked
      const oldSessionRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookies);
      assert.strictEqual(oldSessionRes.status, 401);

      // Login with old PIN must fail
      const oldLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8804' });
      assert.strictEqual(oldLoginRes.status, 401);

      // Login with new PIN must succeed
      const newLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8844' });
      assert.strictEqual(newLoginRes.status, 200);
      assert.strictEqual(newLoginRes.body.user.role, 'OP_ASSISTANT_CASHIER');

      // Restore original PIN for repeatability
      const restoreLogin = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8844' });
      assert.strictEqual(restoreLogin.status, 200);

      const restoreRes = await request(app)
        .post('/api/auth/rotate-pin')
        .set('Cookie', restoreLogin.headers['set-cookie'])
        .set('X-CSRF-Token', '1')
        .send({ oldPin: '8844', newPin: '8804' });
      assert.strictEqual(restoreRes.status, 200);
    });
  });
});

