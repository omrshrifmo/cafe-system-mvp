const assert = require('assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../../src/app');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const {
  openShift,
  recordShiftHandover,
  recordBlindCount,
  calculateExpectedCash,
  closeShift,
  reopenShift,
  getActiveShift,
  getShiftById
} = require('../../src/domain/shifts/shiftService');
const { recordCashOperation } = require('../../src/domain/shifts/cashService');
const { lockAccountingPeriod } = require('../../src/domain/shifts/periodService');

describe('Server-Bound Shifts, Cash Reconciliation & Period Management Gate Suite', function () {
  this.timeout(120000);

  let app;
  let cashierToken;
  let ownerToken;
  let testDate = '2026-08-24';
  let morningShiftId;
  let nightShiftId;

  before(async () => {
    app = createApp();

    // 0. Seed Canonical Roles
    const canonicalRoles = ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'BARISTA', 'WAITER', 'RUNNER'];
    for (const r of canonicalRoles) {
      await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [`R_${r}`, r]);
    }

    const upsertUser = async (id, name, roleId, pin) => {
      const pinHash = await bcrypt.hash(pin, 4);
      await runQuery(
        `INSERT OR IGNORE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, 1, 0)`,
        [id, name, roleId, pinHash]
      );
      await runQuery(
        `UPDATE v3_users SET is_active = 1, failed_attempts = 0, pin_hash = ?, role_id = ? WHERE id = ?`,
        [pinHash, roleId, id]
      );
    };

    await upsertUser('301', 'كاشير الصباح', 'R_OP_ASSISTANT_CASHIER', '6601');
    await upsertUser('302', 'مالك الكافيه', 'R_OWNER', '6602');

    const cRes = await request(app).post('/api/auth/login').send({ pin: '6601' });
    cashierToken = cRes.body.token;

    const oRes = await request(app).post('/api/auth/login').send({ pin: '6602' });
    ownerToken = oRes.body.token;

    // Clean up test shifts for this test date in proper FK order
    await runQuery(`DELETE FROM cash_operations WHERE shift_id IN (SELECT id FROM v3_shifts WHERE business_date = ?)`, [testDate]);
    await runQuery(`DELETE FROM shift_handovers WHERE shift_id IN (SELECT id FROM v3_shifts WHERE business_date = ?)`, [testDate]);
    await runQuery(`DELETE FROM v3_shifts WHERE business_date = ?`, [testDate]);
    await runQuery(`DELETE FROM accounting_periods WHERE period_date = ?`, [testDate]);
  });

  describe('1. Shift Opening & Distinct Shift Types (Morning & Night)', () => {
    it('should open a MORNING shift with opening float and metadata', async () => {
      const res = await request(app)
        .post('/api/shifts/open')
        .set('Cookie', `session_token=${cashierToken}`)
        .send({
          shift_type: 'MORNING',
          business_date: testDate,
          timezone: 'Africa/Cairo',
          opening_float_minor: 50000 // 500.00 EGP
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.shift_type, 'MORNING');
      assert.strictEqual(res.body.opening_float_minor, 50000);
      morningShiftId = res.body.shift_id;
      assert.ok(morningShiftId);
    });

    it('should reject opening a duplicate MORNING shift on the same date', async () => {
      const res = await request(app)
        .post('/api/shifts/open')
        .set('Cookie', `session_token=${cashierToken}`)
        .send({
          shift_type: 'MORNING',
          business_date: testDate,
          opening_float_minor: 50000
        });

      assert.strictEqual(res.status, 409);
    });

    it('should allow opening a separate NIGHT shift on the same business date', async () => {
      // Use helper for NIGHT shift
      const res = await openShift('V_DEFAULT', 'NIGHT', testDate, 'Africa/Cairo', 60000, '301');
      assert.strictEqual(res.status, 'SUCCESS');
      assert.strictEqual(res.shift_type, 'NIGHT');
      nightShiftId = res.shift_id;
      assert.ok(nightShiftId);
    });
  });

  describe('2. Handover Snapshots', () => {
    it('should capture a floor handover snapshot and move status to HANDOVER_PENDING', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/handover`)
        .set('Cookie', `session_token=${cashierToken}`)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.shift_id, morningShiftId);
      assert.ok(res.body.snapshot);
      assert.strictEqual(res.body.snapshot.shift_type, 'MORNING');

      // Verify DB status
      const shift = await getQuery(`SELECT status FROM v3_shifts WHERE id = ?`, [morningShiftId]);
      assert.strictEqual(shift.status, 'HANDOVER_PENDING');
    });
  });

  describe('3. Cash Operations & Authoritative Cash Reconciliation Formula', () => {
    it('should record cash transactions and verify canonical expected cash formula', async () => {
      // 1. Record an Expense of 50.00 EGP (5000 minor)
      const expRes = await request(app)
        .post('/api/shifts/operations/cash')
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          shift_id: morningShiftId,
          type: 'EXPENSE',
          amount_minor: 5000,
          reason: 'شراء نعناع وليمون طازج',
          approval_actor_id: '302'
        });
      assert.strictEqual(expRes.status, 200);
      assert.strictEqual(expRes.body.success, true);

      // 2. Record an Employee Advance of 100.00 EGP (10000 minor)
      const advRes = await request(app)
        .post('/api/shifts/operations/cash')
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          shift_id: morningShiftId,
          type: 'ADVANCE',
          amount_minor: 10000,
          reason: 'سلفة موظف تحت الحساب',
          approval_actor_id: '302'
        });
      assert.strictEqual(advRes.status, 200);

      // 3. Record an Adjustment of +20.00 EGP (+2000 minor)
      const adjRes = await request(app)
        .post('/api/shifts/operations/cash')
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          shift_id: morningShiftId,
          type: 'ADJUSTMENT',
          amount_minor: 2000,
          reason: 'تسوية نقدية مصرحة'
        });
      assert.strictEqual(adjRes.status, 200);

      // 4. Insert completed Cash payment of 300.00 EGP (30000 minor) + 10.00 EGP tip (1000 minor)
      await runQuery(
        `INSERT OR IGNORE INTO v3_order_sessions (id, branch_id, created_by, status)
         VALUES ('SESS_TEST', (SELECT id FROM branches LIMIT 1), '301', 'PAID')`
      );

      const paymentId = `PAY-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_payments (id, order_session_id, payment_method, amount_minor, tip_minor, status, created_by, created_at)
         VALUES (?, 'SESS_TEST', 'CASH', 30000, 1000, 'COMPLETED', '301', datetime('now', 'localtime'))`,
        [paymentId]
      );

      // 5. Insert refund of 30.00 EGP (3000 minor) on a cash payment
      const reversalId = `REV-${Date.now()}`;
      await runQuery(
        `INSERT INTO reversals (id, venue_id, order_session_id, payment_id, type, amount_minor, reason, actor_id, approval_actor_id, created_at)
         VALUES (?, 'V_DEFAULT', 'SESS_TEST', ?, 'REFUND_FULL', 3000, 'إرجاع صنف تالف', '301', '302', datetime('now', 'localtime'))`,
        [reversalId, paymentId]
      );

      // Calculate Expected Cash:
      // Opening Float: 50000
      // + Cash Sales: 30000
      // + Cash Tips: 1000
      // - Expenses: 5000
      // - Advances: 10000
      // - Withdrawals: 0
      // + Adjustments: 2000
      // - Refunds: 3000
      // = Expected: 50000 + 30000 + 1000 - 5000 - 10000 + 2000 - 3000 = 65000 minor (650.00 EGP)
      const { runTransaction } = require('../../src/db/transaction');
      const recon = await runTransaction(async (tx) => {
        return calculateExpectedCash(tx, morningShiftId);
      });

      assert.strictEqual(recon.opening_float_minor, 50000);
      assert.strictEqual(recon.posted_cash_sales_minor, 30000);
      assert.strictEqual(recon.retained_cash_tips_minor, 1000);
      assert.strictEqual(recon.approved_expenses_minor, 5000);
      assert.strictEqual(recon.approved_advances_minor, 10000);
      assert.strictEqual(recon.approved_adjustments_minor, 2000);
      assert.strictEqual(recon.cash_refunds_minor, 3000);
      assert.strictEqual(recon.expected_cash_minor, 65000);
    });
  });

  describe('4. Cashier Blind Count & Owner Variance Masking', () => {
    it('Cashier enters blind count (64000 minor - 10 EGP deficit) with NO variance exposed', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/count`)
        .set('Cookie', `session_token=${cashierToken}`)
        .send({
          counted_amount_minor: 64000
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.counted_cash_minor, 64000);

      // Verify Cashier querying shift details sees NO expected cash or variance
      const getRes = await request(app)
        .get(`/api/shifts/${morningShiftId}`)
        .set('Cookie', `session_token=${cashierToken}`);

      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.shift.expected_cash_minor, null);
      assert.strictEqual(getRes.body.shift.variance_minor, null);
    });
  });

  describe('5. Shift Close, Z-Report Spooling & Reopen Policy', () => {
    it('should reject closing shift if expected_version does not match', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/close`)
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          expected_version: 999 // Stale version
        });

      assert.strictEqual(res.status, 409);
    });

    it('Owner closes shift, receives full variance, and spools Z-Report', async () => {
      const shiftBefore = await getQuery(`SELECT version FROM v3_shifts WHERE id = ?`, [morningShiftId]);

      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/close`)
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          expected_version: shiftBefore.version
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.shift_status, 'CLOSED');
      assert.strictEqual(res.body.expected_cash_minor, 65000);
      assert.strictEqual(res.body.counted_cash_minor, 64000);
      assert.strictEqual(res.body.variance_minor, -1000); // 10 EGP deficit
      assert.ok(res.body.z_report_job_id, 'Z-Report print job spooled');

      // Verify Z-Report job in database
      const job = await getQuery(`SELECT * FROM printer_jobs WHERE id = ?`, [res.body.z_report_job_id]);
      assert.ok(job);
      assert.strictEqual(job.target_printer_id, 'PRN-MANAGER');
      assert.strictEqual(job.status, 'PENDING');
    });

    it('should reject closing already closed shift (Duplicate Close Rejection)', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/close`)
        .set('Cookie', `session_token=${ownerToken}`)
        .send({});

      assert.strictEqual(res.status, 409);
    });

    it('Cashier cannot reopen closed shift (Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/reopen`)
        .set('Cookie', `session_token=${cashierToken}`)
        .send({ reason: 'نسيت تسجيل مصروف' });

      assert.strictEqual(res.status, 403);
    });

    it('Owner can reopen closed shift with authorized audit reason', async () => {
      const res = await request(app)
        .post(`/api/shifts/${morningShiftId}/reopen`)
        .set('Cookie', `session_token=${ownerToken}`)
        .send({ reason: 'إعادة فتح لمراجعة فاتورة إرجاع' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.shift_status, 'REOPENED_BY_APPROVAL');
    });
  });

  describe('6. Accounting Period Locking', () => {
    it('should lock daily accounting period and block further cash modifications', async () => {
      const lockRes = await request(app)
        .post('/api/shifts/periods/lock')
        .set('Cookie', `session_token=${ownerToken}`)
        .send({
          period_date: testDate,
          period_type: 'DAILY'
        });

      assert.strictEqual(lockRes.status, 200);
      assert.strictEqual(lockRes.body.period_status, 'LOCKED');

      // Attempting to record cash operation on locked period is rejected
      await assert.rejects(
        async () => {
          await recordCashOperation('V_DEFAULT', morningShiftId, 'EXPENSE', 1000, 'Test', '302', '302');
        },
        /PERIOD_LOCKED/
      );
    });
  });
});
