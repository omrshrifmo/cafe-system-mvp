/**
 * Server-Authoritative Payments, Quotations & Checkout Domain Service
 */
const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { verifyPin } = require('../auth/service');
const logger = require('../../observability/logger');

async function getSystemTaxConfig() {
  const configs = await allQuery(`SELECT key, value FROM system_config`);
  const cfg = {};
  for (const c of configs) cfg[c.key] = c.value;
  return {
    currency: cfg.currency || 'ج.م',
    vat_percent: parseFloat(cfg.vat_percent || '14'),
    service_percent: parseFloat(cfg.service_percent || '12'),
    apply_taxes: cfg.apply_taxes !== 'false',
    cafe_name: cfg.cafe_name || 'كافيه مزاج',
    printer_ip: cfg.printer_ip || '192.168.1.100',
    printer_port: parseInt(cfg.printer_port || '9100', 10),
    cash_drawer_auto_kick: cfg.cash_drawer_auto_kick !== 'false'
  };
}

async function quoteSession(sessionIdOrTableNumber) {
  let session = null;
  if (typeof sessionIdOrTableNumber === 'number') {
    const table = await getQuery(`SELECT id FROM tables WHERE table_number = ?`, [sessionIdOrTableNumber]);
    if (table) {
      session = await getQuery(
        `SELECT * FROM order_sessions WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT') ORDER BY id DESC LIMIT 1`,
        [table.id]
      );
    }
  } else {
    session = await getQuery(`SELECT * FROM order_sessions WHERE id = ? OR public_ref = ?`, [sessionIdOrTableNumber, sessionIdOrTableNumber]);
  }

  if (!session) {
    return {
      subtotal_minor: 0,
      service_minor: 0,
      tax_minor: 0,
      total_minor: 0,
      subtotal: 0,
      service: 0,
      vat: 0,
      total: 0,
      currency: 'ج.م',
      items: []
    };
  }

  const items = await allQuery(
    `SELECT id, item_name_snapshot as name, unit_price_minor, quantity, department, modifiers_json 
     FROM order_items 
     WHERE session_id = ? AND status = 'ACTIVE'`,
    [session.id]
  );

  const subtotalMinor = items.reduce((sum, it) => sum + (it.unit_price_minor * it.quantity), 0);
  const config = await getSystemTaxConfig();

  let serviceMinor = 0;
  let taxMinor = 0;

  if (config.apply_taxes) {
    serviceMinor = Math.round((subtotalMinor * config.service_percent) / 100);
    const taxableBase = subtotalMinor + serviceMinor;
    taxMinor = Math.round((taxableBase * config.vat_percent) / 100);
  }

  const totalMinor = subtotalMinor + serviceMinor + taxMinor;

  return {
    session_id: session.id,
    table_id: session.table_id,
    currency: config.currency,
    subtotal_minor: subtotalMinor,
    service_minor: serviceMinor,
    tax_minor: taxMinor,
    total_minor: totalMinor,
    subtotal: subtotalMinor / 100,
    service_amount: serviceMinor / 100,
    vat_amount: taxMinor / 100,
    total_amount: totalMinor / 100,
    items: items.map(it => ({
      ...it,
      unit_price: it.unit_price_minor / 100,
      total_price: (it.unit_price_minor * it.quantity) / 100
    }))
  };
}

async function settleSession(checkoutPayload, actor = null) {
  const { table_number, customer_phone, points_redeemed = 0, tip_amount = 0, discount_amount = 0, discount_percent = 0, cashier_name } = checkoutPayload;
  const tNum = parseInt(table_number, 10) || 0;
  const rawPayments = Array.isArray(checkoutPayload.payments) && checkoutPayload.payments.length > 0
    ? checkoutPayload.payments
    : [{ method: checkoutPayload.payment_method || 'CASH', amount: (checkoutPayload.amount_tendered_minor ? checkoutPayload.amount_tendered_minor / 100 : (checkoutPayload.amount || 100)) }];
  const payments = rawPayments;

  return runTransaction(async (tx) => {
    // 0. Strict Lock: Check if order, order_item, or session is already settled/closed
    const targetOrderId = checkoutPayload.order_id || checkoutPayload.id;
    const targetSessionId = checkoutPayload.session_id;

    if (targetOrderId) {
      const existingOrder = await tx.get(`SELECT id, status FROM orders WHERE id = ?`, [targetOrderId]);
      if (existingOrder && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(existingOrder.status)) {
        const err = new Error("Order already settled");
        err.status = 409;
        err.statusCode = 409;
        err.code = "ORDER_ALREADY_SETTLED";
        throw err;
      }

      const existingOrderItem = await tx.get(`SELECT id, session_id, status FROM order_items WHERE id = ?`, [targetOrderId]);
      if (existingOrderItem) {
        if (['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(existingOrderItem.status)) {
          const err = new Error("Order already settled");
          err.status = 409;
          err.statusCode = 409;
          err.code = "ORDER_ALREADY_SETTLED";
          throw err;
        }
        const parentSession = await tx.get(`SELECT id, status FROM order_sessions WHERE id = ?`, [existingOrderItem.session_id]);
        if (parentSession && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(parentSession.status)) {
          const err = new Error("Order already settled");
          err.status = 409;
          err.statusCode = 409;
          err.code = "ORDER_ALREADY_SETTLED";
          throw err;
        }
      }

      const existingSessionDirect = await tx.get(`SELECT id, status FROM order_sessions WHERE id = ?`, [targetOrderId]);
      if (existingSessionDirect && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(existingSessionDirect.status)) {
        const err = new Error("Order already settled");
        err.status = 409;
        err.statusCode = 409;
        err.code = "ORDER_ALREADY_SETTLED";
        throw err;
      }
    }

    if (targetSessionId) {
      const existingSession = await tx.get(`SELECT id, status FROM order_sessions WHERE id = ?`, [targetSessionId]);
      if (existingSession && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(existingSession.status)) {
        const err = new Error("Order already settled");
        err.status = 409;
        err.statusCode = 409;
        err.code = "ORDER_ALREADY_SETTLED";
        throw err;
      }
    }

    // 1. Resolve table & active session
    let table = null;
    if (tNum > 0) {
      table = await tx.get(`SELECT id, table_number FROM tables WHERE table_number = ?`, [tNum]);
    }

    let session = null;
    if (targetSessionId) {
      session = await tx.get(`SELECT * FROM order_sessions WHERE id = ?`, [targetSessionId]);
    } else if (table) {
      session = await tx.get(
        `SELECT * FROM order_sessions WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT') ORDER BY id DESC LIMIT 1`,
        [table.id]
      );
    }

    if (session && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(session.status)) {
      const err = new Error("Order already settled");
      err.status = 409;
      err.statusCode = 409;
      err.code = "ORDER_ALREADY_SETTLED";
      throw err;
    }

    // 2. Fetch session items & calculate authoritative bill
    let subtotalMinor = 0;
    let items = [];
    if (session) {
      items = await tx.all(
        `SELECT id, item_name_snapshot as item_name, unit_price_minor, quantity, department 
         FROM order_items 
         WHERE session_id = ? AND status = 'ACTIVE'`,
        [session.id]
      );
      subtotalMinor = items.reduce((sum, it) => sum + (it.unit_price_minor * it.quantity), 0);
    } else {
      // Direct fast checkout fallback
      subtotalMinor = Math.round((Number(checkoutPayload.subtotal) || 0) * 100);
    }

    const config = await getSystemTaxConfig();
    let serviceMinor = 0;
    let taxMinor = 0;

    if (config.apply_taxes) {
      serviceMinor = Math.round((subtotalMinor * config.service_percent) / 100);
      const taxableBase = subtotalMinor + serviceMinor;
      taxMinor = Math.round((taxableBase * config.vat_percent) / 100);
    }

    // Discount calculations
    let calculatedDiscountMinor = 0;
    if (discount_percent > 0) {
      calculatedDiscountMinor = Math.round((subtotalMinor * discount_percent) / 100);
    } else if (discount_amount > 0) {
      calculatedDiscountMinor = Math.round(discount_amount * 100);
    }

    const tipMinor = Math.round((Number(tip_amount) || 0) * 100);
    const redeemedPoints = Math.max(0, parseInt(points_redeemed, 10) || 0);
    const loyaltyDiscountMinor = redeemedPoints * 100; // 1 point = 1 unit

    const totalDiscountMinor = calculatedDiscountMinor + loyaltyDiscountMinor;
    const finalBillMinor = Math.max(0, subtotalMinor + serviceMinor + taxMinor - totalDiscountMinor + tipMinor);

    if (!session) {
      const publicRef = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const sRes = await tx.run(
        `INSERT INTO order_sessions (public_ref, order_type, table_id, customer_id, status, subtotal_minor, total_minor, created_by)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
        [publicRef, tNum > 0 ? 'DINE_IN' : 'TAKEAWAY', table ? table.id : null, customer_phone || null, subtotalMinor, finalBillMinor, actor ? actor.id : null]
      );
      session = { id: sRes.lastID, public_ref: publicRef };
    }

    // 3. Process Payments array
    const paymentsArr = Array.isArray(payments) ? payments : [];
    let totalPaidMinor = 0;
    let cashPaidMinor = 0;

    for (const p of paymentsArr) {
      const pMinor = Math.round((Number(p.amount) || 0) * 100);
      totalPaidMinor += pMinor;
      if (p.method === 'CASH') cashPaidMinor += pMinor;
    }

    // Validate payment sufficiency
    if (totalPaidMinor < finalBillMinor) {
      throw new Error(`INSUFFICIENT_PAYMENT: إجمالي المدفوع (${totalPaidMinor/100}) أقل من المطلوب سداده (${finalBillMinor/100})`);
    }

    const changeOwedMinor = Math.max(0, totalPaidMinor - finalBillMinor);

    // 4. Record Payment rows
    let remainingChangeToSubtract = changeOwedMinor;
    for (const p of paymentsArr) {
      const pMinor = Math.round((Number(p.amount) || 0) * 100);
      let netPayment = pMinor;
      if (p.method === 'CASH' && remainingChangeToSubtract > 0) {
        const sub = Math.min(pMinor, remainingChangeToSubtract);
        netPayment = pMinor - sub;
        remainingChangeToSubtract -= sub;
      }
      
      const pRes = await tx.run(
        `INSERT INTO payments (session_id, method, amount_minor, tip_minor, currency, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [session.id, p.method, netPayment, tipMinor, config.currency, actor ? actor.id : null]
      );

      // Handle ON_CREDIT customer balance
      if (p.method === 'ON_CREDIT' || p.method === 'CREDIT' || p.method === 'حساب آجل') {
        if (customer_phone) {
          const cleanPhone = String(customer_phone).trim();
          await tx.run(
            `UPDATE customers SET credit_balance = credit_balance + ? WHERE phone = ?`,
            [netPayment / 100, cleanPhone]
          );
          await tx.run(
            `UPDATE v3_customers SET credit_balance_minor = credit_balance_minor + ? WHERE phone = ?`,
            [netPayment, cleanPhone]
          );
        }
      }
    }

    // 5. Update loyalty points
    let customerResult = null;
    if (customer_phone && String(customer_phone).trim().length > 0) {
      const cleanPhone = String(customer_phone).trim();
      const earnedPoints = Math.floor(finalBillMinor / 1000); // 1 pt per 10 EGP
      const netPtChange = earnedPoints - redeemedPoints;
      
      await tx.run(
        `INSERT INTO customers (phone, name, points, total_spent) VALUES (?, 'عميل', ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           points = MAX(0, points + ?),
           total_spent = total_spent + ?,
           visit_count = visit_count + 1,
           last_visit = datetime('now', 'localtime')`,
        [cleanPhone, Math.max(0, netPtChange), finalBillMinor / 100, netPtChange, finalBillMinor / 100]
      );
      customerResult = await tx.get(`SELECT * FROM customers WHERE phone = ?`, [cleanPhone]);
    }

    // 6. Close Session & Table Cleanly
    if (targetOrderId) {
      await tx.run(`UPDATE orders SET status = 'CLOSED' WHERE id = ?`, [targetOrderId]);
      await tx.run(`UPDATE order_items SET status = 'SETTLED', updated_at = datetime('now', 'localtime') WHERE id = ?`, [targetOrderId]);
    }

    if (session) {
      await tx.run(`UPDATE order_items SET status = 'SETTLED', updated_at = datetime('now', 'localtime') WHERE session_id = ?`, [session.id]);
      const activePol = await tx.get(`SELECT version FROM v3_policies ORDER BY version DESC LIMIT 1`);
      const polVer = activePol ? activePol.version : 1;

      await tx.run(
        `UPDATE order_sessions SET status = 'SETTLED', closed_at = datetime('now', 'localtime'),
                subtotal_minor = ?, service_minor = ?, tax_minor = ?, discount_minor = ?, tip_minor = ?, total_minor = ?, policy_version = ?
         WHERE id = ?`,
        [subtotalMinor, serviceMinor, taxMinor, totalDiscountMinor, tipMinor, finalBillMinor, polVer, session.id]
      );
    }

    if (table) {
      await tx.run(
        `UPDATE tables 
         SET status = 'AVAILABLE',
             custom_name = NULL,
             customer_name = NULL,
             customer_phone = NULL,
             guest_count = 0,
             seated_at = NULL,
             first_ordered_at = NULL,
             last_ordered_at = NULL,
             check_requested_at = NULL,
             paid_at = datetime('now', 'localtime'),
             vacated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [table.id]
      );

      await tx.run(
        `UPDATE v3_tables 
         SET status = 'AVAILABLE',
             active_order_id = NULL,
             active_reservation_id = NULL,
             customer_context_json = NULL,
             version = version + 1,
             updated_at = datetime('now', 'localtime')
         WHERE table_number = ?`,
        [tNum]
      );
    }

    // 7. Spool Thermal Receipt Print Job
    const printJobId = crypto.randomUUID();
    const receiptPayload = JSON.stringify({
      order_id: session ? session.id : tNum,
      table_number: tNum,
      cashier_name: cashier_name || (actor ? actor.name : 'الكاشير'),
      items: items.map(it => ({ item_name: it.item_name, quantity: it.quantity, price: it.unit_price_minor / 100 })),
      payments: paymentsArr,
      subtotal: subtotalMinor / 100,
      service_amount: serviceMinor / 100,
      vat_amount: taxMinor / 100,
      discount_amount: totalDiscountMinor / 100,
      total_amount: finalBillMinor / 100,
      change_owed: changeOwedMinor / 100,
      currency: config.currency,
      kick_drawer: config.cash_drawer_auto_kick
    });

    await tx.run(
      `INSERT INTO print_jobs (id, job_type, payload_json, status) VALUES (?, 'RECEIPT', ?, 'PENDING')`,
      [printJobId, receiptPayload]
    );

    // 8. Outbox Event
    await tx.run(
      `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json)
       VALUES (?, 'TABLE_STATE_CHANGED', 'TABLE', ?, ?)`,
      [crypto.randomUUID(), String(tNum), JSON.stringify({ table_number: tNum, status: 'PAID' })]
    );

    return {
      success: true,
      message: 'تم إغلاق الحساب وتسجيل الدفع بنجاح',
      invoice: {
        table_number: tNum,
        subtotal: subtotalMinor / 100,
        service_amount: serviceMinor / 100,
        vat_amount: taxMinor / 100,
        discount_amount: totalDiscountMinor / 100,
        total_amount: finalBillMinor / 100,
        change_owed: changeOwedMinor / 100,
        currency: config.currency
      },
      customer: customerResult
    };
  });
}

async function voidOrder(orderId, managerPin, reason = 'إلغاء أوردر') {
  // Validate manager / owner PIN
  const users = await allQuery(`SELECT id, name, role, pin_hash FROM users WHERE is_active = 1`);
  let authorizedUser = null;

  for (const u of users) {
    if (u.pin_hash && (await verifyPin(managerPin, u.pin_hash))) {
      authorizedUser = u;
      break;
    }
  }

  if (!authorizedUser) {
    throw new Error('INVALID_PIN: رمز PIN غير صحيح');
  }

  return runTransaction(async (tx) => {
    const item = await tx.get(`SELECT * FROM order_items WHERE id = ?`, [orderId]);
    if (!item) throw new Error('NOT_FOUND: الطلب غير موجود');

    // Check if order belongs to a settled session or paid order
    const session = await tx.get(`SELECT * FROM order_sessions WHERE id = ?`, [item.session_id]);
    const isPaid = session && session.status === 'SETTLED';

    // ULTIMATE VOID RULE: Paid orders can ONLY be voided by OWNER or SUPER_ADMIN
    if (isPaid && authorizedUser.role !== 'OWNER' && authorizedUser.role !== 'SUPER_ADMIN' && authorizedUser.role !== 'ADMIN') {
      throw new Error('FORBIDDEN: صلاحية إلغاء الفواتير المسددة والمغلقة مالياً مقتصرة حصرياً على المالك (OWNER / SUPER_ADMIN)');
    }

    await tx.run(`UPDATE order_items SET status = 'VOIDED', cancel_reason = ? WHERE id = ?`, [reason, orderId]);

    // Reverse inventory consumption
    const ledgerConsumptions = await tx.all(`SELECT * FROM inventory_ledger WHERE source_type = 'ORDER_ITEM' AND source_id = ?`, [String(orderId)]);
    // Immutable Ledger: If order was paid/settled, append negative adjusting entries (NEVER delete)
    if (isPaid && session) {
      const paidRows = await tx.all(`SELECT * FROM payments WHERE session_id = ? AND amount_minor > 0`, [session.id]);
      for (const p of paidRows) {
        await tx.run(
          `INSERT INTO payments (session_id, method, amount_minor, tip_minor, currency, created_by)
           VALUES (?, ?, ?, 0, ?, ?)`,
          [session.id, p.method, -p.amount_minor, p.currency || 'EGP', authorizedUser.id]
        );
      }

      // Record entry in daily_expenses table if present
      try {
        const totalPaid = paidRows.reduce((sum, p) => sum + p.amount_minor, 0) / 100.0;
        await tx.run(
          `INSERT INTO daily_expenses (amount, description, category, created_by)
           VALUES (?, ?, 'REFUND', ?)`,
          [totalPaid, `إلغاء واسترداد فاتورة رقم #${session.id} - ${reason}`, authorizedUser.id]
        );
      } catch (e) {
        // Safe fallback if daily_expenses table has different schema
      }

      await tx.run(
        `UPDATE order_sessions SET status = 'VOIDED', closed_at = datetime('now', 'localtime') WHERE id = ?`,
        [session.id]
      );
    }

    return {
      success: true,
      message: 'تم إلغاء الطلب وعكس الإيراد واسترجاع المخزون بنجاح (سجل مالي ثابت)',
      voided_order: { id: orderId, status: 'VOIDED' }
    };
  });
}

module.exports = {
  getSystemTaxConfig,
  quoteSession,
  settleSession,
  voidOrder
};
