const request = require('supertest');
const assert = require('assert');

function expect(val) {
  return {
    to: {
      equal: (expected) => assert.strictEqual(val, expected),
      deep: { equal: (expected) => assert.deepStrictEqual(val, expected) },
      get be() {
        return {
          get true() { assert.strictEqual(val, true); },
          get false() { assert.strictEqual(val, false); },
          get null() { assert.strictEqual(val, null); },
          an: (type) => {
            if (type === 'array') assert.ok(Array.isArray(val), `Expected array, got ${typeof val}`);
            else assert.strictEqual(typeof val, type);
          },
          a: (type) => {
            if (type === 'array') assert.ok(Array.isArray(val), `Expected array, got ${typeof val}`);
            else assert.strictEqual(typeof val, type);
          },
          at: {
            least: (min) => assert.ok(val >= min, `Expected ${val} >= ${min}`)
          }
        };
      },
      include: (str) => assert.ok(String(val).includes(str), `Expected ${val} to include ${str}`),
      get exist() { assert.ok(val !== null && val !== undefined, `Expected value to exist`); }
    }
  };
}
expect.fail = (msg) => assert.fail(msg);
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { runQuery, getQuery, allQuery } = require('../../src/db/connection');
const {
  calculatePayrollPeriod,
  reviewPayrollPeriod,
  approvePayrollPeriod,
  lockPayrollPeriod,
  recordPayrollPayment,
  getPayrollPeriodDetails,
  getPayslips
} = require('../../src/domain/hr/payrollService');
const {
  clockIn,
  clockOut,
  approveAttendance,
  rejectAttendance,
  getAttendanceList
} = require('../../src/domain/hr/attendanceService');
const {
  upsertStaffProfile,
  recordEffectiveRate,
  getStaffRoster,
  recordAdjustment,
  createTipPool,
  approveTipPool
} = require('../../src/domain/hr/adjustmentService');
const {
  createComplaint,
  updateComplaint,
  resolveComplaint,
  getComplaints,
  maskPhone,
  maskName
} = require('../../src/domain/qa/qualityService');
const crypto = require('crypto');
const env = require('../../src/config/env');
const { generateProfitAndLoss } = require('../../src/domain/reports/pnlReportService');

async function createTestSession(userId, venueId = 'V_HR_TEST') {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = crypto.createHash('sha256').update(rawToken + env.SESSION_SECRET).digest('hex');
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const absoluteExpiry = new Date(now + 24 * 3600 * 1000).toISOString();
  const inactivityExpiry = new Date(now + 15 * 60 * 1000).toISOString();

  await runQuery(
    `INSERT INTO v3_user_sessions (id, user_id, venue_id, device_id, session_hash, absolute_expiry_at, inactivity_expiry_at)
     VALUES (?, ?, ?, 'DEV_TEST', ?, ?, ?)`,
    [sessionId, userId, venueId, sessionHash, absoluteExpiry, inactivityExpiry]
  );
  return rawToken;
}

describe('Security & Integrity Gate: HR, Payroll & Quality Contracts', function () {
  this.timeout(20000);
  let app;
  let managerToken;
  let employeeToken;
  let testVenueId = 'V_HR_TEST';
  let employee1Id = 'u_emp_1';
  let employee2Id = 'u_emp_2';
  let managerId = 'u_mgr_1';

  before(async () => {
    await runMigrations();
    app = createApp();

    // Ensure venue exists
    await runQuery(`INSERT OR IGNORE INTO venues (id, name) VALUES (?, 'Test Venue')`, [testVenueId]);

    // Clean up test data
    await runQuery(`DELETE FROM hr_staff_profiles WHERE venue_id = ?`, [testVenueId]);
    await runQuery(`DELETE FROM hr_rate_history WHERE user_id IN (?, ?, ?)`, [employee1Id, employee2Id, managerId]);
    await runQuery(`DELETE FROM hr_attendance WHERE venue_id = ?`, [testVenueId]);
    await runQuery(`DELETE FROM hr_adjustments WHERE user_id IN (?, ?, ?)`, [employee1Id, employee2Id, managerId]);
    await runQuery(`DELETE FROM tip_pools WHERE venue_id = ?`, [testVenueId]);
    await runQuery(`DELETE FROM payroll_periods WHERE venue_id = ?`, [testVenueId]);
    await runQuery(`DELETE FROM quality_complaints WHERE venue_id = ?`, [testVenueId]);
    await runQuery(`DELETE FROM v3_user_sessions WHERE user_id IN (?, ?, ?)`, [employee1Id, employee2Id, managerId]);
    await runQuery(`DELETE FROM v3_users WHERE venue_id = ?`, [testVenueId]);

    // Seed test users in v3_users
    await runQuery(`
      INSERT INTO v3_users (id, venue_id, name, pin_hash, role_id, is_active)
      VALUES 
        (?, ?, 'مدير الفرع', 'hash_mgr', 'R_MANAGER', 1),
        (?, ?, 'أحمد باريستا', 'hash_emp1', 'R_BARISTA', 1),
        (?, ?, 'محمود ويتر', 'hash_emp2', 'R_WAITER', 1)
    `, [managerId, testVenueId, employee1Id, testVenueId, employee2Id, testVenueId]);

    // Seed Staff Profiles
    await upsertStaffProfile(managerId, { role: 'MANAGER', venueId: testVenueId });
    await upsertStaffProfile(employee1Id, { role: 'BARISTA', venueId: testVenueId });
    await upsertStaffProfile(employee2Id, { role: 'WAITER', venueId: testVenueId });

    // Create test session tokens
    managerToken = await createTestSession(managerId, testVenueId);
    employeeToken = await createTestSession(employee1Id, testVenueId);
  });

  describe('1. Effective Rates & Staff Profiles', () => {
    it('should record effective hourly rates and close previous rates', async () => {
      await recordEffectiveRate(employee1Id, 5000, 1.5, '2026-07-01'); // 50.00 EGP/hr
      await recordEffectiveRate(employee2Id, 4000, 1.5, '2026-07-01'); // 40.00 EGP/hr

      // Update employee1 rate effective from August
      await recordEffectiveRate(employee1Id, 6000, 1.5, '2026-08-01'); // 60.00 EGP/hr

      const rates = await allQuery(
        `SELECT * FROM hr_rate_history WHERE user_id = ? ORDER BY effective_from ASC`,
        [employee1Id]
      );

      expect(rates.length).to.equal(2);
      expect(rates[0].effective_to).to.equal('2026-08-01');
      expect(rates[0].hourly_rate_minor).to.equal(5000);
      expect(rates[1].hourly_rate_minor).to.equal(6000);
      expect(rates[1].effective_to).to.be.null;
    });

    it('should reject invalid rates (negative rate or multiplier < 1.0)', async () => {
      try {
        await recordEffectiveRate(employee1Id, -500, 1.5);
        expect.fail('Should have rejected negative rate');
      } catch (err) {
        expect(err.message).to.include('الأجر الساعاتي لا يمكن أن يكون سالباً');
      }

      try {
        await recordEffectiveRate(employee1Id, 5000, 0.8);
        expect.fail('Should have rejected multiplier < 1.0');
      } catch (err) {
        expect(err.message).to.include('معامل الوقت الإضافي يجب أن يكون 1.0 أو أكثر');
      }
    });
  });

  describe('2. Attendance Validation & Approvals', () => {
    let attSession1Id;
    let attSession2Id;

    it('should reject clocking in with a future date', async () => {
      const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      try {
        await clockIn(employee1Id, testVenueId, null, futureTime);
        expect.fail('Should have rejected future clock-in');
      } catch (err) {
        expect(err.message).to.include('لا يمكن تسجيل الحضور في تاريخ أو وقت مستقبلي');
      }
    });

    it('should allow valid clock-in and reject overlapping active clock-in', async () => {
      const res = await clockIn(employee1Id, testVenueId, null, '2026-08-10T09:00:00Z');
      expect(res.status).to.equal('SUCCESS');
      attSession1Id = res.attendance_id;

      try {
        await clockIn(employee1Id, testVenueId, null, '2026-08-10T10:00:00Z');
        expect.fail('Should have rejected overlapping clock-in');
      } catch (err) {
        expect(err.message).to.include('الموظف مسجل حضور بالفعل ومستمر بالعمل');
      }
    });

    it('should record clock-out with break deductions and compute duration', async () => {
      // Clock out after 9 hours with 60 min break = 8 productive hours (480 mins)
      const res = await clockOut(employee1Id, attSession1Id, '2026-08-10T18:00:00Z', 60);
      expect(res.status).to.equal('SUCCESS');
      expect(res.total_minutes).to.equal(480);
    });

    it('should allow manager approval of productive minutes', async () => {
      const res = await approveAttendance(attSession1Id, managerId, 480, 'Approved 8 hours standard shift');
      expect(res.status).to.equal('SUCCESS');

      const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ?`, [attSession1Id]);
      expect(session.status).to.equal('APPROVED');
      expect(session.approved_productive_minutes).to.equal(480);
      expect(session.approved_by).to.equal(managerId);
    });

    it('should seed additional attendance for full period test', async () => {
      // Seed employee1 with 5 sessions of 8 hours = 40 hours total (2400 mins)
      for (let day = 11; day <= 14; day++) {
        const inTime = `2026-08-${day}T09:00:00Z`;
        const outTime = `2026-08-${day}T17:00:00Z`;
        const cin = await clockIn(employee1Id, testVenueId, null, inTime);
        await clockOut(employee1Id, cin.attendance_id, outTime, 0);
        await approveAttendance(cin.attendance_id, managerId, 480);
      }

      // Seed employee2 with 4 sessions of 8 hours = 32 hours total (1920 mins)
      for (let day = 10; day <= 13; day++) {
        const inTime = `2026-08-${day}T10:00:00Z`;
        const outTime = `2026-08-${day}T18:00:00Z`;
        const cin = await clockIn(employee2Id, testVenueId, null, inTime);
        await clockOut(employee2Id, cin.attendance_id, outTime, 0);
        await approveAttendance(cin.attendance_id, managerId, 480);
      }
    });
  });

  describe('3. Tips Pool Allocation Engine', () => {
    let tipPoolId;

    it('should allocate tips based on HOURS_WORKED preserving exact minor integer rounding', async () => {
      // Total tips 250.00 EGP (25000 minor units) for date 2026-08-10
      // Employee 1: 480 mins (50%), Employee 2: 480 mins (50%)
      const res = await createTipPool({
        venueId: testVenueId,
        poolDate: '2026-08-10',
        source: 'CASH_TIPS',
        totalAmountMinor: 25000,
        allocationMethod: 'HOURS_WORKED',
        eligibleUserIds: [employee1Id, employee2Id]
      });

      expect(res.status).to.equal('SUCCESS');
      tipPoolId = res.tip_pool_id;
      expect(res.allocations.length).to.equal(2);

      const sumAllocated = res.allocations.reduce((sum, a) => sum + a.amount_minor, 0);
      expect(sumAllocated).to.equal(25000); // Exact reconciliation!
    });

    it('should allow manager to approve the tip pool', async () => {
      const res = await approveTipPool(tipPoolId, managerId);
      expect(res.status).to.equal('SUCCESS');

      const pool = await getQuery(`SELECT status FROM tip_pools WHERE id = ?`, [tipPoolId]);
      expect(pool.status).to.equal('APPROVED');
    });
  });

  describe('4. Adjustments (Penalties, Bonuses & Advances)', () => {
    it('should record audited bonuses and penalties with reasons', async () => {
      const bonusRes = await recordAdjustment(
        employee1Id,
        'BONUS',
        10000, // 100.00 EGP
        'مكافأة تميز في خدمة العملاء والسرعة',
        '2026-08-12',
        managerId,
        managerId
      );
      expect(bonusRes.status).to.equal('SUCCESS');

      const penaltyRes = await recordAdjustment(
        employee2Id,
        'PENALTY',
        5000, // 50.00 EGP
        'خصم تأخير عن موعد بدء الوردية 45 دقيقة',
        '2026-08-12',
        managerId,
        managerId
      );
      expect(penaltyRes.status).to.equal('SUCCESS');
    });
  });

  describe('5. Deterministic Payroll Calculation & Strict Lifecycle', () => {
    let periodId;

    it('should calculate payroll in DRAFT / CALCULATED status', async () => {
      const res = await calculatePayrollPeriod(testVenueId, '2026-08-01', '2026-08-31', 'MONTHLY');
      expect(res.status).to.equal('SUCCESS');
      expect(res.period_status).to.equal('CALCULATED');
      periodId = res.payroll_period_id;

      const details = await getPayrollPeriodDetails(periodId);
      expect(details.status).to.equal('CALCULATED');
      expect(details.lines.length).to.be.at.least(2);

      // Verify Employee 1 Line: 40 hrs * 60 EGP = 2400.00 EGP (240000 minor) + 12500 tips + 10000 bonus = 262500 minor
      const emp1Line = details.lines.find(l => l.user_id === employee1Id);
      expect(emp1Line).to.exist;
      expect(emp1Line.hours_worked).to.equal(40);
      expect(emp1Line.base_pay_minor).to.equal(240000);
      expect(emp1Line.tips_minor).to.equal(12500);
      expect(emp1Line.bonuses_minor).to.equal(10000);
      expect(emp1Line.net_pay_minor).to.equal(262500); // 2,625.00 EGP

      // Verify Employee 2 Line: 32 hrs * 40 EGP = 1280.00 EGP (128000 minor) + 12500 tips - 5000 penalty = 135500 minor
      const emp2Line = details.lines.find(l => l.user_id === employee2Id);
      expect(emp2Line).to.exist;
      expect(emp2Line.hours_worked).to.equal(32);
      expect(emp2Line.base_pay_minor).to.equal(128000);
      expect(emp2Line.tips_minor).to.equal(12500);
      expect(emp2Line.penalties_minor).to.equal(5000);
      expect(emp2Line.net_pay_minor).to.equal(135500); // 1,355.00 EGP
    });

    it('should transition through REVIEWED -> APPROVED -> LOCKED -> PAID', async () => {
      // 1. Review
      const revRes = await reviewPayrollPeriod(periodId, managerId);
      expect(revRes.period_status).to.equal('REVIEWED');

      // 2. Approve
      const appRes = await approvePayrollPeriod(periodId, managerId);
      expect(appRes.period_status).to.equal('APPROVED');

      // 3. Lock
      const lockRes = await lockPayrollPeriod(periodId, managerId);
      expect(lockRes.period_status).to.equal('LOCKED');

      // 4. Pay
      const payRes = await recordPayrollPayment(periodId, managerId, 'CASH');
      expect(payRes.period_status).to.equal('PAID');
    });

    it('should export itemized payslips matching line totals', async () => {
      const payslipsData = await getPayslips(periodId);
      expect(payslipsData.status).to.equal('PAID');
      expect(payslipsData.payslips.length).to.be.at.least(2);

      const slip1 = payslipsData.payslips.find(s => s.user_id === employee1Id);
      expect(slip1.earnings.gross_earnings_minor).to.equal(262500);
      expect(slip1.net_pay_minor).to.equal(262500);
    });

    it('should reject adjustments created within a locked payroll period', async () => {
      try {
        await recordAdjustment(
          employee1Id,
          'PENALTY',
          1000,
          'Late backdated penalty',
          '2026-08-15',
          managerId
        );
        expect.fail('Should have rejected adjustment in locked period');
      } catch (err) {
        expect(err.message).to.include('يقع ضمن مسير رواتب مقفل أو مدفوع');
      }
    });
  });

  describe('6. Negative Net Pay Handling & Recoverable Advance Rollover', () => {
    let deficitPeriodId;

    it('should cap negative net pay at 0 and record recoverable advance trace', async () => {
      const prevStart = '2026-07-01';
      const prevEnd = '2026-07-31';

      // Record a massive advance of 5,000.00 EGP (500000 minor) for employee 2 in July
      await recordAdjustment(
        employee2Id,
        'ADVANCE',
        500000,
        'سلفة استثنائية كبيرة',
        '2026-07-05',
        managerId,
        managerId
      );

      // Seed small attendance of 8 hrs = 320.00 EGP (32000 minor)
      const cin = await clockIn(employee2Id, testVenueId, null, '2026-07-06T09:00:00Z');
      await clockOut(employee2Id, cin.attendance_id, '2026-07-06T17:00:00Z', 0);
      await approveAttendance(cin.attendance_id, managerId, 480);

      // Calculate July Payroll
      const calcRes = await calculatePayrollPeriod(testVenueId, prevStart, prevEnd, 'MONTHLY');
      deficitPeriodId = calcRes.payroll_period_id;

      const details = await getPayrollPeriodDetails(deficitPeriodId);
      const emp2Line = details.lines.find(l => l.user_id === employee2Id);

      // Earnings = 32000 minor (320 EGP). Advances = 500000 minor (5000 EGP).
      // Deficit = 468000 minor (4680 EGP). Net pay MUST be 0!
      expect(emp2Line.net_pay_minor).to.equal(0);
      expect(emp2Line.recoverable_advance_minor).to.equal(468000);
      expect(emp2Line.calculation_trace.raw_net_pay_minor).to.equal(-468000);
    });

    it('should rollover recoverable advance to next open period upon locking', async () => {
      await approvePayrollPeriod(deficitPeriodId, managerId);
      const lockRes = await lockPayrollPeriod(deficitPeriodId, managerId);
      expect(lockRes.rollover_advances_created).to.equal(1);

      // Verify append-only advance adjustment was created for August
      const rolloverAdjs = await allQuery(`
        SELECT * FROM hr_adjustments 
        WHERE user_id = ? AND type = 'ADVANCE' AND effective_date = '2026-08-01'
      `, [employee2Id]);

      expect(rolloverAdjs.length).to.be.at.least(1);
      expect(rolloverAdjs[0].amount_minor).to.equal(468000);
      expect(rolloverAdjs[0].reason).to.include('ترحيل عجز سلفة');
    });
  });

  describe('7. P&L / Reporting Isolation (No Unapproved Payroll in Reports)', () => {
    it('should only include APPROVED / LOCKED / PAID payroll in financial reports', async () => {
      // P&L for August 2026 (Period was PAID)
      const pnlAug = await generateProfitAndLoss({
        venueId: testVenueId,
        startDate: '2026-08-01',
        endDate: '2026-08-31'
      });

      // August had approved/paid payroll of 262500 + 135500 = 398000 minor = 3980.00 EGP
      expect(pnlAug.expenses.payroll_minor).to.equal(398000);
    });
  });

  describe('8. Quality Assurance & Complaint Lifecycle with Privacy Masking', () => {
    let complaintId;

    it('should create complaint with masked customer personal data in staff views', async () => {
      const res = await createComplaint({
        venueId: testVenueId,
        loggedByUserId: managerId,
        againstUserId: employee2Id,
        customerName: 'محمد أحمد إبراهيم',
        customerPhone: '01012345678',
        severity: 'HIGH',
        description: 'تأخير غير مبرر وسوء تعامل مع الضيف عند طلب الفاتورة'
      });

      expect(res.status).to.equal('SUCCESS');
      complaintId = res.complaint_id;

      // Verify masking functions
      expect(maskPhone('01012345678')).to.equal('010****5678');
      expect(maskName('محمد أحمد إبراهيم')).to.equal('محمد إ.');

      const complaints = await getComplaints({ venueId: testVenueId });
      const created = complaints.find(c => c.id === complaintId);

      expect(created).to.exist;
      expect(created.customer_name_masked).to.equal('محمد إ.');
      expect(created.customer_phone_masked).to.equal('010****5678');
      expect(created.status).to.equal('OPEN');
      expect(created.severity).to.equal('HIGH');
      expect(created.against_user_name).to.equal('محمود ويتر');
      expect(created.audit_trail.length).to.equal(1);
    });

    it('should update complaint with investigation, root cause, and corrective action', async () => {
      const res = await updateComplaint(complaintId, {
        actorId: managerId,
        status: 'INVESTIGATING',
        ownerUserId: managerId,
        rootCause: 'ضغط الطلبات في الصالة ونقص المتابعة من المشرف',
        correctiveAction: 'تدريب إضافي وإعادة توجيه سلوك الخدمة',
        dueDate: '2026-08-30'
      });

      expect(res.status).to.equal('SUCCESS');
      expect(res.new_status).to.equal('INVESTIGATING');

      const updated = (await getComplaints({ venueId: testVenueId })).find(c => c.id === complaintId);
      expect(updated.root_cause).to.include('ضغط الطلبات');
      expect(updated.corrective_action).to.include('تدريب إضافي');
      expect(updated.audit_trail.length).to.equal(2);
    });

    it('should resolve complaint and record audit timestamp', async () => {
      const res = await resolveComplaint(complaintId, managerId, 'تم حل الإشكال والتواصل مع العميل والاعتذار.');
      expect(res.status).to.equal('SUCCESS');

      const resolved = (await getComplaints({ venueId: testVenueId })).find(c => c.id === complaintId);
      expect(resolved.status).to.equal('RESOLVED');
      expect(resolved.resolution_notes).to.include('تم حل الإشكال');
      expect(resolved.resolved_at).to.be.a('string');
      expect(resolved.audit_trail.length).to.equal(3);
    });
  });

  describe('9. HTTP API Routes & Contract Gate', () => {
    it('GET /api/payroll should return period-based payroll and roster', async () => {
      const res = await request(app)
        .get('/api/payroll?venue_id=' + testVenueId)
        .set('Authorization', 'Bearer ' + managerToken);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.payroll).to.be.an('array');
    });

    it('GET /api/qa/complaints should return complaints with masked customer data', async () => {
      const res = await request(app)
        .get('/api/qa/complaints?venue_id=' + testVenueId)
        .set('Authorization', 'Bearer ' + managerToken);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.complaints).to.be.an('array');
      expect(res.body.complaints.length).to.be.at.least(1);
      expect(res.body.complaints[0].customer_phone_masked).to.include('****');
    });

    it('POST /api/quality/complaints should log a new QA incident', async () => {
      const res = await request(app)
        .post('/api/quality/complaints')
        .set('Authorization', 'Bearer ' + managerToken)
        .send({
          venue_id: testVenueId,
          logged_by_user_id: managerId,
          customer_name: 'سارة خالد',
          customer_phone: '01122334455',
          severity: 'MED',
          description: 'ملاحظة على درجة سخونة مشروب اللاتيه'
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.complaint_id).to.exist;
      expect(res.body.masked_customer_name).to.equal('سارة خ.');
    });
  });
});
