/**
 * Prompt S7: Append-Only Audit Ledger, Activity System, Suspicious Behavior Detection & In-App Alerts Gate Suite
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { getDb, runQuery, allQuery, getQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { createApp } = require('../../src/app');
const { recordAuditEvent, verifyAuditChainIntegrity, queryAuditLedger, exportAuditLedger, getStaffActivitySummary } = require('../../src/domain/audit/auditLedgerService');
const { evaluateSecurityAnomaly, triggerSecurityAlert, getSecurityAlerts, acknowledgeAlert, resolveAlert } = require('../../src/domain/audit/securityAnomalyService');
const { dispatchAlertNotification, getUserNotifications, markNotificationAsRead, updateChannelConfig, deliverNotification } = require('../../src/domain/audit/notificationDispatcher');

describe('Prompt S7: Append-Only Audit, Activity Ledger, Suspicious Alerts & In-App Notifications', function () {
  this.timeout(40000);

  let app;
  let testDbPath;
  let ownerCookies;
  let cashierCookies;
  let waiterCookies;

  before(async () => {
    testDbPath = path.join(__dirname, '../../fixtures/gate-audit-alerts.sqlite');
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }

    process.env.NODE_ENV = 'test';
    process.env.CAFE_DB_PATH = testDbPath;

    const db = getDb(testDbPath);
    await runMigrations(db);

    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'كافيه مزاج')`, [], db);

    // Seed test users
    const bcrypt = require('bcryptjs');
    const ownerPinHash = await bcrypt.hash('9999', 10);
    const cashierPinHash = await bcrypt.hash('1111', 10);
    const waiterPinHash = await bcrypt.hash('2222', 10);

    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_OWNER', 'V_DEFAULT', 'OWNER')`, [], db);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'CASHIER')`, [], db);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`, [], db);

    await runQuery(`
      INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
      VALUES 
        ('U_OWNER', 'V_DEFAULT', 'مالك المقهى', 'R_OWNER', '${ownerPinHash}', 1),
        ('U_CASHIER', 'V_DEFAULT', 'كاشير الصباح', 'R_CASHIER', '${cashierPinHash}', 1),
        ('U_WAITER', 'V_DEFAULT', 'ويتر الصالة', 'R_WAITER', '${waiterPinHash}', 1)
    `, [], db);

    app = createApp();

    // Authenticate test users
    const ownerLogin = await request(app).post('/api/auth/login').send({ pin: '9999' }).expect(200);
    ownerCookies = ownerLogin.headers['set-cookie'];

    const cashierLogin = await request(app).post('/api/auth/login').send({ pin: '1111' }).expect(200);
    cashierCookies = cashierLogin.headers['set-cookie'];

    const waiterLogin = await request(app).post('/api/auth/login').send({ pin: '2222' }).expect(200);
    waiterCookies = waiterLogin.headers['set-cookie'];
  });

  after(async () => {
    const { closeDb } = require('../../src/db/connection');
    await closeDb();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  });

  describe('1. Taxonomy & Cryptographic Hash Chain Integrity', () => {
    it('should record events across all domains and link cryptographic hash chain', async () => {
      // 1. Auth / Order Event
      const ev1 = await recordAuditEvent({
        event_type: 'ORDER_DRAFT_CREATED',
        actor_user_id: 'U_OWNER',
        actor_name: 'مالك المقهى',
        actor_role: 'OWNER',
        venue_id: 'V_DEFAULT',
        outcome: 'SUCCESS'
      });
      assert.ok(ev1.id);
      assert.ok(ev1.sequence_num >= 1);
      assert.ok(ev1.event_hash);
      assert.ok(ev1.previous_event_hash);

      // 2. Sales Event
      const ev2 = await recordAuditEvent({
        event_type: 'PAYMENT_CAPTURED',
        actor_user_id: 'U_CASHIER',
        actor_role: 'CASHIER',
        venue_id: 'V_DEFAULT',
        target_entity_type: 'PAYMENT',
        target_entity_id: 'PAY-100',
        details: { amount_minor: 4500 }
      });
      assert.strictEqual(ev2.sequence_num, ev1.sequence_num + 1);
      assert.strictEqual(ev2.previous_event_hash, ev1.event_hash);

      // 3. KDS Event
      const ev3 = await recordAuditEvent({
        event_type: 'KDS_READY',
        actor_user_id: 'U_WAITER',
        actor_role: 'BARISTA',
        venue_id: 'V_DEFAULT',
        target_entity_type: 'KDS_LINE',
        target_entity_id: 'KDS-01'
      });
      assert.strictEqual(ev3.sequence_num, ev2.sequence_num + 1);
      assert.strictEqual(ev3.previous_event_hash, ev2.event_hash);

      // Verify chain
      const verification = await verifyAuditChainIntegrity('V_DEFAULT');
      assert.strictEqual(verification.isValid, true);
      assert.ok(verification.totalChecked >= 3);
    });

    it('should scrub sensitive secrets and PII from persisted details and hashes', async () => {
      const sensitiveEv = await recordAuditEvent({
        event_type: 'CREDENTIAL_CHANGED',
        actor_user_id: 'U_OWNER',
        venue_id: 'V_DEFAULT',
        details: {
          pin: '9876',
          password: 'SecretPassword123!',
          token: 'jwt.token.here',
          card_number: '4111222233334444',
          cvv: '999',
          safe_field: 'safe_info'
        }
      });

      const row = await getQuery(`SELECT details_json FROM v3_audit_ledger WHERE id = ?`, [sensitiveEv.id]);
      const details = JSON.parse(row.details_json);

      assert.strictEqual(details.pin, '[REDACTED_SECRET]');
      assert.strictEqual(details.password, '[REDACTED_SECRET]');
      assert.strictEqual(details.token, '[REDACTED_SECRET]');
      assert.strictEqual(details.card_number, '[REDACTED_SECRET]');
      assert.strictEqual(details.cvv, '[REDACTED_SECRET]');
      assert.strictEqual(details.safe_field, 'safe_info');
    });

    it('should detect tampering immediately if an audit record is altered', async () => {
      const latestRow = await getQuery(`SELECT sequence_num, event_type FROM v3_audit_ledger WHERE venue_id = 'V_DEFAULT' ORDER BY sequence_num DESC LIMIT 1`);
      const targetSeq = latestRow.sequence_num;
      const originalEventType = latestRow.event_type;

      // Manually mutate target row event_type in the database directly
      await runQuery(`UPDATE v3_audit_ledger SET event_type = 'TAMPERED_EVENT' WHERE sequence_num = ?`, [targetSeq]);

      const verification = await verifyAuditChainIntegrity('V_DEFAULT');
      assert.strictEqual(verification.isValid, false);
      assert.strictEqual(verification.brokenAtSeq, targetSeq);
      assert.match(verification.message, /تلاعب في محتوى السجل/);

      // Restore clean state for subsequent tests
      await runQuery(`UPDATE v3_audit_ledger SET event_type = ? WHERE sequence_num = ?`, [originalEventType, targetSeq]);

      const cleanVerification = await verifyAuditChainIntegrity('V_DEFAULT');
      assert.strictEqual(cleanVerification.isValid, true);
    });
  });

  describe('2. Role-Based Scoping, Export & Staff Activity Ledger', () => {
    it('should restrict Cashiers and Waiters to only their own audit events', async () => {
      const res = await request(app)
        .get('/api/audit/events')
        .set('Cookie', cashierCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      for (const log of res.body.logs) {
        assert.strictEqual(log.actor_user_id, 'U_CASHIER');
      }
    });

    it('should allow Owners and Managers to query venue-wide audit logs with filters', async () => {
      const res = await request(app)
        .get('/api/audit/events?event_type=LOGIN_SUCCESS')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.logs.length >= 1);
    });

    it('should export audit events with cryptographic integrity headers', async () => {
      const jsonExport = await request(app)
        .get('/api/audit/export?format=JSON')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.ok(jsonExport.headers['x-audit-tamper-verified']);
      assert.ok(jsonExport.body.metadata);
      assert.strictEqual(jsonExport.body.metadata.chain_verified, true);

      const csvExport = await request(app)
        .get('/api/audit/export?format=CSV')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(csvExport.headers['content-type'], 'text/csv; charset=utf-8');
      assert.match(csvExport.text, /Export Integrity Header/);
    });

    it('should calculate staff activity summary with statutory payroll isolation notice', async () => {
      const res = await request(app)
        .get('/api/audit/staff-summary?user_id=U_CASHIER')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.summary.operational_metrics);
      assert.match(res.body.summary.policy_notice, /تنبيه سياسة الأجور/);

      // Staff trying to view another staff member's metrics should receive 403 Forbidden
      await request(app)
        .get('/api/audit/staff-summary?user_id=U_CASHIER')
        .set('Cookie', waiterCookies)
        .expect(403);
    });
  });

  describe('3. Security Anomaly Detection & In-App Alert Triage', () => {
    it('should trigger FAILED_PIN_BURST alert on 3 consecutive failed PIN attempts', async () => {
      // Send 3 invalid PIN logins
      await request(app).post('/api/auth/login').send({ pin: '0000' }).expect(401);
      await request(app).post('/api/auth/login').send({ pin: '0000' }).expect(401);
      await request(app).post('/api/auth/login').send({ pin: '0000' }).expect(401);

      // Check triggered security alerts
      const alertsRes = await request(app)
        .get('/api/audit/alerts?alert_type=FAILED_PIN_BURST')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(alertsRes.body.success, true);
      assert.ok(alertsRes.body.alerts.length >= 1);
      const alert = alertsRes.body.alerts[0];
      assert.strictEqual(alert.severity, 'HIGH');
      assert.match(alert.title_ar, /محاولات دخول متكررة فاشلة/);
    });

    it('should deduplicate security alerts within the time window', async () => {
      // Trigger another failed attempt immediately
      await request(app).post('/api/auth/login').send({ pin: '0000' }).expect(401);

      const alertsRes = await request(app)
        .get('/api/audit/alerts?alert_type=FAILED_PIN_BURST')
        .set('Cookie', ownerCookies)
        .expect(200);

      // Only one alert row should exist for this time window bucket
      const burstAlerts = alertsRes.body.alerts.filter(a => a.alert_type === 'FAILED_PIN_BURST');
      assert.strictEqual(burstAlerts.length, 1);
    });

    it('should allow Manager/Owner to acknowledge and resolve security alerts', async () => {
      const alertsRes = await request(app)
        .get('/api/audit/alerts')
        .set('Cookie', ownerCookies)
        .expect(200);

      const alert = alertsRes.body.alerts[0];
      assert.ok(alert);

      // 1. Acknowledge
      const ackRes = await request(app)
        .post(`/api/audit/alerts/${alert.id}/acknowledge`)
        .set('Cookie', ownerCookies)
        .send({ note: 'تم التحقق من المشغل' })
        .expect(200);

      assert.strictEqual(ackRes.body.status, 'ACKNOWLEDGED');

      // 2. Resolve
      const resolveRes = await request(app)
        .post(`/api/audit/alerts/${alert.id}/resolve`)
        .set('Cookie', ownerCookies)
        .send({ note: 'تم قفل الحساب وإعادة ضبط الرمز السري' })
        .expect(200);

      assert.strictEqual(resolveRes.body.status, 'RESOLVED');
    });
  });

  describe('4. Multi-Channel Notification Dispatcher & External Failure Isolation', () => {
    it('should deliver in-app notifications to active managers and track read status', async () => {
      const notifsRes = await request(app)
        .get('/api/audit/notifications')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(notifsRes.body.success, true);
      assert.ok(notifsRes.body.notifications.length >= 1);
      const notif = notifsRes.body.notifications[0];

      // Mark notification as read
      const readRes = await request(app)
        .post(`/api/audit/notifications/${notif.id}/read`)
        .set('Cookie', ownerCookies)
        .send({})
        .expect(200);

      assert.strictEqual(readRes.body.success, true);
      assert.ok(readRes.body.read_at);
    });

    it('should handle external webhook failure non-critically without throwing or breaking core flow', async () => {
      // Configure failing webhook channel
      await updateChannelConfig({
        venue_id: 'V_DEFAULT',
        channel: 'WEBHOOK',
        is_enabled: 1,
        endpoint_url: 'https://example.com/fail_endpoint',
        auth_token: 'test_token'
      });

      // Create alert first so it is present in security alerts registry
      const alert = await triggerSecurityAlert({
        id: 'ALT-FAIL-TEST',
        alert_type: 'WEBHOOK_TEST',
        venue_id: 'V_DEFAULT',
        title_ar: 'تنبيه اختبار الفشل',
        description_ar: 'اختبار عزل فشل التوصيل الخارجي',
        severity: 'HIGH'
      });

      // Dispatch alert to failing webhook
      await dispatchAlertNotification(alert);

      // Fetch webhook notification status
      const extNotifs = await allQuery(
        `SELECT * FROM v3_system_notifications WHERE alert_id = ? AND channel = 'WEBHOOK'`,
        [alert.id]
      );

      assert.ok(extNotifs && extNotifs.length >= 1);
      const webhookNotif = extNotifs[0];
      assert.ok(webhookNotif.status === 'RETRYING' || webhookNotif.status === 'FAILED' || webhookNotif.status === 'QUEUED');
    });
  });
});
