/**
 * HACCP Food Safety, Fridge Temperature Logs & Sanitation Checklists Routes
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

// 1. Get HACCP Temperature Logs
router.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const logs = await allQuery(`
      SELECT * FROM haccp_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);

    const alertsCount = await getQuery(`
      SELECT COUNT(*) as cnt FROM haccp_logs 
      WHERE is_alert = 1 AND date(created_at) = date('now', 'localtime')
    `);

    res.json({
      success: true,
      data: { logs, today_alerts_count: alertsCount ? alertsCount.cnt : 0 },
      logs,
      today_alerts_count: alertsCount ? alertsCount.cnt : 0,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// 2. Log Temperature Reading
router.post('/logs', requireAuth, async (req, res, next) => {
  try {
    const {
      unit_name = 'ثلاجة الحليب الرئيسية',
      unit_type = 'FRIDGE',
      temperature,
      min_safe_temp = 2.0,
      max_safe_temp = 5.0,
      notes = ''
    } = req.body;

    if (temperature === undefined || temperature === null || isNaN(Number(temperature))) {
      return res.status(400).json({ success: false, error: 'قيمة درجة الحرارة غير صالحة' });
    }

    const tempVal = Number(temperature);
    const minSafe = Number(min_safe_temp);
    const maxSafe = Number(max_safe_temp);
    const isAlert = (tempVal < minSafe || tempVal > maxSafe) ? 1 : 0;
    const loggedBy = (req.user && req.user.name) ? req.user.name : 'مسؤول الجودة';
    const userId = req.user ? req.user.id : null;

    const result = await runQuery(
      `INSERT INTO haccp_logs (unit_name, unit_type, temperature, min_safe_temp, max_safe_temp, is_alert, logged_by, user_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [unit_name, unit_type, tempVal, minSafe, maxSafe, isAlert, loggedBy, userId, notes]
    );

    if (isAlert) {
      logger.warn('HACCP Temperature Out of Safe Zone Alert', {
        unit_name,
        temperature: tempVal,
        safe_range: `${minSafe}°C - ${maxSafe}°C`,
        logged_by: loggedBy
      });
    }

    res.json({
      success: true,
      message: isAlert 
        ? `⚠️ تنبيه: درجة الحرارة (${tempVal}°C) خارج النطاق الآمن (${minSafe}°C - ${maxSafe}°C)!`
        : `تم توثيق درجة الحرارة بنجاح (${tempVal}°C) ضمن النطاق الآمن ✅`,
      data: {
        log_id: result.lastID,
        is_alert: isAlert === 1,
        temperature: tempVal
      },
      log_id: result.lastID,
      is_alert: isAlert === 1,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// 3. Get Cleaning / Sanitation Checklist
router.get('/checklist', requireAuth, async (req, res, next) => {
  try {
    const tasks = await allQuery(`
      SELECT * FROM cleaning_checklists 
      ORDER BY category ASC, is_completed ASC, id ASC
    `);

    res.json({
      success: true,
      data: { tasks },
      tasks,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// 4. Toggle Sanitation Task Completion
router.post('/checklist/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const task = await getQuery(`SELECT * FROM cleaning_checklists WHERE id = ?`, [taskId]);
    if (!task) {
      return res.status(404).json({ success: false, error: 'المهمة غير موجودة' });
    }

    const newCompleted = task.is_completed ? 0 : 1;
    const completedBy = newCompleted ? (req.user ? req.user.name : 'طاقم العمل') : null;
    const userId = newCompleted ? (req.user ? req.user.id : null) : null;
    const completedAt = newCompleted ? new Date().toISOString() : null;

    await runQuery(
      `UPDATE cleaning_checklists 
       SET is_completed = ?, completed_by = ?, user_id = ?, completed_at = ?
       WHERE id = ?`,
      [newCompleted, completedBy, userId, completedAt, taskId]
    );

    res.json({
      success: true,
      message: newCompleted ? 'تم إتمام مهمة التعقيم والنظافة بنجاح ✓' : 'تم إعادة تعيين المهمة',
      task_id: taskId,
      is_completed: newCompleted === 1,
      completed_by: completedBy
    });
  } catch (err) {
    next(err);
  }
});

// 5. Add Custom Sanitation Task
router.post('/checklist', requireAuth, async (req, res, next) => {
  try {
    const { task_name, category = 'DAILY', department = 'BARISTA', notes = '' } = req.body;
    if (!task_name || !task_name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم مهمة النظافة مطلوب' });
    }

    const result = await runQuery(
      `INSERT INTO cleaning_checklists (task_name, category, department, notes)
       VALUES (?, ?, ?, ?)`,
      [task_name.trim(), category, department, notes]
    );

    res.json({
      success: true,
      message: 'تمت إضافة مهمة النظافة بنجاح',
      task_id: result.lastID
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
