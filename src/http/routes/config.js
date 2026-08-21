/**
 * Global Configuration & Maintenance HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { getSystemTaxConfig } = require('../../domain/payments/service');
const { verifyReauthentication } = require('../../domain/auth/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { runQuery } = require('../../db/connection');
const env = require('../../config/env');

router.get('/config', async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    res.json({
      success: true,
      config
    });
  } catch (err) {
    next(err);
  }
});

router.post('/config', requireAuth, requirePermission('orders:void_unpaid'), async (req, res, next) => {
  try {
    const updates = req.body;
    for (const [k, v] of Object.entries(updates)) {
      await runQuery(
        `INSERT INTO system_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [k, String(v)]
      );
    }
    const updated = await getSystemTaxConfig();
    res.json({
      success: true,
      message: 'تم حفظ إعدادات النظام بنجاح ⚙️',
      config: updated
    });
  } catch (err) {
    next(err);
  }
});

router.post('/system/factory-reset', requireAuth, async (req, res, next) => {
  try {
    if (env.ALLOW_FACTORY_RESET !== 'true' && env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'إعادة ضبط المصنع معطلة بشكل افتراضي في بيئة الإنتاج لأسباب الأمان'
      });
    }

    if (!['SUPER_ADMIN', 'OWNER'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'إعادة ضبط المصنع تتطلب صلاحيات المالك أو السوبر أدمن'
      });
    }

    const pin = req.body.pin || req.body.pin_code;
    const isPinValid = await verifyReauthentication(req.user.id, pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        error: 'رمز PIN للتأكيد غير صحيح'
      });
    }

    // Safely clear transactional data while preserving schema and configuration
    await runQuery('DELETE FROM order_items');
    await runQuery('DELETE FROM payments');
    await runQuery('DELETE FROM payment_reversals');
    await runQuery('DELETE FROM order_sessions');
    await runQuery('DELETE FROM table_sessions');
    await runQuery('DELETE FROM inventory_ledger');
    await runQuery('DELETE FROM drawer_declarations');
    await runQuery('DELETE FROM shifts');
    await runQuery('DELETE FROM daily_expenses');
    await runQuery('DELETE FROM employee_advances');
    await runQuery('DELETE FROM penalties');
    await runQuery('DELETE FROM complaints');
    await runQuery('DELETE FROM print_jobs');
    await runQuery('DELETE FROM outbox_events');
    await runQuery('UPDATE tables SET status = "AVAILABLE"');

    res.json({
      success: true,
      message: 'تمت إعادة ضبط بيانات العمليات بنجاح'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
