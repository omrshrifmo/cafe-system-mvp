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
      `SELECT id, name, role, department, hourly_rate, is_active, phone, created_at 
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

router.put('/users/:id/rate', requireAuth, requirePermission('hr:manage'), async (req, res, next) => {
  try {
    const { hourly_rate } = req.body;
    await runQuery(
      `UPDATE users SET hourly_rate = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [Number(hourly_rate) || 0, req.params.id]
    );
    res.json({ success: true, message: 'تم تحديث أجر الموظف بنجاح' });
  } catch (err) {
    next(err);
  }
});

// Payroll calculation & report
router.get('/payroll', requireAuth, requirePermission('payroll:read'), async (req, res, next) => {
  try {
    const users = await allQuery(`SELECT id, name, role, department, hourly_rate, is_active FROM users WHERE is_active = 1`);
    const shifts = await allQuery(
      `SELECT user_id, 
              COUNT(id) as shift_count,
              COALESCE(SUM((strftime('%s', COALESCE(clock_out, datetime('now', 'localtime'))) - strftime('%s', clock_in)) / 3600.0), 0) as total_hours
       FROM shifts
       WHERE clock_in >= date('now', 'start of month')
       GROUP BY user_id`
    );
    const advances = await allQuery(
      `SELECT employee_name, COALESCE(SUM(amount), 0) as total_advances
       FROM employee_advances
       WHERE created_at >= date('now', 'start of month')
       GROUP BY employee_name`
    );

    const shiftMap = new Map(shifts.map(s => [s.user_id, s]));
    const advMap = new Map(advances.map(a => [a.employee_name, a.total_advances]));

    const payrollLines = users.map(u => {
      const s = shiftMap.get(u.id) || { shift_count: 0, total_hours: 0 };
      const hours = Math.round(s.total_hours * 10) / 10;
      const rate = Number(u.hourly_rate) || 0;
      const basePay = Math.round(hours * rate);
      const adv = advMap.get(u.name) || 0;
      const netPay = Math.max(0, basePay - adv);

      return {
        user_id: u.id,
        name: u.name,
        role: u.role,
        department: u.department,
        hourly_rate: rate,
        shift_count: s.shift_count,
        total_hours: hours,
        base_salary: basePay,
        advances: adv,
        net_payable: netPay
      };
    });

    res.json({
      success: true,
      period: 'الشهر الحالي',
      lines: payrollLines
    });
  } catch (err) {
    next(err);
  }
});

// Shareholder Ledger
router.get('/shareholders', requireAuth, requirePermission('shareholders:read'), async (req, res, next) => {
  try {
    const transactions = await allQuery(`SELECT * FROM shareholder_ledger ORDER BY created_at DESC LIMIT 100`);
    const summary = await getQuery(
      `SELECT 
         COALESCE(SUM(CASE WHEN transaction_type = 'CAPITAL_INJECTION' THEN amount ELSE 0 END), 0) as total_capital,
         COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as total_withdrawals,
         COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN amount ELSE 0 END), 0) as total_external_expenses
       FROM shareholder_ledger`
    );
    res.json({
      success: true,
      summary: summary || { total_capital: 0, total_withdrawals: 0, total_external_expenses: 0 },
      transactions
    });
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
    res.json({ success: true, transaction_id: result.lastID, message: 'تم تسجيل المعاملة بنجاح' });
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
