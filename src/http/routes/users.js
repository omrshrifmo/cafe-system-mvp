/**
 * User Roster, Staff Management, Payroll & Shareholder Ledger HTTP Routes
 * Strictly requires authentication and role permissions
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');

// Employees / Users Roster - Protected by 'users:read'
router.get('/users', requireAuth, requirePermission('users:read'), async (req, res, next) => {
  try {
    const users = await allQuery(
      `SELECT id, name, role, department, hourly_rate, is_active, phone 
       FROM users 
       ORDER BY id ASC`
    );
    res.json({
      success: true,
      users
    });
  } catch (err) {
    next(err);
  }
});

router.get('/staff', requireAuth, requirePermission('users:read'), async (req, res, next) => {
  try {
    const staff = await allQuery(
      `SELECT id, name, role, department, hourly_rate, is_active 
       FROM users 
       WHERE is_active = 1 
       ORDER BY id ASC`
    );
    res.json({
      success: true,
      staff
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAuth, requirePermission('users:write'), async (req, res, next) => {
  try {
    const { name, role, pin, pin_code, department = 'BARISTA', hourly_rate = 0, phone } = req.body;
    const rawPin = pin || pin_code;
    if (!name || !rawPin || String(rawPin).length < 4) {
      return res.status(400).json({ success: false, error: 'الاسم ورمز PIN (4 أرقام على الأقل) مطلوبان' });
    }

    const pinHash = await bcrypt.hash(String(rawPin).trim(), 10);
    const result = await runQuery(
      `INSERT INTO users (name, role, pin_hash, department, hourly_rate, phone, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name.trim(), role || 'WAITER', pinHash, department, Number(hourly_rate) || 0, phone || null]
    );

    res.json({
      success: true,
      user_id: result.lastID,
      message: 'تم إضافة الموظف بنجاح'
    });
  } catch (err) {
    next(err);
  }
});

// Update User Profile / Role / Department
router.put('/users/:id', requireAuth, requirePermission('users:write'), async (req, res, next) => {
  try {
    const { name, role, department, hourly_rate, phone, is_active } = req.body;
    const user = await getQuery(`SELECT id FROM users WHERE id = ?`, [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }

    await runQuery(
      `UPDATE users 
       SET name = COALESCE(?, name),
           role = COALESCE(?, role),
           department = COALESCE(?, department),
           hourly_rate = COALESCE(?, hourly_rate),
           phone = COALESCE(?, phone),
           is_active = COALESCE(?, is_active),
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [
        name !== undefined ? String(name).trim() : null,
        role !== undefined ? String(role).trim() : null,
        department !== undefined ? String(department).trim() : null,
        hourly_rate !== undefined ? Number(hourly_rate) : null,
        phone !== undefined ? String(phone).trim() : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        req.params.id
      ]
    );

    res.json({ success: true, message: 'تم تحديث بيانات الموظف بنجاح' });
  } catch (err) {
    next(err);
  }
});

// Update / Reset User PIN Code
router.post('/users/:id/pin', requireAuth, requirePermission('users:write'), async (req, res, next) => {
  try {
    const { pin, new_pin } = req.body;
    const rawPin = new_pin || pin;
    if (!rawPin || String(rawPin).trim().length < 4) {
      return res.status(400).json({ success: false, error: 'رمز PIN الجديد يجب أن يتكون من 4 أرقام على الأقل' });
    }

    const user = await getQuery(`SELECT id, name FROM users WHERE id = ?`, [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }

    const pinHash = await bcrypt.hash(String(rawPin).trim(), 10);
    await runQuery(
      `UPDATE users SET pin_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [pinHash, req.params.id]
    );

    res.json({ success: true, message: `تم تحديث الرمز السري للموظف (${user.name}) بنجاح 🔒` });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id/rate', requireAuth, async (req, res, next) => {
  try {
    const { hourly_rate } = req.body;
    const rateMinor = Math.round((Number(hourly_rate) || 0) * 100);
    const { recordEffectiveRate } = require('../../domain/hr/adjustmentService');
    await recordEffectiveRate(String(req.params.id), rateMinor);
    await runQuery(
      `UPDATE users SET hourly_rate = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [Number(hourly_rate) || 0, req.params.id]
    );
    res.json({ success: true, message: 'تم تحديث أجر الموظف بنجاح' });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/hourly-rate', requireAuth, async (req, res, next) => {
  try {
    const { hourly_rate } = req.body;
    const rateMinor = Math.round((Number(hourly_rate) || 0) * 100);
    const { recordEffectiveRate } = require('../../domain/hr/adjustmentService');
    await recordEffectiveRate(String(req.params.id), rateMinor);
    await runQuery(
      `UPDATE users SET hourly_rate = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [Number(hourly_rate) || 0, req.params.id]
    );
    res.json({ success: true, message: 'تم تحديث أجر الموظف بنجاح' });
  } catch (err) {
    next(err);
  }
});

// Payroll calculation & report (Delegated to authoritative HR service)
router.get(['/payroll', '/users/payroll'], requireAuth, async (req, res, next) => {
  try {
    const { getPayrollPeriods, getPayrollPeriodDetails, getStaffRoster } = require('../../domain/hr/payrollService');
    const { getStaffRoster: getRoster } = require('../../domain/hr/adjustmentService');
    const venueId = req.query.venue_id || (req.user && req.user.venue_id) || 'V_DEFAULT';
    const periods = await getPayrollPeriods(venueId);

    if (periods.length > 0) {
      const latest = await getPayrollPeriodDetails(periods[0].id);
      const lines = latest.lines.map(l => ({
        user_id: l.user_id,
        name: l.user_name,
        role: l.hr_role || l.user_role,
        hourly_rate: (l.hourly_rate_minor / 100).toFixed(2),
        total_hours: l.hours_worked + l.overtime_hours,
        base_salary: (l.base_pay_minor / 100).toFixed(2),
        total_advances: (l.advances_minor / 100).toFixed(2),
        total_penalties: (l.penalties_minor / 100).toFixed(2),
        net_salary: (l.net_pay_minor / 100).toFixed(2),
        status: l.status
      }));
      return res.json({
        success: true,
        period: `${latest.start_date} إلى ${latest.end_date}`,
        period_status: latest.status,
        payroll: lines,
        lines,
        data: { payroll: lines, period: latest }
      });
    }

    const roster = await getRoster(venueId);
    const mockLines = roster.map(u => ({
      user_id: u.id,
      name: u.name,
      role: u.hr_role || u.system_role,
      hourly_rate: ((u.active_hourly_rate_minor || 0) / 100).toFixed(2),
      total_hours: 0,
      base_salary: '0.00',
      total_advances: '0.00',
      total_penalties: '0.00',
      net_salary: '0.00',
      status: 'NO_PERIOD'
    }));

    res.json({
      success: true,
      period: 'لا يوجد مسير معتمد',
      payroll: mockLines,
      lines: mockLines,
      data: { payroll: mockLines }
    });
  } catch (err) {
    next(err);
  }
});

// Shareholder Ledger
const { REPORT_TYPES, generateReport: generateReportUnified } = require('../../domain/reports/reportDefinitionService');

router.get('/shareholders', requireAuth, requirePermission('shareholders:read'), async (req, res, next) => {
  try {
    const report = await generateReportUnified(REPORT_TYPES.SHAREHOLDER_EQUITY, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post('/shareholders/transactions', requireAuth, requirePermission('shareholders:write'), async (req, res, next) => {
  try {
    const { partner_name, transaction_type, amount, description } = req.body;
    if (!partner_name || !transaction_type || !amount) {
      return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
    }
    const result = await runQuery(
      `INSERT INTO shareholder_ledger (partner_name, type, amount, description)
       VALUES (?, ?, ?, ?)`,
      [partner_name, transaction_type, Number(amount) || 0, description || null]
    );

    // Also insert into canonical equity_ledger for unified ledger tracking
    const venueId = 'V_DEFAULT';
    let eventType = 'CAPITAL_CONTRIBUTION';
    if (transaction_type === 'WITHDRAWAL') eventType = 'OWNER_WITHDRAWAL';
    if (transaction_type === 'DISTRIBUTION') eventType = 'DISTRIBUTION';

    const amtMinor = Math.round(Number(amount) * 100);
    const equityId = `EQ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const actorId = req.user ? String(req.user.id) : '102';
    const effectiveDate = new Date().toISOString().split('T')[0];

    await runQuery(
      `INSERT INTO equity_ledger (id, venue_id, event_type, amount_minor, effective_date, actor_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [equityId, venueId, eventType, amtMinor, effectiveDate, actorId, description || `${transaction_type} by ${partner_name}`]
    );

    res.json({ success: true, transaction_id: result.lastID, equity_id: equityId, message: 'تم تسجيل المعاملة بنجاح' });
  } catch (err) {
    next(err);
  }
});

// HR / Payroll missing endpoints

router.put('/:id/hourly-rate', requireAuth, requirePermission('payroll:write'), async (req, res, next) => {
  try {
    const { hourly_rate } = req.body;
    await runQuery(`UPDATE users SET hourly_rate = ? WHERE id = ?`, [Number(hourly_rate) || 0, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/penalties', requireAuth, requirePermission('payroll:read'), async (req, res, next) => {
  try {
    const penalties = await allQuery(
      `SELECT p.*, u.name as employee_name FROM penalties p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    );
    res.json({ success: true, penalties });
  } catch (err) {
    next(err);
  }
});

router.post('/penalties', requireAuth, requirePermission('payroll:write'), async (req, res, next) => {
  try {
    const { user_id, amount, reason } = req.body;
    await runQuery(
      `INSERT INTO penalties (user_id, amount, reason) VALUES (?, ?, ?)`,
      [user_id, Number(amount) || 0, reason]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/staff-allowances', requireAuth, requirePermission('payroll:read'), async (req, res, next) => {
  try {
    const allowances = await allQuery(
      `SELECT s.*, u.name as employee_name FROM staff_allowances s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC`
    );
    res.json({ success: true, allowances });
  } catch (err) {
    next(err);
  }
});

router.post('/staff-allowances', requireAuth, requirePermission('payroll:write'), async (req, res, next) => {
  try {
    const { user_id, daily_drink_limit, daily_food_limit } = req.body;
    const existing = await getQuery(`SELECT id FROM staff_allowances WHERE user_id = ?`, [user_id]);
    if (existing) {
      await runQuery(
        `UPDATE staff_allowances SET daily_drink_limit = ?, daily_food_limit = ? WHERE user_id = ?`,
        [Number(daily_drink_limit) || 0, Number(daily_food_limit) || 0, user_id]
      );
    } else {
      await runQuery(
        `INSERT INTO staff_allowances (user_id, daily_drink_limit, daily_food_limit) VALUES (?, ?, ?)`,
        [user_id, Number(daily_drink_limit) || 0, Number(daily_food_limit) || 0]
      );
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/declarations', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const declarations = await allQuery(
      `SELECT d.*, u.name as user_name FROM drawer_declarations d JOIN users u ON d.user_id = u.id ORDER BY d.created_at DESC LIMIT 100`
    );
    res.json({ success: true, declarations });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
