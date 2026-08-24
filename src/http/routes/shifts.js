/**
 * Shifts, Attendance, Blind Cash Declaration & Z-Report HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { clockInUser, clockOutUser, getUserShiftReport, declareCashExtended } = require('../../domain/shifts/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery } = require('../../db/connection');

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

router.post('/shifts/declare-cash-extended', requireAuth, async (req, res, next) => {
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

router.get('/shifts', requireAuth, requirePermission('shifts:read'), async (req, res, next) => {
  try {
    const shifts = await allQuery(
      `SELECT s.id, s.user_id, s.role, s.clock_in, s.clock_out, s.status, s.shift_type, u.name as user_name
       FROM shifts s
       LEFT JOIN users u ON s.user_id = u.id
       ORDER BY s.clock_in DESC LIMIT 50`
    );
    res.json({
      success: true,
      shifts
    });
  } catch (err) {
    next(err);
  }
});

router.get('/shifts/history', requireAuth, requirePermission('shifts:read'), async (req, res, next) => {
  try {
    const shifts = await allQuery(`SELECT * FROM shifts ORDER BY clock_in DESC LIMIT 50`);
    res.json(shifts);
  } catch (err) {
    next(err);
  }
});

router.get('/shifts/declarations', requireAuth, requirePermission('shifts:read'), async (req, res, next) => {
  try {
    const decs = await allQuery(`SELECT * FROM drawer_declarations ORDER BY created_at DESC LIMIT 50`);
    res.json(decs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
