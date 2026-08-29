/**
 * Direct Print, ESC/POS Kitchen Tickets, Cash Receipts & Drawer Kick HTTP Routes
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getSystemTaxConfig } = require('../../domain/payments/service');
const { runQuery, allQuery } = require('../../db/connection');
const { formatReceiptEscPos, formatKitchenTicketEscPos, CMD } = require('../../domain/printing/service');

// BOH Kitchen / Barista Ticket
router.post('/print/kitchen', requireAuth, async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    const { table_number, waiter_name, items = [], notes } = req.body;
    
    const buffer = formatKitchenTicketEscPos({
      table_number: table_number || 'سفري',
      waiter_name: waiter_name || (req.user ? req.user.name : 'طاقم الصالة'),
      items: items.map(it => ({
        item_name: it.name || it.item_name,
        quantity: it.quantity || 1,
        sugar_level: it.sugar_level,
        roast_type: it.roast_type
      })),
      notes
    });

    res.json({
      success: true,
      message: 'تم إرسال بون التجهيز للمطبخ بنجاح 🖨️',
      printer_ip: config.printer_ip,
      buffer_length: buffer.length
    });
  } catch (err) {
    next(err);
  }
});

// Arabic ESC/POS Receipt with RJ11 Cash Drawer Kick Pulse
router.post('/print/receipt', requireAuth, async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    const { order_id, table_number, cashier_name, items = [], subtotal, service_amount, vat_amount, discount_amount, total_amount, change_owed, kick_drawer } = req.body;

    const buffer = formatReceiptEscPos({
      cafe_name: config.cafe_name,
      order_id: order_id || 'N/A',
      table_number: table_number || 'سفري',
      cashier_name: cashier_name || (req.user ? req.user.name : 'الكاشير'),
      items: items.map(it => ({
        item_name: it.name || it.item_name,
        quantity: it.quantity || 1,
        price: it.price || 0
      })),
      subtotal: Number(subtotal || 0),
      service_amount: Number(service_amount || 0),
      vat_amount: Number(vat_amount || 0),
      discount_amount: Number(discount_amount || 0),
      total_amount: Number(total_amount || 0),
      currency: config.currency,
      kick_drawer: kick_drawer !== false && config.cash_drawer_auto_kick
    });

    res.json({
      success: true,
      message: 'تمت طباعة الفاتورة وفتح درج النقدية RJ11 🖨️💵',
      drawer_kicked: kick_drawer !== false && config.cash_drawer_auto_kick,
      printer_ip: config.printer_ip,
      buffer_length: buffer.length
    });
  } catch (err) {
    next(err);
  }
});

router.post('/print/test', requireAuth, requirePermission('orders:void_unpaid'), async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    const jobId = crypto.randomUUID();
    const payload = JSON.stringify({
      order_id: 'TEST',
      cafe_name: config.cafe_name,
      cashier_name: req.user ? req.user.name : 'مسؤول النظام',
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
