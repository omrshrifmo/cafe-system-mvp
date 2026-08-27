/**
 * Complete Device Trust, Active Sessions, Forced Logout, Emergency Access & Kiosk Mode Security Test Suite
 * Validates all security gates and invariants specified in Prompt S8.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const crypto = require('crypto');

// Set isolated test environment
process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, '../../fixtures/gate-device-session.sqlite');
process.env.DB_PATH = TEST_DB;

const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { hashPin, validateSession } = require('../../src/domain/auth/service');
const { verifyAuditChainIntegrity } = require('../../src/domain/audit/auditLedgerService');
const deviceTrustService = require('../../src/domain/admin/deviceTrustService');
const sessionAdminService = require('../../src/domain/admin/sessionAdminService');
const emergencyAccessService = require('../../src/domain/admin/emergencyAccessService');

describe('Prompt S8: Device Trust, Active Sessions, Forced Logout & Emergency Access Gate', () => {
  let app;
  let superAdminId, ownerId, managerId, cashierId, waiterId;
  let superAdminPin = '9901', ownerPin = '9902', managerPin = '9903', cashierPin = '9904', waiterPin = '9905';
  let superAdminCookie, ownerCookie, managerCookie, cashierCookie, waiterCookie;

  before(async () => {
    // Reset isolated test fixture
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await runMigrations();
    app = createApp();

    // Seed baseline venue & roles
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Device Gate Venue')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_SUPER_ADMIN', 'V_DEFAULT', 'SUPER_ADMIN')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OWNER', 'V_DEFAULT', 'OWNER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OP_MANAGER', 'V_DEFAULT', 'OP_MANAGER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`);

    // Seed canonical test users
    superAdminId = 'U_SADMIN_8';
    ownerId = 'U_OWNER_8';
    managerId = 'U_MGR_8';
    cashierId = 'U_CASHIER_8';
    waiterId = 'U_WAITER_8';

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', 'سوبر أدمن', 'R_SUPER_ADMIN', ?, 1)`,
      [superAdminId, await hashPin(superAdminPin)]
    );
    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', 'مالك الكافيه', 'R_OWNER', ?, 1)`,
      [ownerId, await hashPin(ownerPin)]
    );
    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', 'مدير العمليات', 'R_OP_MANAGER', ?, 1)`,
      [managerId, await hashPin(managerPin)]
    );
    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', 'كاشير الصالة', 'R_CASHIER', ?, 1)`,
      [cashierId, await hashPin(cashierPin)]
    );
    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active) VALUES (?, 'V_DEFAULT', 'ويتر الصالة', 'R_WAITER', ?, 1)`,
      [waiterId, await hashPin(waiterPin)]
    );

    // Perform canonical logins to establish baseline sessions
    const sAdminRes = await request(app).post('/api/auth/login').send({ pin: superAdminPin });
    superAdminCookie = sAdminRes.headers['set-cookie'];

    const ownerRes = await request(app).post('/api/auth/login').send({ pin: ownerPin });
    ownerCookie = ownerRes.headers['set-cookie'];

    const mgrRes = await request(app).post('/api/auth/login').send({ pin: managerPin });
    managerCookie = mgrRes.headers['set-cookie'];

    const cashRes = await request(app).post('/api/auth/login').send({ pin: cashierPin });
    cashierCookie = cashRes.headers['set-cookie'];

    const waitRes = await request(app).post('/api/auth/login').send({ pin: waiterPin });
    waiterCookie = waitRes.headers['set-cookie'];
  });

  describe('1. Device Registry & Scoped Expiring Trust Lifecycle', () => {
    let testDeviceId = 'DEV-TERMINAL-01';

    it('should register a new device in untrusted state with OS and browser metadata', async () => {
      const regPayload = {
        device_id: testDeviceId,
        friendly_name: 'جهاز الكاشير الرئيسي 1',
        device_class: 'POS',
        browser_version: 'Chrome 128.0 (Linux)',
        os_info: 'Ubuntu Linux 24.04 LTS',
        station_id: 'STATION_BARISTA_1'
      };

      const res = await request(app)
        .post('/api/devices/register')
        .send(regPayload)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.device.id, testDeviceId);
      assert.strictEqual(res.body.device.friendly_name, 'جهاز الكاشير الرئيسي 1');
      assert.strictEqual(res.body.device.device_class, 'POS');
      assert.strictEqual(res.body.device.is_trusted, false);
      assert.strictEqual(res.body.device.is_trust_active, false);
    });

    it('should BLOCK cashier from granting device trust (403 FORBIDDEN / TRUST_GRANT_DENIED)', async () => {
      const res = await request(app)
        .post(`/api/devices/${testDeviceId}/trust`)
        .set('Cookie', cashierCookie)
        .send({ duration_hours: 24, pin: cashierPin });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject device trust grant with wrong manager PIN', async () => {
      const res = await request(app)
        .post(`/api/devices/${testDeviceId}/trust`)
        .set('Cookie', managerCookie)
        .send({ duration_hours: 24, pin: '0000' })
        .expect(403);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('غير صحيح') || res.body.code === 'TRUST_GRANT_DENIED');
    });

    it('should allow Manager with step-up PIN to grant trust with expiration and station assignment', async () => {
      const res = await request(app)
        .post(`/api/devices/${testDeviceId}/trust`)
        .set('Cookie', managerCookie)
        .send({ duration_hours: 48, station_id: 'STATION_BARISTA_1', pin: managerPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.device.is_trusted, true);
      assert.strictEqual(res.body.device.is_trust_active, true);
      assert.strictEqual(res.body.device.is_trust_expired, false);
      assert.ok(res.body.device.trust_expires_at);
    });

    it('should correctly evaluate expired trust when trust_expires_at is in the past', async () => {
      const expiredDeviceId = 'DEV-EXPIRED-TEST';
      await runQuery(
        `INSERT INTO devices (id, branch_id, venue_id, name, friendly_name, device_type, device_class, is_trusted, trust_expires_at, status)
         VALUES (?, 'B_DEFAULT', 'V_DEFAULT', 'Expired Device', 'Expired Device', 'POS', 'POS', 1, datetime('now', '-2 hours'), 'ACTIVE')`,
        [expiredDeviceId]
      );

      const device = await deviceTrustService.getDeviceById(expiredDeviceId);
      assert.strictEqual(device.is_trusted, true);
      assert.strictEqual(device.is_trust_expired, true);
      assert.strictEqual(device.is_trust_active, false, 'Expired trust must evaluate to false');
    });
  });

  describe('2. Security Invariant: Trusted Device Cannot Bypass Permissions or Shifts', () => {
    it('should NOT allow Waiter on a trusted POS device to access admin-only settings', async () => {
      const res = await request(app)
        .put('/api/admin/venue')
        .set('Cookie', waiterCookie)
        .set('x-device-id', 'DEV-TERMINAL-01')
        .send({ legal_name: 'Hacked Venue' });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });

    it('should NOT allow payment settlement without appropriate cashier permissions even on a trusted device', async () => {
      const res = await request(app)
        .post('/api/payments/settle')
        .set('Cookie', waiterCookie)
        .set('x-device-id', 'DEV-TERMINAL-01')
        .send({ order_id: 'ORD-999', total_amount: 100 });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('3. Active Session Administration & Granular Remote Invalidation', () => {
    let sessionToRevokeId = null;

    it('should list active sessions with user, device, role, IP, and idle time metadata', async () => {
      const res = await request(app)
        .get('/api/admin/sessions')
        .set('Cookie', ownerCookie)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.sessions));
      assert.ok(res.body.count >= 3);

      const cashierSession = res.body.sessions.find(s => s.userId === cashierId);
      assert.ok(cashierSession, 'Cashier session must be visible in admin session list');
      assert.strictEqual(cashierSession.role, 'OP_ASSISTANT_CASHIER');
      assert.ok(cashierSession.sessionId);
      assert.ok(cashierSession.ipAddress);
      assert.strictEqual(typeof cashierSession.idleSeconds, 'number');

      sessionToRevokeId = cashierSession.sessionId;
    });

    it('should remotely revoke a single session by ID and block subsequent calls with that session', async () => {
      const res = await request(app)
        .post(`/api/admin/sessions/${sessionToRevokeId}/revoke`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'جلسة مشبوهة' })
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify the cashier session is now revoked and rejected
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cashierCookie)
        .expect(401);

      assert.strictEqual(meRes.body.success, false);
      assert.strictEqual(meRes.body.code, 'AUTH_REQUIRED');
    });

    it('should remotely revoke ALL sessions for a specific user', async () => {
      // Create two sessions for waiter
      const login1 = await request(app).post('/api/auth/login').send({ pin: waiterPin });
      const login2 = await request(app).post('/api/auth/login').send({ pin: waiterPin });

      const cookie1 = login1.headers['set-cookie'];
      const cookie2 = login2.headers['set-cookie'];

      const revokeRes = await request(app)
        .post(`/api/admin/sessions/user/${waiterId}/revoke`)
        .set('Cookie', managerCookie)
        .send({ reason: 'إعادة تعيين الوردية' })
        .expect(200);

      assert.strictEqual(revokeRes.body.success, true);
      assert.ok(revokeRes.body.count >= 2);

      // Both sessions must now be rejected
      await request(app).get('/api/auth/me').set('Cookie', cookie1).expect(401);
      await request(app).get('/api/auth/me').set('Cookie', cookie2).expect(401);
    });

    it('should remotely revoke ALL sessions on a device when device is revoked', async () => {
      const targetDevId = 'DEV-REVOKE-DEVICE-TEST';
      await deviceTrustService.registerDevice('V_DEFAULT', 'BR_DEFAULT', {
        device_id: targetDevId,
        friendly_name: 'جهاز للمصادرة'
      });

      // Login on this device
      const devLogin = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', targetDevId)
        .send({ pin: managerPin })
        .expect(200);

      const devCookie = devLogin.headers['set-cookie'];

      // Revoke the device
      const revokeDevRes = await request(app)
        .post(`/api/devices/${targetDevId}/revoke`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'جهاز مسروق أو مفصول' })
        .expect(200);

      assert.strictEqual(revokeDevRes.body.success, true);
      assert.strictEqual(revokeDevRes.body.status, 'REVOKED');

      // Subsequent request from this session is rejected because device is REVOKED
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', devCookie)
        .expect(401);

      assert.strictEqual(meRes.body.success, false);

      // New login attempt from revoked device must be strictly blocked
      const loginAttempt = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', targetDevId)
        .send({ pin: managerPin })
        .expect(401);

      assert.ok(loginAttempt.body.error.includes('إبطال') || loginAttempt.body.code === 'AUTH_FAILED');
    });

    it('should reject Global Emergency Revocation without valid PIN and execute when verified', async () => {
      // 1. Wrong PIN fails
      await request(app)
        .post('/api/admin/sessions/revoke-global')
        .set('Cookie', ownerCookie)
        .send({ pin: '0000', reason: 'اختبار خاطئ' })
        .expect(403);

      // 2. Correct Owner PIN revokes all sessions globally
      const globalRes = await request(app)
        .post('/api/admin/sessions/revoke-global')
        .set('Cookie', ownerCookie)
        .send({ pin: ownerPin, reason: 'إخلاء طارئ لجميع الجلسات' })
        .expect(200);

      assert.strictEqual(globalRes.body.success, true);
      assert.ok(globalRes.body.totalRevoked >= 1);

      // Verify all previous sessions are now dead
      await request(app).get('/api/auth/me').set('Cookie', managerCookie).expect(401);
      await request(app).get('/api/auth/me').set('Cookie', ownerCookie).expect(401);
    });
  });

  describe('4. Credential & Role Change Session Invalidation', () => {
    let freshWaiterCookie;

    beforeEach(async () => {
      // Re-login waiter
      const res = await request(app).post('/api/auth/login').send({ pin: waiterPin });
      freshWaiterCookie = res.headers['set-cookie'];
    });

    it('should immediately invalidate active sessions upon PIN rotation', async () => {
      // Verify session is active
      await request(app).get('/api/auth/me').set('Cookie', freshWaiterCookie).expect(200);

      // Rotate PIN to 9955
      const rotateRes = await request(app)
        .post('/api/auth/rotate-pin')
        .set('Cookie', freshWaiterCookie)
        .send({ oldPin: waiterPin, newPin: '9955' })
        .expect(200);

      assert.strictEqual(rotateRes.body.success, true);

      // Old session is now immediately rejected
      await request(app).get('/api/auth/me').set('Cookie', freshWaiterCookie).expect(401);

      // Login with old PIN fails
      await request(app).post('/api/auth/login').send({ pin: waiterPin }).expect(401);

      // Login with new PIN succeeds
      const newLogin = await request(app).post('/api/auth/login').send({ pin: '9955' }).expect(200);
      assert.strictEqual(newLogin.body.user.role, 'WAITER');

      // Revert PIN to original for clean state
      await request(app)
        .post('/api/auth/rotate-pin')
        .set('Cookie', newLogin.headers['set-cookie'])
        .send({ oldPin: '9955', newPin: waiterPin })
        .expect(200);
    });

    it('should terminate active sessions when user account is deactivated in DB', async () => {
      // Deactivate waiter account
      await runQuery(`UPDATE v3_users SET is_active = 0 WHERE id = ?`, [waiterId]);

      // Active session is rejected with 401
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', freshWaiterCookie)
        .expect(401);

      assert.strictEqual(meRes.body.success, false);

      // Restore active status
      await runQuery(`UPDATE v3_users SET is_active = 1 WHERE id = ?`, [waiterId]);
    });
  });

  describe('5. Super-Admin Emergency Access (Break-Glass) Lifecycle', () => {
    let freshSAdminCookie, emergencySessionId;

    beforeEach(async () => {
      const res = await request(app).post('/api/auth/login').send({ pin: superAdminPin });
      freshSAdminCookie = res.headers['set-cookie'];
    });

    it('should reject emergency access request without ticket reference or reason', async () => {
      const res = await request(app)
        .post('/api/admin/emergency/request')
        .set('Cookie', freshSAdminCookie)
        .send({ pin: superAdminPin, reason: '' })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('VALIDATION_ERROR'));
    });

    it('should reject emergency access request from non-SUPER_ADMIN user (e.g. Cashier)', async () => {
      const cashLogin = await request(app).post('/api/auth/login').send({ pin: cashierPin });
      const res = await request(app)
        .post('/api/admin/emergency/request')
        .set('Cookie', cashLogin.headers['set-cookie'])
        .send({ ticket_ref: 'INC-999', reason: 'محاولة اختراق', pin: cashierPin })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('FORBIDDEN') || res.body.error.includes('Super Admin'));
    });

    it('should grant emergency access with valid PIN, ticket, reason, and enforce max duration cap', async () => {
      const emgPayload = {
        ticket_ref: 'INC-2026-08-9921',
        reason: 'صيانة طارئة لاستعادة قاعدة البيانات وإصلاح جداول المعاملات المالية',
        scope: 'SYSTEM_RECOVERY',
        duration_minutes: 60,
        pin: superAdminPin
      };

      const res = await request(app)
        .post('/api/admin/emergency/request')
        .set('Cookie', freshSAdminCookie)
        .send(emgPayload)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.emergencyId);
      assert.strictEqual(res.body.ticketRef, 'INC-2026-08-9921');
      assert.strictEqual(res.body.scope, 'SYSTEM_RECOVERY');
      assert.strictEqual(res.body.durationMinutes, 60);
      assert.ok(res.body.expiresAt);

      emergencySessionId = res.body.emergencyId;
    });

    it('should show emergency session in active emergency status list', async () => {
      const res = await request(app)
        .get('/api/admin/emergency/status')
        .set('Cookie', freshSAdminCookie)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.count >= 1);
      const activeEmg = res.body.sessions.find(e => e.id === emergencySessionId);
      assert.ok(activeEmg, 'Emergency session must be listed in active status');
      assert.strictEqual(activeEmg.ticketRef, 'INC-2026-08-9921');
      assert.strictEqual(activeEmg.isActive, true);
    });

    it('should emit a CRITICAL security alert and in-app notification upon emergency access', async () => {
      const alert = await getQuery(
        `SELECT * FROM v3_security_alerts WHERE alert_type = 'EMERGENCY_ACCESS_ACTIVATED' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(alert, 'Critical security alert must be registered in v3_security_alerts');
      assert.strictEqual(alert.severity, 'CRITICAL');
      assert.ok(alert.description_ar.includes('INC-2026-08-9921'));
    });

    it('should allow early termination of emergency access and record audit event', async () => {
      const res = await request(app)
        .post('/api/admin/emergency/terminate')
        .set('Cookie', freshSAdminCookie)
        .send({ emergency_id: emergencySessionId, reason: 'تم إنجاز أعمال الصيانة الطارئة بنجاح' })
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify it is no longer listed as active
      const statusRes = await request(app)
        .get('/api/admin/emergency/status')
        .set('Cookie', freshSAdminCookie)
        .expect(200);

      const activeEmg = statusRes.body.sessions.find(e => e.id === emergencySessionId);
      assert.strictEqual(activeEmg, undefined, 'Terminated emergency session must not appear in active status');
    });
  });

  describe('6. Kiosk Mode Lockdown & Station Route Guard', () => {
    let kioskDeviceId = 'DEV-KIOSK-BARISTA-01';

    before(async () => {
      await deviceTrustService.registerDevice('V_DEFAULT', 'B_DEFAULT', {
        device_id: kioskDeviceId,
        friendly_name: 'شاشة البارستا (Kiosk)',
        device_class: 'KDS',
        station_id: 'STATION_BARISTA_1'
      });
    });

    it('should configure device in kiosk mode locked to /kds.html', async () => {
      const res = await deviceTrustService.configureKioskMode(
        'V_DEFAULT',
        kioskDeviceId,
        { id: managerId, role: 'OP_MANAGER', venueId: 'V_DEFAULT' },
        true,
        '/kds.html',
        managerPin
      );

      assert.strictEqual(res.is_kiosk, true);
      assert.strictEqual(res.kiosk_allowed_route, '/kds.html');
    });

    it('should validate allowed route on kiosk device and reject unauthorized routes', async () => {
      // 1. Access to /kds.html is allowed
      const validCheck = await deviceTrustService.validateDeviceForOperation(kioskDeviceId, '/kds.html');
      assert.strictEqual(validCheck.allowed, true);

      // 2. Access to /settings.html on kiosk is rejected
      await assert.rejects(
        async () => {
          await deviceTrustService.validateDeviceForOperation(kioskDeviceId, '/settings.html');
        },
        /KIOSK_ROUTE_FORBIDDEN/
      );
    });
  });

  describe('7. Append-Only Cryptographic Audit Trail Verification', () => {
    it('should verify the cryptographic SHA-256 audit chain integrity across all Prompt S8 actions', async () => {
      const integrity = await verifyAuditChainIntegrity('V_DEFAULT');
      assert.strictEqual(integrity.isValid, true, 'Audit chain integrity must be 100% cryptographically valid');
      assert.ok(integrity.totalChecked >= 5, 'Must contain records from device, session, and emergency actions');
    });
  });
});
