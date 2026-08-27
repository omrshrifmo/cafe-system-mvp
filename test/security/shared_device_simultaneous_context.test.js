/**
 * Shared Physical Device & Simultaneous Context Security Test Suite
 * Validates Prompt S3 requirements across Shared Terminal Mode, Multi-Seat Mode,
 * and Per-Tab Context Isolation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, '../../fixtures/gate-shared-context.sqlite');
process.env.DB_PATH = TEST_DB;

const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { hashPin } = require('../../src/domain/auth/service');

describe('Shared Physical Device & Simultaneous User Context Suite', function () {
  this.timeout(25000);
  let app;
  let cashierId, managerId, waiterId;
  const cashierPin = '3001', managerPin = '3002', waiterPin = '3003';

  before(async () => {
    // Reset isolated test fixture
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await runMigrations();
    app = createApp();

    // Seed venue and roles
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES ('V_DEFAULT', 'Shared Device Venue')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_OP_MANAGER', 'V_DEFAULT', 'OP_MANAGER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);
    await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_WAITER', 'V_DEFAULT', 'WAITER')`);

    cashierId = 'USR_SH_CASHIER_' + Date.now();
    managerId = 'USR_SH_MGR_' + Date.now();
    waiterId = 'USR_SH_WAITER_' + Date.now();

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
  });

  describe('1. Shared Terminal Mode (Sequential User Switching on Single Profile)', () => {
    let sessionCookieA = null;

    it('Cashier logs in on Counter POS and obtains secure session', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'COUNTER-POS-01')
        .send({ pin: cashierPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.id, cashierId);
      sessionCookieA = res.headers['set-cookie'].find(c => c.startsWith('session_token='));
      assert.ok(sessionCookieA);
    });

    it('Cashier logs out, destroying the server session completely', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', sessionCookieA)
        .send({})
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify that session A is completely dead
      await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookieA)
        .expect(401);
    });

    it('Manager logs in sequentially on the same terminal without inheriting Cashier state', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'COUNTER-POS-01')
        .send({ pin: managerPin })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.id, managerId);
      assert.strictEqual(res.body.user.role, 'OP_MANAGER');

      const sessionCookieB = res.headers['set-cookie'].find(c => c.startsWith('session_token='));
      assert.notStrictEqual(sessionCookieB, sessionCookieA);

      // Clean logout
      await request(app).post('/api/auth/logout').set('Cookie', sessionCookieB).send({}).expect(200);
    });
  });

  describe('2. Multi-Seat Device Mode (Isolated Hardware Containers on One Machine)', () => {
    let seat1Token = null;
    let seat2Token = null;

    it('Seat 1 (Cashier Counter) and Seat 2 (Manager Office) authenticate independently', async () => {
      const resSeat1 = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'TERMINAL-PC-01')
        .set('x-seat-id', 'SEAT-COUNTER-01')
        .send({ pin: cashierPin })
        .expect(200);
      seat1Token = resSeat1.body.token;

      const resSeat2 = await request(app)
        .post('/api/auth/login')
        .set('x-device-id', 'TERMINAL-PC-01')
        .set('x-seat-id', 'SEAT-OFFICE-02')
        .send({ pin: managerPin })
        .expect(200);
      seat2Token = resSeat2.body.token;

      assert.notStrictEqual(seat1Token, seat2Token);
    });

    it('both seats operate concurrently without cross-seat data leakage', async () => {
      const me1 = await request(app).get('/api/auth/me').set('x-session-token', seat1Token).expect(200);
      const me2 = await request(app).get('/api/auth/me').set('x-session-token', seat2Token).expect(200);

      assert.strictEqual(me1.body.user.id, cashierId);
      assert.strictEqual(me1.body.user.role, 'OP_ASSISTANT_CASHIER');

      assert.strictEqual(me2.body.user.id, managerId);
      assert.strictEqual(me2.body.user.role, 'OP_MANAGER');
    });

    it('logging out Seat 1 does not affect Seat 2', async () => {
      await request(app).post('/api/auth/logout').set('x-session-token', seat1Token).send({}).expect(200);

      // Seat 1 is revoked
      await request(app).get('/api/auth/me').set('x-session-token', seat1Token).expect(401);

      // Seat 2 remains fully active
      const me2 = await request(app).get('/api/auth/me').set('x-session-token', seat2Token).expect(200);
      assert.strictEqual(me2.body.user.id, managerId);
    });
  });

  describe('3. Per-Tab Context Mode (Split-Screen / Multi-Tab Session Isolation)', () => {
    let tab1Token, tab2Token;

    it('Tab 1 (Waiter) and Tab 2 (Manager) operate under distinct ephemeral context IDs', async () => {
      const resTab1 = await request(app)
        .post('/api/auth/login')
        .set('x-context-id', 'CTX-TAB-WAITER-01')
        .send({ pin: waiterPin })
        .expect(200);
      tab1Token = resTab1.body.token;

      const resTab2 = await request(app)
        .post('/api/auth/login')
        .set('x-context-id', 'CTX-TAB-MGR-02')
        .send({ pin: managerPin })
        .expect(200);
      tab2Token = resTab2.body.token;

      assert.notStrictEqual(tab1Token, tab2Token);

      // Tab 1 request
      const me1 = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', tab1Token)
        .set('x-context-id', 'CTX-TAB-WAITER-01')
        .expect(200);
      assert.strictEqual(me1.body.user.role, 'WAITER');

      // Tab 2 request
      const me2 = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', tab2Token)
        .set('x-context-id', 'CTX-TAB-MGR-02')
        .expect(200);
      assert.strictEqual(me2.body.user.role, 'OP_MANAGER');
    });

    it('simultaneous requests from both tabs maintain clean individual identity attribution', async () => {
      const [r1, r2] = await Promise.all([
        request(app).get('/api/auth/me').set('x-session-token', tab1Token),
        request(app).get('/api/auth/me').set('x-session-token', tab2Token)
      ]);

      assert.strictEqual(r1.body.user.id, waiterId);
      assert.strictEqual(r2.body.user.id, managerId);
    });
  });

  describe('4. Stale Tab, Replay & Back-Button Protection', () => {
    it('stale request after session revocation fails immediately with 401', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ pin: cashierPin }).expect(200);
      const token = loginRes.body.token;

      // Revoke session
      await request(app).post('/api/auth/logout').set('x-session-token', token).send({}).expect(200);

      // Replay request with stale token (simulating browser back button or stale tab)
      const staleRes = await request(app)
        .get('/api/auth/me')
        .set('x-session-token', token)
        .expect(401);

      assert.strictEqual(staleRes.body.success, false);
      assert.strictEqual(staleRes.body.code, 'AUTH_REQUIRED');
    });
  });

  describe('5. Offline Command Queue Actor Partitioning', () => {
    it('rejects unsafe offline payment mutations regardless of context', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({ pin: waiterPin }).expect(200);
      const token = loginRes.body.token;

      const syncPayload = {
        device_id: 'TABLET-FLOOR-01',
        commands: [
          { client_command_id: 'CMD-OFF-01', action: 'SETTLE_PAYMENT', payload: { amount: 100 } }
        ]
      };

      const res = await request(app)
        .post('/api/sync/batch')
        .set('x-session-token', token)
        .send(syncPayload)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.results[0].status, 'REJECTED');
      assert.ok(res.body.results[0].error.includes('UNSAFE_OFFLINE_ACTION'));
    });
  });
});
