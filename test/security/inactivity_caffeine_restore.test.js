/**
 * Inactivity Lock, Caffeine Mode & Activity Restoration Test Suite
 * Validates Prompt S4 requirements across idle timer thresholds, lock screen PIN security,
 * Caffeine Mode duration capping & manager step-up, and safe checkpoint restoration boundaries.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, '../../fixtures/gate-inactivity-caffeine.sqlite');
process.env.DB_PATH = TEST_DB;

const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { hashPin } = require('../../src/domain/auth/service');

describe('Inactivity Lock, Caffeine Mode & Activity Restoration Suite', function () {
  this.timeout(25000);
  let app;
  let cashierId, managerId, waiterId;
  const cashierPin = '4001', managerPin = '4002', waiterPin = '4003';
  let cashierToken, managerToken, waiterToken;

  before(async () => {
    // Reset isolated test fixture
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await runMigrations();
    app = createApp();

    // Seed venue and roles
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Caffeine Venue')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OP_MANAGER', 'V_DEFAULT', 'OP_MANAGER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`);

    cashierId = 'USR_CAF_CASHIER_' + Date.now();
    managerId = 'USR_CAF_MGR_' + Date.now();
    waiterId = 'USR_CAF_WAITER_' + Date.now();

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Counter Cashier', 'R_CASHIER', ?, 1)`,
      [cashierId, await hashPin(cashierPin)]
    );

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Floor Manager', 'R_OP_MANAGER', ?, 1)`,
      [managerId, await hashPin(managerPin)]
    );

    await runQuery(
      `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', 'Floor Waiter', 'R_WAITER', ?, 1)`,
      [waiterId, await hashPin(waiterPin)]
    );

    // Authenticate tokens
    const rCashier = await request(app).post('/api/auth/login').send({ pin: cashierPin }).expect(200);
    cashierToken = rCashier.body.token;

    const rManager = await request(app).post('/api/auth/login').send({ pin: managerPin }).expect(200);
    managerToken = rManager.body.token;

    const rWaiter = await request(app).post('/api/auth/login').send({ pin: waiterPin }).expect(200);
    waiterToken = rWaiter.body.token;
  });

  describe('1. Inactivity Lock & PIN Unlock Security', () => {
    it('unlocks screen with correct user PIN', async () => {
      const res = await request(app)
        .post('/api/auth/unlock')
        .set('x-session-token', cashierToken)
        .send({ pin: cashierPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.verified, true);
    });

    it('rejects unlock with incorrect PIN', async () => {
      const res = await request(app)
        .post('/api/auth/unlock')
        .set('x-session-token', cashierToken)
        .send({ pin: '9999' })
        .expect(401);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'INVALID_PIN');
    });

    it('locks account after 5 consecutive failed unlock attempts', async () => {
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/auth/unlock')
          .set('x-session-token', cashierToken)
          .send({ pin: '0000' })
          .expect(401);
      }

      // 5th attempt triggers lockout
      const lockRes = await request(app)
        .post('/api/auth/unlock')
        .set('x-session-token', cashierToken)
        .send({ pin: '0000' })
        .expect(401);

      assert.strictEqual(lockRes.body.code, 'ACCOUNT_LOCKED');
      assert.ok(lockRes.body.error.includes('15 دقيقة'));

      // Clean reset for remaining tests
      await runQuery(`UPDATE v3_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [cashierId]);
    });
  });

  describe('2. Caffeine Keep-Alive Mode Lifecycle & Step-Up Security', () => {
    it('enables Caffeine Mode with manager step-up PIN and caps duration at 60m', async () => {
      const res = await request(app)
        .post('/api/auth/caffeine')
        .set('x-session-token', waiterToken)
        .send({
          duration_minutes: 120, // requested 120m, must cap at 60m
          reason: 'RUSH_HOUR_LUNCH',
          manager_pin: managerPin
        })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.enabled, true);
      assert.strictEqual(res.body.duration_minutes, 60); // Capped at MAX 60
      assert.ok(res.body.expires_at);

      // Verify audit log
      const audit = await getQuery(
        `SELECT * FROM v3_audit_logs WHERE action = 'CAFFEINE_MODE_ENABLED' AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [waiterId]
      );
      assert.ok(audit);
    });

    it('rejects enabling Caffeine Mode when wrong manager PIN is supplied', async () => {
      const res = await request(app)
        .post('/api/auth/caffeine')
        .set('x-session-token', waiterToken)
        .send({
          duration_minutes: 30,
          manager_pin: '0000'
        })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('STEP_UP_FAILED'));
    });

    it('retrieves active Caffeine Mode status with remaining seconds', async () => {
      const res = await request(app)
        .get('/api/auth/caffeine')
        .set('x-session-token', waiterToken)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.enabled, true);
      assert.ok(res.body.remaining_seconds > 0);
    });

    it('disables Caffeine Mode cleanly', async () => {
      const res = await request(app)
        .delete('/api/auth/caffeine')
        .set('x-session-token', waiterToken)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.enabled, false);

      const check = await request(app)
        .get('/api/auth/caffeine')
        .set('x-session-token', waiterToken)
        .expect(200);
      assert.strictEqual(check.body.enabled, false);
    });
  });

  describe('3. Activity Checkpoint Restoration & Sensitive Screen Boundaries', () => {
    it('saves and retrieves a safe table order draft for the same user', async () => {
      const draftPayload = {
        table_number: 7,
        items: [{ id: 'ITEM-ESPRESSO', name: 'إسبريسو دبل', quantity: 2, price: 45 }]
      };

      // Save checkpoint
      const saveRes = await request(app)
        .post('/api/auth/checkpoint')
        .set('x-session-token', waiterToken)
        .send({
          route: '/pos.html',
          draft_type: 'ORDER_DRAFT',
          draft_payload: draftPayload
        })
        .expect(200);

      assert.strictEqual(saveRes.body.success, true);
      assert.strictEqual(saveRes.body.isSensitive, false);

      // Retrieve checkpoint
      const getRes = await request(app)
        .get('/api/auth/checkpoint')
        .set('x-session-token', waiterToken)
        .expect(200);

      assert.strictEqual(getRes.body.success, true);
      assert.strictEqual(getRes.body.data.allowed, true);
      assert.strictEqual(getRes.body.data.checkpoint.draft_type, 'ORDER_DRAFT');
      assert.strictEqual(getRes.body.data.checkpoint.draft_payload.table_number, 7);
    });

    it('flags sensitive actions (settle, payments, refunds, eod) and blocks automated restoration', async () => {
      const sensitiveDraft = {
        order_id: 'ORD-999',
        payment_method: 'CASH',
        cash_received: 500,
        change_owed: 50
      };

      // Save sensitive checkpoint
      const saveRes = await request(app)
        .post('/api/auth/checkpoint')
        .set('x-session-token', cashierToken)
        .send({
          route: '/settle.html',
          draft_type: 'PAYMENT_CHECKOUT',
          draft_payload: sensitiveDraft
        })
        .expect(200);

      assert.strictEqual(saveRes.body.success, true);
      assert.strictEqual(saveRes.body.isSensitive, true);

      // Attempt retrieval: Must be BLOCKED
      const getRes = await request(app)
        .get('/api/auth/checkpoint')
        .set('x-session-token', cashierToken)
        .expect(200);

      assert.strictEqual(getRes.body.success, true);
      assert.strictEqual(getRes.body.data.allowed, false);
      assert.ok(getRes.body.data.reason.includes('SENSITIVE_ACTION_BLOCKED'));
    });

    it('does not leak User A draft checkpoint to User B after switch', async () => {
      // Waiter has saved checkpoint, Manager requests checkpoint
      const res = await request(app)
        .get('/api/auth/checkpoint')
        .set('x-session-token', managerToken)
        .expect(200);

      // Manager has no checkpoint
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data, null);
    });

    it('clears checkpoint on explicit discard', async () => {
      const delRes = await request(app)
        .delete('/api/auth/checkpoint')
        .set('x-session-token', waiterToken)
        .expect(200);

      assert.strictEqual(delRes.body.success, true);

      const checkRes = await request(app)
        .get('/api/auth/checkpoint')
        .set('x-session-token', waiterToken)
        .expect(200);

      assert.strictEqual(checkRes.body.data, null);
    });
  });
});
