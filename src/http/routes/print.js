/**
 * Direct Print & Test Print HTTP Routes
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getSystemTaxConfig } = require('../../domain/payments/service');
const { runQuery, allQuery } = require('../../db/connection');

router.post('/print/test', requireAuth, requirePermission('orders:void_unpaid'), async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    const jobId = crypto.randomUUID();
    const payload = JSON.stringify({
      order_id: 'TEST',
      cafe_name: config.cafe_name,
      cashier_name: req.user.name,
      items: [{ item_name: 'تجربة طباعة حرارية', quantity: 1, price: 0 }],
      total_amount: 0,
      currency: config.currency,
      kick_drawer: config.cash_drawer_auto_kick
    });

    await runQuery(
      `INSERT INTO print_jobs (id, job_type, printer_ip, printer_port, payload_json, status)
       VALUES (?, 'RECEIPT', ?, ?, ?, 'PENDING')`,
      [jobId, config.printer_ip, config.printer_port, payload]
    );

    res.json({
      success: true,
      job_id: jobId,
      message: `تم إدراج أمر طباعة تجريبي في طابور الطابعة (${config.printer_ip}:${config.printer_port})`
    });
  } catch (err) {
    next(err);
  }
});

router.get('/print/jobs', requireAuth, async (req, res, next) => {
  try {
    const jobs = await allQuery(`SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT 20`);
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
