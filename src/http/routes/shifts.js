/**
 * Shifts, Cash Reconciliation, Handover & Period Management HTTP Routes
 */
const express = require('express');
const router = express.Router();
const {
  openShift,
  recordShiftHandover,
  recordBlindCount,
  calculateExpectedCash,
  closeShift,
  reopenShift,
  getActiveShift,
  getShiftById
} = require('../../domain/shifts/shiftService');
const { recordCashOperation } = require('../../domain/shifts/cashService');
const { lockAccountingPeriod } = require('../../domain/shifts/periodService');
const { clockInUser, clockOutUser, getUserShiftReport, declareCashExtended } = require('../../domain/shifts/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery } = require('../../db/connection');

// Open a new shift (MORNING / NIGHT)
router.post('/shifts/open', requireAuth, async (req, res, next) => {
  try {
    const {
      shift_type = 'MORNING',
      business_date = new Date().toISOString().split('T')[0],
      timezone = 'UTC',
      opening_float_minor = 0,
      assigned_staff = [],
      assigned_devices = []
    } = req.body;

    const venueId = req.body.venue_id || (req.user ? req.user.venue_id : 'V_DEFAULT') || 'V_DEFAULT';
    const result = await openShift(
      venueId,
      shift_type,
      business_date,
      timezone,
      opening_float_minor,
      req.user ? req.user.id : null,
      assigned_staff,
      assigned_devices
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Record Handover Snapshot
router.post('/shifts/:id/handover', requireAuth, async (req, res, next) => {
  try {
    const result = await recordShiftHandover(req.params.id, req.user ? req.user.id : null);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Record Blind Count
router.post('/shifts/:id/count', requireAuth, async (req, res, next) => {
  try {
    const { counted_amount_minor, counted_cash_minor, expected_version } = req.body;
    const amount = counted_amount_minor !== undefined ? counted_amount_minor : counted_cash_minor;
    if (amount === undefined || amount === null) {
      return res.status(400).json({ success: false, error: 'المبلغ الفعلي للجرد مطلوب (counted_amount_minor required)' });
    }

    const result = await recordBlindCount(
      req.params.id,
      amount,
      req.user ? req.user.id : null,
      expected_version
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Close Shift
router.post('/shifts/:id/close', requireAuth, async (req, res, next) => {
  try {
    const { expected_version } = req.body;
    const userRole = req.user ? req.user.role : 'CASHIER';
    const result = await closeShift(
      req.params.id,
      req.user ? req.user.id : null,
      expected_version,
      userRole
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Reopen Shift (Owner / Manager only)
router.post('/shifts/:id/reopen', requireAuth, async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, error: 'سبب إعادة فتح الوردية مطلوب' });
    }

    const userRole = req.user ? req.user.role : 'CASHIER';
    const result = await reopenShift(
      req.params.id,
      req.user ? req.user.id : null,
      reason,
      userRole
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Get Active Shift
router.get('/shifts/active', requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venueId || (req.user ? req.user.venue_id : 'V_DEFAULT') || 'V_DEFAULT';
    const shift = await getActiveShift(venueId);
    res.json({
      success: true,
      shift
    });
  } catch (err) {
    next(err);
  }
});

// Get Shift Details
router.get('/shifts/:id', requireAuth, async (req, res, next) => {
  try {
    const userRole = req.user ? req.user.role : 'CASHIER';
    const shift = await getShiftById(req.params.id, userRole);
    if (!shift) {
      return res.status(404).json({ success: false, error: 'الوردية غير موجودة' });
    }
    res.json({
      success: true,
      shift
    });
  } catch (err) {
    next(err);
  }
});

// Record Cash Operation (Expense, Advance, Withdrawal, Adjustment)
router.post('/shifts/operations/cash', requireAuth, async (req, res, next) => {
  try {
    const { shift_id, type, amount_minor, reason, approval_actor_id } = req.body;
    const venueId = req.body.venue_id || (req.user ? req.user.venue_id : 'V_DEFAULT') || 'V_DEFAULT';
    const actorId = req.user ? req.user.id : '108';

    const result = await recordCashOperation(
      venueId,
      shift_id,
      type,
      amount_minor,
      reason,
      actorId,
      approval_actor_id || actorId
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Lock Accounting Period
router.post('/shifts/periods/lock', requireAuth, async (req, res, next) => {
  try {
    const { period_date, period_type = 'DAILY' } = req.body;
    const venueId = req.body.venue_id || (req.user ? req.user.venue_id : 'V_DEFAULT') || 'V_DEFAULT';
    const result = await lockAccountingPeriod(
      venueId,
      period_date,
      period_type,
      req.user ? req.user.id : null
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Legacy / Compatibility Endpoints
// ==========================================

router.post('/shifts/clock-in', requireAuth, async (req, res, next) => {
  try {
    const { shift_type } = req.body;
    const result = await clockInUser(req.user.id, shift_type);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/shifts/clock-out', requireAuth, async (req, res, next) => {
  try {
    const result = await clockOutUser(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/shifts/me', requireAuth, async (req, res, next) => {
  try {
    const shiftType = req.query.shift_type || 'MORNING';
    const report = await getUserShiftReport(req.user.id, shiftType);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post(['/shifts/declare-cash-extended', '/shifts/declare-cash', '/drawer/declare-extended', '/hr/declare-cash'], requireAuth, async (req, res, next) => {
  try {
    const payload = {
      user_id: req.user.id,
      user_name: req.user.name,
      ...req.body
    };
    const result = await declareCashExtended(payload, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/shifts', requireAuth, async (req, res, next) => {
  try {
    const shifts = await allQuery(
      `SELECT s.*, u.name as opener_name, c.name as closer_name
       FROM v3_shifts s
       LEFT JOIN v3_users u ON s.opened_by = u.id
       LEFT JOIN v3_users c ON s.closed_by = c.id
       ORDER BY s.created_at DESC LIMIT 50`
    );
    res.json({
      success: true,
      shifts
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
