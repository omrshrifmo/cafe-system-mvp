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
    const isUsb = req.body.connection_type === 'USB' || config.printer_connection_type === 'USB';
    const printerName = req.body.printer_name || config.printer_name || 'ReceiptPrinter';
    const jobId = crypto.randomUUID();
    const rawPayload = {
      order_id: 'TEST',
      cafe_name: config.cafe_name,
      cashier_name: req.user ? req.user.name : 'مسؤول النظام',
      items: [{ item_name: 'تجربة طباعة حرارية (ESC/POS Test)', quantity: 1, price: 0 }],
      total_amount: 0,
      currency: config.currency,
      kick_drawer: config.cash_drawer_auto_kick
    };
    const payload = JSON.stringify(rawPayload);

    if (isUsb) {
      const { formatReceiptEscPos, sendRawBufferToUsbPrinter } = require('../../domain/printing/service');
      const buffer = formatReceiptEscPos(rawPayload);
      const usbResult = await sendRawBufferToUsbPrinter(printerName, buffer);
      return res.json({
        success: true,
        job_id: jobId,
        connection_type: 'USB',
        printer_name: printerName,
        message: `تم إرسال أمر الطباعة التجريبي إلى طابعة USB/ويندوز (${printerName}) بنجاح 🖨️`,
        details: usbResult
      });
    }

    await runQuery(
      `INSERT INTO print_jobs (id, job_type, printer_ip, printer_port, payload_json, status)
       VALUES (?, 'RECEIPT', ?, ?, ?, 'PENDING')`,
      [jobId, config.printer_ip, config.printer_port, payload]
    );

    res.json({
      success: true,
      job_id: jobId,
      connection_type: 'NETWORK',
      message: `تم إدراج أمر طباعة تجريبي في طابور الطابعة (${config.printer_ip}:${config.printer_port})`
    });
  } catch (err) {
    next(err);
  }
});

// Audited "No-Sale" Cash Drawer Kick Pulse (OWNER, OP_MANAGER, OP_ASSISTANT_CASHIER only)
router.post('/print/open-drawer', requireAuth, async (req, res, next) => {
  try {
    const userRole = (req.user && req.user.role ? req.user.role : '').toUpperCase().replace(/^R_/, '');
    const allowedRoles = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER'];
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح لك بفتح درج النقدية يدويًا بدون عملية بيع (No-Sale). الصلاحية مقتصرة على الإدارة والكاشير فقط.'
      });
    }

    const config = await getSystemTaxConfig();
    const jobId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    const auditPayload = {
      user_id: req.user ? req.user.id : null,
      user_name: req.user ? req.user.name : 'Unknown',
      role: userRole,
      reason: req.body.reason || 'فتح يدوي مباشر لدرج النقدية (No-Sale Drawer Kick)',
      ip_address: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    };

    // 1. Log aggressively to audit_logs
    await runQuery(
      `INSERT INTO audit_logs (target_table, record_id, action, user_id, previous_value, new_value, ip_address, created_at)
       VALUES ('cash_drawer', 'drawer_1', 'NO_SALE_DRAWER_OPENED', ?, NULL, ?, ?, datetime('now', 'localtime'))`,
      [req.user ? req.user.id : null, JSON.stringify(auditPayload), req.ip || req.connection.remoteAddress]
    );

    // 2. Enqueue print job for drawer kick pulse
    await runQuery(
      `INSERT INTO print_jobs (id, job_type, printer_ip, printer_port, payload_json, status)
       VALUES (?, 'DRAWER_KICK', ?, ?, ?, 'PENDING')`,
      [jobId, config.printer_ip, config.printer_port, JSON.stringify(auditPayload)]
    );

    res.json({
      success: true,
      message: 'تم إرسال إشارة فتح الدرج وتوثيق العملية في سجل الرقابة والتدقيق 🗄️⚡',
      action: 'NO_SALE_DRAWER_OPENED',
      drawer_kicked: true,
      job_id: jobId,
      audit_id: auditId,
      buffer_length: CMD.DRAWER_KICK.length
    });
  } catch (err) {
    next(err);
  }
});

// Reprint Past Order Receipt with Duplicate Watermark (** نسخة مكررة **)
async function handleReceiptReprint(req, res, next) {
  try {
    const orderId = req.params.id;
    const { getQuery, allQuery } = require('../../db/connection');
    
    let session = await getQuery(`SELECT * FROM order_sessions WHERE id = ?`, [orderId]);
    let items = [];
    let tableNumber = 'سفري';
    let subtotal = 0, serviceAmount = 0, vatAmount = 0, discountAmount = 0, totalAmount = 0;

    if (session) {
      tableNumber = session.table_number || 'سفري';
      subtotal = (session.subtotal_minor || 0) / 100;
      serviceAmount = (session.service_minor || 0) / 100;
      vatAmount = (session.tax_minor || 0) / 100;
      discountAmount = (session.discount_minor || 0) / 100;
      totalAmount = (session.total_minor || 0) / 100;
      
      const rawItems = await allQuery(`SELECT * FROM order_items WHERE session_id = ?`, [session.id]);
      items = rawItems.map(it => ({
        item_name: it.item_name || it.name,
        quantity: it.quantity || 1,
        price: (it.unit_price_minor || 0) / 100
      }));
    } else {
      const order = await getQuery(`SELECT * FROM orders WHERE id = ?`, [orderId]);
      if (!order) {
        return res.status(404).json({ success: false, error: 'لم يتم العثور على الطلب المطلوب' });
      }
      tableNumber = order.table_number || 'سفري';
      totalAmount = (order.total_minor || 0) / 100;
      subtotal = totalAmount;
      const rawItems = await allQuery(`SELECT * FROM order_items WHERE order_id = ? OR id = ?`, [order.id, order.id]);
      items = rawItems.map(it => ({
        item_name: it.item_name || it.name,
        quantity: it.quantity || 1,
        price: (it.unit_price_minor || 0) / 100
      }));
    }

    const config = await getSystemTaxConfig();
    const receiptData = {
      cafe_name: config.cafe_name,
      order_id: orderId,
      table_number: tableNumber,
      cashier_name: req.user ? req.user.name : 'الكاشير',
      items,
      subtotal,
      service_amount: serviceAmount,
      vat_amount: vatAmount,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      currency: config.currency,
      is_duplicate: true, // Clearly marks ** نسخة مكررة **
      is_reprint: true,
      kick_drawer: false
    };

    const buffer = formatReceiptEscPos(receiptData);
    const jobId = crypto.randomUUID();
    await runQuery(
      `INSERT INTO print_jobs (id, job_type, printer_ip, printer_port, payload_json, status)
       VALUES (?, 'RECEIPT', ?, ?, ?, 'PENDING')`,
      [jobId, config.printer_ip, config.printer_port, JSON.stringify(receiptData)]
    );

    // Audit log for reprint
    await runQuery(
      `INSERT INTO audit_logs (target_table, record_id, action, user_id, previous_value, new_value, ip_address, created_at)
       VALUES ('order_sessions', ?, 'RECEIPT_REPRINTED', ?, NULL, ?, ?, datetime('now', 'localtime'))`,
      [String(orderId), req.user ? req.user.id : null, JSON.stringify({ order_id: orderId, reprinted_by: req.user ? req.user.name : 'Unknown', is_duplicate: true }), req.ip || req.connection.remoteAddress]
    );

    res.json({
      success: true,
      message: 'تم إرسال الفاتورة لإعادة الطباعة بنجاح (** نسخة مكررة **) 🖨️',
      job_id: jobId,
      is_duplicate: true,
      receipt: receiptData,
      buffer_length: buffer.length
    });
  } catch (err) {
    next(err);
  }
}

router.post('/print/receipt/reprint/:id', requireAuth, handleReceiptReprint);
router.post('/print/reprint/:id', requireAuth, handleReceiptReprint);

// Shift Z-Report Thermal Printing Route
router.post('/print/z-report', requireAuth, async (req, res, next) => {
  try {
    const { getUserShiftReport } = require('../../domain/shifts/service');
    const { formatZReportEscPos, enqueuePrintJob } = require('../../domain/printing/service');
    const config = await getSystemTaxConfig();

    const userId = req.body.user_id || (req.user ? req.user.id : 1);
    const shiftType = req.body.shift_type || 'MORNING';

    // Retrieve shift financials
    let report = {};
    try {
      report = await getUserShiftReport(userId, shiftType);
    } catch (e) {
      report = {};
    }

    const openingFloat = req.body.opening_float !== undefined ? Number(req.body.opening_float) : (report.opening_float || 500);
    const expectedCash = req.body.expected_cash !== undefined ? Number(req.body.expected_cash) : (report.expected_cash || 0);
    const declaredCash = req.body.actual_cash !== undefined ? Number(req.body.actual_cash) : (req.body.declared_cash !== undefined ? Number(req.body.declared_cash) : expectedCash);
    const variance = req.body.variance !== undefined ? Number(req.body.variance) : (declaredCash - expectedCash);

    const zReportData = {
      cafe_name: config.cafe_name || 'كافيه مزاج',
      user_id: userId,
      user_name: req.body.user_name || (req.user ? req.user.name : (report.user_name || 'الكاشير')),
      shift_type: shiftType,
      shift_start: req.body.shift_start || report.clock_in || 'بداية الوردية',
      shift_end: req.body.shift_end || report.clock_out || new Date().toLocaleString('ar-EG'),
      opening_float: openingFloat,
      cash_sales: req.body.cash_sales !== undefined ? Number(req.body.cash_sales) : (report.cash_sales || 0),
      digital_sales: req.body.digital_sales !== undefined ? Number(req.body.digital_sales) : (report.digital_sales || 0),
      total_sales: req.body.total_sales !== undefined ? Number(req.body.total_sales) : (report.total_sales || 0),
      advances: req.body.advances !== undefined ? Number(req.body.advances) : (report.cash_advances || 0),
      expenses: req.body.expenses !== undefined ? Number(req.body.expenses) : (report.cash_expenses || 0),
      expected_cash: expectedCash,
      actual_cash: declaredCash,
      variance: variance,
      order_count: report.order_count || 0,
      created_at: new Date().toLocaleString('ar-EG')
    };

    const buffer = formatZReportEscPos(zReportData);
    const printResult = await enqueuePrintJob({
      jobType: 'Z_REPORT',
      payload: zReportData,
      printerIp: config.printer_ip || '127.0.0.1',
      printerPort: config.printer_port || 9100,
      idempotencyKey: req.body.idempotency_key || `z_report_${userId}_${Date.now()}`
    });

    // Audit log
    await runQuery(
      `INSERT INTO audit_logs (target_table, record_id, action, user_id, previous_value, new_value, ip_address, created_at)
       VALUES ('shifts', ?, 'Z_REPORT_PRINTED', ?, NULL, ?, ?, datetime('now', 'localtime'))`,
      [String(userId), req.user ? req.user.id : null, JSON.stringify({ user_id: userId, shift_type: shiftType, variance, declared_cash: declaredCash }), req.ip || req.connection.remoteAddress]
    );

    res.json({
      success: true,
      message: 'تم إرسال تقرير إغلاق الوردية (Shift Z-Report) للطباعة الحرارية بنجاح 🖨️',
      job_id: printResult.job_id,
      z_report: zReportData,
      buffer_length: buffer.length
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
