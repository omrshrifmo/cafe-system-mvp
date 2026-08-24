const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { computeQuote } = require('./quoteService');

async function saveIdempotencyKey(tx, key, actorId, hash, response) {
  if (!key) return;
  const jsonStr = JSON.stringify(response);
  const numericActor = actorId && !isNaN(parseInt(actorId, 10)) ? parseInt(actorId, 10) : null;
  
  try {
    await tx.run(
      `INSERT OR REPLACE INTO idempotency_keys (key, actor_id, operation, request_hash, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, 'SETTLE_ORDER', ?, 200, ?, datetime('now', 'localtime'), datetime('now', '+24 hours'))`,
      [key, numericActor, hash, jsonStr]
    );
  } catch (e) {
    try {
      await tx.run(
        `INSERT OR REPLACE INTO idempotency_keys (key, actor_id, operation, request_hash, response_status, response_json, created_at, expires_at)
         VALUES (?, NULL, 'SETTLE_ORDER', ?, 200, ?, datetime('now', 'localtime'), datetime('now', '+24 hours'))`,
        [key, hash, jsonStr]
      );
    } catch (e2) {
      try {
        await tx.run(
          `INSERT OR REPLACE INTO idempotency_keys (key, request_params, response_json, created_at)
           VALUES (?, ?, ?, datetime('now', 'localtime'))`,
          [key, hash, jsonStr]
        );
      } catch (e3) {}
    }
  }
}

async function settleOrder(sessionId, intent = {}, expectedVersion = 1) {
  return runTransaction(async (tx) => {
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');

    // 1. Idempotency Check (MUST execute before version lock)
    if (intent.idempotency_key) {
      let existing = null;
      try {
        existing = await tx.get(`SELECT * FROM idempotency_keys WHERE key = ?`, [intent.idempotency_key]);
      } catch (e) {}

      if (existing) {
        const storedHash = existing.payload_hash || existing.request_hash || existing.request_params;
        if (storedHash && storedHash !== currentHash) {
          const err = new Error('IDEMPOTENCY_MISMATCH: مفتاح التكرار مستخدم مسبقاً مع حمولة طلب مختلفة');
          err.statusCode = 409;
          throw err;
        }
        const respStr = existing.response_body || existing.response_json;
        if (respStr) {
          try {
            return JSON.parse(respStr);
          } catch (e) {
            return { status: 'SUCCESS', idempotency_key: intent.idempotency_key };
          }
        }
      }
    }

    // 2. State & Version Lock
    let order = await tx.get(`SELECT * FROM v3_order_sessions WHERE id = ?`, [sessionId]);
    let isV3 = true;
    if (!order) {
      order = await tx.get(`SELECT * FROM order_sessions WHERE id = ? OR public_ref = ?`, [sessionId, sessionId]);
      isV3 = false;
    }
    if (!order) {
      throw new Error(`NOT_FOUND: جلسة الطلب غير موجودة [${sessionId}]`);
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      const currentVer = order.version || 1;
      if (currentVer !== expectedVersion) {
        const err = new Error(`تعارض التحديث المتزامن (Optimistic Concurrency Conflict): إصدار الطلب الحالي هو ${currentVer} بينما المطلوب هو ${expectedVersion}`);
        err.statusCode = 409;
        throw err;
      }
    }
    
    // Validate order status
    const validStatuses = ['OPEN', 'SUBMITTED', 'IN_PREPARATION', 'PARTIALLY_READY', 'READY', 'SERVED', 'PAYMENT_PENDING'];
    if (!validStatuses.includes(order.status)) {
      throw new Error(`INVALID_STATE_TRANSITION: لا يمكن سداد طلب في حالة [${order.status}]`);
    }

    // 3. Compute Server-Authoritative Quote
    let quoteLines = [];
    if (intent.lines && intent.lines.length > 0) {
      quoteLines = intent.lines;
    } else if (isV3) {
      const dbLines = await tx.all(`SELECT menu_item_id as item_id, quantity, modifier_total_minor, unit_price_minor FROM v3_order_lines WHERE order_session_id = ?`, [order.id]);
      quoteLines = dbLines.map(l => ({ item_id: l.item_id, quantity: l.quantity, modifier_total_minor: l.modifier_total_minor, unit_price_minor: l.unit_price_minor }));
    } else {
      const legacyLines = await tx.all(`SELECT menu_item_id as item_id, item_name_snapshot as item_name, quantity, unit_price_minor FROM order_items WHERE session_id = ? AND status = 'ACTIVE'`, [order.id]);
      quoteLines = legacyLines.map(l => ({ item_id: l.item_id, item_name: l.item_name, quantity: l.quantity, unit_price_minor: l.unit_price_minor }));
    }

    const quote = await computeQuote({
      order_id: order.id,
      session_id: order.id,
      table_number: order.table_id || null,
      lines: quoteLines,
      discount_minor: intent.discount_minor || 0,
      tip_minor: intent.tip_minor || 0,
      request_id: intent.request_id || null
    });

    const totalDueMinor = quote.total_due_minor;

    // 4. Check for UNKNOWN_REQUIRES_RECONCILIATION status
    if (intent.status === 'UNKNOWN_REQUIRES_RECONCILIATION' || intent.payment_status === 'UNKNOWN_REQUIRES_RECONCILIATION') {
      const paymentId = `PAY-UNREC-${Date.now()}`;
      if (isV3) {
        await tx.run(
          `INSERT INTO v3_payments (id, order_session_id, amount_minor, tip_minor, currency, payment_method, external_reference, idempotency_key, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_RECONCILIATION', ?)`,
          [paymentId, order.id, totalDueMinor, quote.tip_minor, quote.currency, intent.payment_method || 'UNKNOWN', intent.external_reference || null, intent.idempotency_key || null, intent.actor_id || null]
        );
        await tx.run(`UPDATE v3_order_sessions SET status = 'PAYMENT_PENDING', updated_at = datetime('now', 'localtime') WHERE id = ?`, [order.id]);
      } else {
        await tx.run(
          `INSERT INTO payments (session_id, method, amount_minor, tip_minor, currency, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [order.id, intent.payment_method || 'UNKNOWN', totalDueMinor, quote.tip_minor, quote.currency, intent.actor_id || null]
        );
        await tx.run(`UPDATE order_sessions SET status = 'PAYMENT_PENDING' WHERE id = ?`, [order.id]);
      }

      const unrecResponse = {
        status: 'UNKNOWN_REQUIRES_RECONCILIATION',
        payment_id: paymentId,
        message: 'حالة الدفع غير مؤكدة وتتطلب تسوية ومطابقة بنكية - لم يتم إنهاء الطلب',
        order_status: 'PAYMENT_PENDING'
      };

      await saveIdempotencyKey(tx, intent.idempotency_key, intent.actor_id, currentHash, unrecResponse);
      return unrecResponse;
    }

    // 5. Multi-tender / Single Payment Allocation
    let paymentAllocations = [];
    if (Array.isArray(intent.payments) && intent.payments.length > 0) {
      paymentAllocations = intent.payments.map(p => ({
        method: (p.method || p.payment_method || 'CASH').toUpperCase(),
        amount_minor: Math.round(Number(p.amount_minor !== undefined ? p.amount_minor : (p.amount ? p.amount * 100 : 0))),
        external_reference: p.external_reference || intent.external_reference || null
      }));
    } else {
      const method = (intent.payment_method || intent.method || 'CASH').toUpperCase();
      const amtMinor = Math.round(Number(intent.amount_minor !== undefined ? intent.amount_minor : (intent.amount ? intent.amount * 100 : totalDueMinor)));
      paymentAllocations = [{
        method,
        amount_minor: amtMinor,
        external_reference: intent.external_reference || null
      }];
    }

    const totalProvidedMinor = paymentAllocations.reduce((sum, p) => sum + p.amount_minor, 0);
    if (totalProvidedMinor < totalDueMinor) {
      throw new Error(`INSUFFICIENT_PAYMENT: إجمالي المدفوع (${totalProvidedMinor / 100}) أقل من المطلوب سداده (${totalDueMinor / 100})`);
    }

    const changeOwedMinor = Math.max(0, totalProvidedMinor - totalDueMinor);
    const venueId = intent.venue_id || order.venue_id || order.branch_id || 'V_DEFAULT';

    // 6. Record Payment Rows
    let paymentIds = [];
    for (let i = 0; i < paymentAllocations.length; i++) {
      const p = paymentAllocations[i];
      const paymentId = `PAY-${Date.now()}-${i}`;
      paymentIds.push(paymentId);

      if (isV3) {
        await tx.run(
          `INSERT INTO v3_payments (id, order_session_id, amount_minor, tip_minor, currency, payment_method, external_reference, idempotency_key, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`,
          [paymentId, order.id, p.amount_minor, i === 0 ? quote.tip_minor : 0, quote.currency, p.method, p.external_reference, intent.idempotency_key || null, intent.actor_id || null]
        );
      } else {
        await tx.run(
          `INSERT INTO payments (session_id, method, amount_minor, tip_minor, currency, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [order.id, p.method, p.amount_minor, i === 0 ? quote.tip_minor : 0, quote.currency, intent.actor_id || null]
        );
      }
    }

    // 7. Transition Order & Table
    if (isV3) {
      await tx.run(
        `UPDATE v3_order_sessions 
         SET status = 'PAID', subtotal_minor = ?, tax_minor = ?, service_minor = ?, discount_minor = ?, tip_minor = ?, total_minor = ?, version = version + 1, updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [quote.subtotal_minor, quote.tax_minor, quote.service_minor, quote.discount_minor, quote.tip_minor, totalDueMinor, order.id]
      );
      if (order.table_id) {
        await tx.run(`UPDATE v3_tables SET status = 'PAID_PENDING_CLEAR', version = version + 1 WHERE id = ?`, [order.table_id]);
      }
    } else {
      await tx.run(
        `UPDATE order_sessions 
         SET status = 'PAID', closed_at = datetime('now', 'localtime'), subtotal_minor = ?, tax_minor = ?, service_minor = ?, discount_minor = ?, tip_minor = ?, total_minor = ?, version = version + 1
         WHERE id = ?`,
        [quote.subtotal_minor, quote.tax_minor, quote.service_minor, quote.discount_minor, quote.tip_minor, totalDueMinor, order.id]
      );
      if (order.table_id) {
        await tx.run(`UPDATE tables SET status = 'PAID_PENDING_CLEAR', paid_at = datetime('now', 'localtime') WHERE id = ?`, [order.table_id]);
      }
    }

    // 8. Enqueue Print Job with SHA-256 hash
    const receiptPayload = {
      order_id: order.id,
      table_id: order.table_id,
      quote,
      payments: paymentAllocations,
      change_owed_minor: changeOwedMinor,
      change_owed: changeOwedMinor / 100,
      timestamp: new Date().toISOString()
    };
    const payloadJson = JSON.stringify(receiptPayload);
    const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');

    try {
      await tx.run(
        `INSERT INTO printer_jobs (id, venue_id, target_printer_id, payload_hash, payload_json, status)
         VALUES (?, ?, 'DEFAULT_CASHIER', ?, ?, 'PENDING')`,
        [`PRN-${Date.now()}`, venueId, payloadHash, payloadJson]
      );
    } catch (e) {}

    try {
      await tx.run(
        `INSERT INTO print_jobs (id, job_type, payload_json, status)
         VALUES (?, 'RECEIPT', ?, 'PENDING')`,
        [`PJ-${Date.now()}`, payloadJson]
      );
    } catch (e) {}

    // 9. Realtime Outbox Event
    try {
      await tx.run(
        `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json)
         VALUES (?, 'ORDER_SETTLED', 'ORDER', ?, ?)`,
        [crypto.randomUUID(), String(order.id), JSON.stringify({ order_id: order.id, total_minor: totalDueMinor, status: 'PAID' })]
      );
    } catch (e) {}

    // 10. Award Loyalty Points
    const customerId = order.customer_id;
    if (customerId) {
      const points = Math.floor(totalDueMinor / 100);
      try {
        await tx.run(
          `INSERT OR IGNORE INTO loyalty_ledger (id, customer_id, change_points, balance_points, reference_type, reference_id)
           VALUES (?, ?, ?, (SELECT COALESCE(loyalty_balance, points, 0) FROM v3_customers WHERE id = ?) + ?, 'SETTLEMENT', ?)`,
          [`LL-${Date.now()}`, customerId, points, customerId, points, order.id]
        );
      } catch (e) {}
    }

    const response = {
      status: 'SUCCESS',
      payment_id: paymentIds[0],
      payment_ids: paymentIds,
      order_id: order.id,
      quote,
      payments: paymentAllocations,
      total_paid_minor: totalProvidedMinor,
      change_owed_minor: changeOwedMinor,
      change_owed: changeOwedMinor / 100
    };

    // 11. Record Idempotency Result
    await saveIdempotencyKey(tx, intent.idempotency_key, intent.actor_id, currentHash, response);

    return response;
  });
}

module.exports = { settleOrder };
