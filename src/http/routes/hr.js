/**
 * HR, Attendance, Adjustments & Authoritative Payroll HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  calculatePayrollPeriod,
  reviewPayrollPeriod,
  approvePayrollPeriod,
  lockPayrollPeriod,
  recordPayrollPayment,
  getPayrollPeriodDetails,
  getPayrollPeriods,
  getPayslips
} = require('../../domain/hr/payrollService');
const {
  clockIn,
  clockOut,
  approveAttendance,
  rejectAttendance,
  getAttendanceList
} = require('../../domain/hr/attendanceService');
const {
  upsertStaffProfile,
  recordEffectiveRate,
  getStaffRoster,
  recordAdjustment,
  getAdjustments,
  createTipPool,
  approveTipPool,
  getTipPools
} = require('../../domain/hr/adjustmentService');
const { allQuery, runQuery } = require('../../db/connection');

// ====================================================
// 1. Payroll Lifecycle Endpoints
// ====================================================

// List Payroll Periods
router.get(['/payroll/periods', '/hr/payroll/periods'], requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const periods = await getPayrollPeriods(venueId);
    res.json({
      success: true,
      data: { periods },
      periods,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Calculate / Generate Payroll Period
router.post(['/payroll/calculate', '/hr/payroll/calculate'], requireAuth, async (req, res, next) => {
  try {
    const { venue_id, start_date, end_date, period_type } = req.body;
    const venueId = venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date || new Date().toISOString().split('T')[0];

    const result = await calculatePayrollPeriod(venueId, startDate, endDate, period_type || 'MONTHLY');
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Get Payroll Period Details
router.get(['/payroll/periods/:id', '/hr/payroll/periods/:id'], requireAuth, async (req, res, next) => {
  try {
    const details = await getPayrollPeriodDetails(req.params.id);
    if (!details) {
      return res.status(404).json({ success: false, error: 'مسير الرواتب غير موجود', code: 'NOT_FOUND', requestId: req.id });
    }
    res.json({
      success: true,
      data: { period: details },
      period: details,
      payroll: details.lines,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Review Payroll Period
router.post(['/payroll/periods/:id/review', '/hr/payroll/periods/:id/review'], requireAuth, async (req, res, next) => {
  try {
    const reviewerId = req.user ? req.user.id : 'SYSTEM';
    const result = await reviewPayrollPeriod(req.params.id, reviewerId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Approve Payroll Period
router.post(['/payroll/periods/:id/approve', '/hr/payroll/periods/:id/approve'], requireAuth, async (req, res, next) => {
  try {
    const approverId = req.user ? req.user.id : 'SYSTEM';
    const result = await approvePayrollPeriod(req.params.id, approverId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Lock Payroll Period
router.post(['/payroll/periods/:id/lock', '/hr/payroll/periods/:id/lock'], requireAuth, async (req, res, next) => {
  try {
    const lockerId = req.user ? req.user.id : 'SYSTEM';
    const result = await lockPayrollPeriod(req.params.id, lockerId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Record Payroll Payment
router.post(['/payroll/periods/:id/pay', '/hr/payroll/periods/:id/pay'], requireAuth, async (req, res, next) => {
  try {
    const payerId = req.user ? req.user.id : 'SYSTEM';
    const { payment_method } = req.body;
    const result = await recordPayrollPayment(req.params.id, payerId, payment_method || 'CASH');
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Get Payslips
router.get(['/payroll/periods/:id/payslips', '/hr/payroll/periods/:id/payslips'], requireAuth, async (req, res, next) => {
  try {
    const payslips = await getPayslips(req.params.id);
    res.json({
      success: true,
      data: payslips,
      ...payslips,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Legacy / Active Payroll Overview (Backward Compatibility)
router.get(['/payroll', '/hr/payroll'], requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const periods = await getPayrollPeriods(venueId);

    if (periods.length > 0) {
      const latest = await getPayrollPeriodDetails(periods[0].id);
      return res.json({
        success: true,
        data: {
          period: latest,
          payroll: latest.lines
        },
        period: latest,
        payroll: latest.lines,
        periods,
        requestId: req.id
      });
    }

    // If no periods exist yet, return roster with default calculations
    const staff = await getStaffRoster(venueId);
    const mockLines = staff.map(s => ({
      user_id: s.id,
      name: s.name,
      role: s.hr_role || s.system_role,
      hours_worked: 0,
      overtime_hours: 0,
      hourly_rate_minor: s.active_hourly_rate_minor || 0,
      base_pay_minor: 0,
      overtime_pay_minor: 0,
      tips_minor: 0,
      bonuses_minor: 0,
      penalties_minor: 0,
      advances_minor: 0,
      net_pay_minor: 0,
      status: 'NO_PERIOD'
    }));

    res.json({
      success: true,
      data: { payroll: mockLines, periods: [] },
      payroll: mockLines,
      periods: [],
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// ====================================================
// 2. Staff Profiles & Effective Rates
// ====================================================

router.get(['/hr/staff', '/staff'], requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const staff = await getStaffRoster(venueId);
    res.json({
      success: true,
      data: { staff },
      staff,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/staff', '/staff'], requireAuth, async (req, res, next) => {
  try {
    const { user_id, role, venue_id, employment_status, hire_date } = req.body;
    const result = await upsertStaffProfile(user_id, { role, venue_id, employment_status, hire_date });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/rates', '/rates'], requireAuth, async (req, res, next) => {
  try {
    const { user_id, hourly_rate_minor, overtime_multiplier, effective_from, effective_to } = req.body;
    const result = await recordEffectiveRate(user_id, hourly_rate_minor, overtime_multiplier, effective_from, effective_to);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// ====================================================
// 3. Attendance Management
// ====================================================

router.get(['/hr/attendance', '/attendance'], requireAuth, async (req, res, next) => {
  try {
    const { venue_id, user_id, status, start_date, end_date } = req.query;
    const attendance = await getAttendanceList({
      venueId: venue_id,
      userId: user_id,
      status,
      startDate: start_date,
      endDate: end_date
    });
    res.json({
      success: true,
      data: { attendance },
      attendance,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/attendance/clock-in', '/attendance/clock-in'], requireAuth, async (req, res, next) => {
  try {
    const userId = req.body.user_id || (req.user ? req.user.id : null);
    const { venue_id, shift_id, clock_in_time, notes } = req.body;
    const result = await clockIn(userId, venue_id, shift_id, clock_in_time, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/attendance/clock-out', '/attendance/clock-out'], requireAuth, async (req, res, next) => {
  try {
    const userId = req.body.user_id || (req.user ? req.user.id : null);
    const { attendance_id, clock_out_time, break_minutes } = req.body;
    const result = await clockOut(userId, attendance_id, clock_out_time, break_minutes || 0);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/attendance/:id/approve', '/attendance/:id/approve'], requireAuth, async (req, res, next) => {
  try {
    const managerId = req.user ? req.user.id : 'SYSTEM';
    const { productive_minutes, notes } = req.body;
    const result = await approveAttendance(req.params.id, managerId, productive_minutes, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// ====================================================
// 4. Adjustments & Penalties & Allowances
// ====================================================

router.get(['/hr/adjustments', '/adjustments'], requireAuth, async (req, res, next) => {
  try {
    const { user_id, type, start_date, end_date, payroll_period_id } = req.query;
    const adjustments = await getAdjustments({
      userId: user_id,
      type,
      startDate: start_date,
      endDate: end_date,
      payrollPeriodId: payroll_period_id
    });
    res.json({
      success: true,
      data: { adjustments },
      adjustments,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/hr/adjustments', '/adjustments'], requireAuth, async (req, res, next) => {
  try {
    const actorId = req.user ? req.user.id : 'SYSTEM';
    const { user_id, type, amount_minor, reason, effective_date, approval_actor_id, metadata } = req.body;
    const effectiveDate = effective_date || new Date().toISOString().split('T')[0];
    const result = await recordAdjustment(user_id, type, amount_minor, reason, effectiveDate, actorId, approval_actor_id || actorId, metadata);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Penalties alias
router.get(['/penalties', '/hr/penalties'], requireAuth, async (req, res, next) => {
  try {
    const adjustments = await getAdjustments({ type: 'PENALTY' });
    const penalties = adjustments.map(a => ({
      id: a.id,
      user_id: a.user_id,
      user_name: a.user_name,
      amount: a.amount_minor / 100,
      amount_minor: a.amount_minor,
      reason: a.reason,
      effective_date: a.effective_date,
      created_at: a.created_at
    }));
    res.json({
      success: true,
      data: { penalties },
      penalties,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/penalties', '/hr/penalties'], requireAuth, async (req, res, next) => {
  try {
    const actorId = req.user ? req.user.id : 'SYSTEM';
    const { user_id, amount, amount_minor, reason, effective_date } = req.body;
    const finalAmountMinor = amount_minor !== undefined ? amount_minor : Math.round((Number(amount) || 0) * 100);
    const effectiveDate = effective_date || new Date().toISOString().split('T')[0];

    const result = await recordAdjustment(user_id, 'PENALTY', finalAmountMinor, reason || 'جزاء إداري', effectiveDate, actorId, actorId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Tips Pools
router.get(['/tips', '/tips-pools', '/hr/tips-pools'], requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const pools = await getTipPools(venueId);
    res.json({
      success: true,
      data: { tip_pools: pools },
      tip_pools: pools,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/tips', '/tips-pools', '/hr/tips-pools'], requireAuth, async (req, res, next) => {
  try {
    const { venue_id, shift_id, pool_date, source, total_amount_minor, amount, allocation_method, eligible_user_ids } = req.body;
    const finalMinor = total_amount_minor !== undefined ? total_amount_minor : Math.round((Number(amount) || 0) * 100);
    const result = await createTipPool({
      venueId: venue_id || 'V_DEFAULT',
      shiftId: shift_id,
      poolDate: pool_date,
      source: source || 'CASH_TIPS',
      totalAmountMinor: finalMinor,
      allocationMethod: allocation_method || 'HOURS_WORKED',
      eligibleUserIds: eligible_user_ids || []
    });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/tips-pools/:id/approve', '/hr/tips-pools/:id/approve'], requireAuth, async (req, res, next) => {
  try {
    const managerId = req.user ? req.user.id : 'SYSTEM';
    const result = await approveTipPool(req.params.id, managerId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Staff Drink / Meal Allowances
router.get(['/staff-allowances', '/hr/allowances', '/allowances'], requireAuth, async (req, res, next) => {
  try {
    const allowances = await allQuery(`SELECT * FROM staff_allowances ORDER BY created_at DESC LIMIT 50`);
    res.json({
      success: true,
      data: { allowances },
      allowances,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/staff-allowances', '/hr/allowances', '/allowances'], requireAuth, async (req, res, next) => {
  try {
    const { user_name, user_id, item_name, quantity } = req.body;
    const result = await runQuery(
      `INSERT INTO staff_allowances (user_name, item_name, quantity) VALUES (?, ?, ?)`,
      [user_name || `موظف #${user_id || '1'}`, item_name || 'مشروب ضيافة', quantity || 1]
    );
    res.json({
      success: true,
      data: { allowance_id: result.lastID },
      allowance_id: result.lastID,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
