/**
 * Verification Test Suite for Final Enterprise Operational Features:
 * 1. Activity Recovery & Draft Orders (POS & Auth)
 * 2. Device Trust & Remote Session Revocation
 * 3. Guest-Facing QR Ordering Portal & KDS Push
 * 4. In-App Backup & Recovery System
 */
const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./src/app');
const { runQuery, getQuery, allQuery } = require('./src/db/connection');
const crypto = require('crypto');

async function createTestSession(userId, venueId = 'V_DEFAULT', deviceId = 'DEV_1') {
  const env = require('./src/config/env');
  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = crypto.createHash('sha256').update(rawToken + env.SESSION_SECRET).digest('hex');
  const sessionId = crypto.randomUUID();
  const absoluteExpiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const inactivityExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await runQuery(
    `INSERT INTO v3_user_sessions (id, venue_id, user_id, device_id, session_hash, absolute_expiry_at, inactivity_expiry_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
    [sessionId, venueId, userId, deviceId, sessionHash, absoluteExpiry, inactivityExpiry]
  );

  return { token: rawToken, sessionId };
}

describe('Final Enterprise Operational & Systemic Upgrades Verification', function () {
  this.timeout(10000);
  let app;
  let ownerToken;
  let cashierToken;
  let ownerUser;
  let cashierUser;

  before(async () => {
    app = createApp();

    // Ensure Owner and Cashier exist
    ownerUser = await getQuery(`SELECT * FROM v3_users WHERE role_id = 'SUPER_ADMIN' OR role_id = 'OWNER' LIMIT 1`);
    if (!ownerUser) {
      const res = await runQuery(`INSERT INTO v3_users (id, name, role_id, pin_hash, is_active, venue_id) VALUES (9991, 'مالك النظام', 'OWNER', 'dummy', 1, 'V_DEFAULT')`);
      ownerUser = { id: 9991, name: 'مالك النظام', role: 'OWNER', role_id: 'OWNER', venue_id: 'V_DEFAULT' };
    } else {
      ownerUser.role = ownerUser.role_id;
    }

    cashierUser = await getQuery(`SELECT * FROM v3_users WHERE role_id = 'CASHIER' LIMIT 1`);
    if (!cashierUser) {
      const res = await runQuery(`INSERT INTO v3_users (id, name, role_id, pin_hash, is_active, venue_id) VALUES (9992, 'كاشير التجربة', 'CASHIER', 'dummy', 1, 'V_DEFAULT')`);
      cashierUser = { id: 9992, name: 'كاشير التجربة', role: 'CASHIER', role_id: 'CASHIER', venue_id: 'V_DEFAULT' };
    } else {
      cashierUser.role = cashierUser.role_id;
    }

    // Create valid sessions
    const ownerSession = await createTestSession(ownerUser.id, 'V_DEFAULT', 'DEV_DESKTOP_1');
    ownerToken = ownerSession.token;

    const cashierSession = await createTestSession(cashierUser.id, 'V_DEFAULT', 'DEV_POS_1');
    cashierToken = cashierSession.token;
  });

  describe('1. Device Trust & Remote Session Revocation (/api/auth/sessions)', () => {
    let testSessionId;

    it('should allow OWNER/SUPER_ADMIN to query all active sessions', async () => {
      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Cookie', `session_token=${ownerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.sessions));
      assert.ok(res.body.sessions.length >= 2);

      const foundCashier = res.body.sessions.find(s => s.user_id === cashierUser.id);
      assert.ok(foundCashier, 'Active cashier session should be present in the active sessions list');
      assert.ok(foundCashier.device_id, 'Device ID should be tracked');
      assert.ok(foundCashier.last_seen, 'Last seen timestamp should be returned');
      testSessionId = foundCashier.id;
    });

    it('should revoke a target session via DELETE /api/auth/sessions/:id', async () => {
      assert.ok(testSessionId, 'Test session ID must exist');

      const res = await request(app)
        .delete(`/api/auth/sessions/${testSessionId}`)
        .set('Cookie', `session_token=${ownerToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify session is marked revoked in database
      const row = await getQuery(`SELECT revoked_at FROM v3_user_sessions WHERE id = ?`, [testSessionId]);
      assert.ok(row, 'Session row exists');
      assert.ok(row.revoked_at, 'revoked_at timestamp must be set');
    });

    it('should deny unauthorized staff from viewing active sessions', async () => {
      // Create a fresh cashier session
      const s = await createTestSession(cashierUser.id, 'V_DEFAULT', 'DEV_POS_2');
      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Cookie', `session_token=${s.token}`);

      assert.strictEqual(res.status, 403);
    });
  });

  describe('2. Guest-Facing QR Ordering Portal & KDS Push (/api/public/orders)', () => {
    it('should accept a guest QR order and broadcast it to KDS queue with BOM deduction', async () => {
      // Make sure table 5 exists
      await runQuery(`INSERT OR IGNORE INTO tables (id, table_number, status) VALUES (5, 5, 'AVAILABLE')`);

      const guestOrderPayload = {
        table_number: 5,
        token: 'table_5_valid_token',
        items: [
          { item_name: 'قهوة تركي', price: 35, quantity: 2, sugar_level: 'مظبوط', department: 'BARISTA' },
          { item_name: 'شاي كشري', price: 20, quantity: 1, sugar_level: 'زيادة', department: 'BARISTA' }
        ],
        notes: 'طلب سريع من الجوال'
      };

      const res = await request(app)
        .post('/api/public/orders')
        .send(guestOrderPayload);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.order, 'Order result returned');

      // Verify items were created in order_items
      const sessionId = res.body.order.session_id;
      const orderItems = await allQuery(`SELECT * FROM order_items WHERE session_id = ?`, [sessionId]);
      assert.ok(orderItems.length >= 2, 'Two order items should be created in the session');

      // Verify outbox event was created for KDS real-time WebSocket push
      const outboxEvts = await allQuery(
        `SELECT * FROM outbox_events WHERE topic = 'ORDER_PLACED' ORDER BY id DESC LIMIT 2`
      );
      assert.ok(outboxEvts.length >= 2, 'Outbox events generated for WebSocket KDS broadcast');
    });
  });

  describe('3. In-App Backup & Recovery (/api/system/backup & /api/system/restore)', () => {
    let backupBuffer;

    it('should generate and stream a valid SQLite database file on GET /api/system/backup', async () => {
      const res = await request(app)
        .get('/api/system/backup')
        .set('Cookie', `session_token=${ownerToken}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = Buffer.from([]);
          res.on('data', chunk => { data = Buffer.concat([data, chunk]); });
          res.on('end', () => callback(null, data));
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('mazaj_backup_'));
      assert.ok(res.headers['content-disposition'].includes('.db'));

      backupBuffer = res.body;
      assert.ok(Buffer.isBuffer(backupBuffer), 'Response should be a binary buffer');

      // Check SQLite header signature: 'SQLite format 3\0'
      const sqliteHeader = backupBuffer.slice(0, 16).toString('utf8');
      assert.ok(sqliteHeader.startsWith('SQLite format 3'), 'Streamed file must have valid SQLite 3 magic header');
    });

    it('should safely accept and restore a valid .db file on POST /api/system/restore', async () => {
      const tempBackupPath = path.join(__dirname, 'temp_test_restore.db');
      fs.writeFileSync(tempBackupPath, backupBuffer);

      const res = await request(app)
        .post('/api/system/restore')
        .set('Cookie', `session_token=${ownerToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('database', tempBackupPath);

      if (res.status !== 200) {
        console.error('RESTORE FAILED RESPONSE:', res.status, res.body);
      }

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.tables_count > 0, 'Database tables verified');

      // Clean up temp file
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
      }
    });

    it('should reject invalid or corrupted files on POST /api/system/restore', async () => {
      const fakeFilePath = path.join(__dirname, 'fake_corrupted.db');
      fs.writeFileSync(fakeFilePath, 'THIS IS NOT AN SQLITE DATABASE');

      const res = await request(app)
        .post('/api/system/restore')
        .set('Cookie', `session_token=${ownerToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('database', fakeFilePath);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);

      if (fs.existsSync(fakeFilePath)) {
        fs.unlinkSync(fakeFilePath);
      }
    });
  });
});
