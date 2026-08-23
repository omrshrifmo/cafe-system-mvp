const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const crypto = require('crypto');
const { computeQuote } = require('./quoteService');
const { awardLoyaltyPoints } = require('../hospitality/crmService');
// Mock dependency for BOM consumption (InventoryLedgerService would be here)

async function settleOrder(sessionId, intent, expectedVersion) {
  return runTransaction(async (tx) => {
    // 1. Idempotency Check
    if (intent.idempotency_key) {
      const existing = await getQuery(`SELECT response_body, payload_hash FROM idempotency_keys WHERE key = ?`, [intent.idempotency_key]);
      
      const currentHash = crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');
      
      if (existing) {
        if (existing.payload_hash !== currentHash) {
          throw new Error('IDEMPOTENCY_MISMATCH');
        }
        return JSON.parse(existing.response_body);
      }
    }

    // 2. State & Version Lock
    const order = await getQuery(`SELECT * FROM v3_order_sessions WHERE id = ?`, [sessionId]);
    if (!order) throw new Error('Order not found');
    if (order.version !== expectedVersion) throw new Error(`Optimistic lock failure: Version mismatch. Expected ${expectedVersion}, got ${order.version}`);
    
    // Allow settling from OPEN or PAYMENT_PENDING
    if (!['OPEN', 'PAYMENT_PENDING'].includes(order.status)) {
      throw new Error(`Cannot settle order in status: ${order.status}`);
    }

    // 3. Recompute Quote Authoritatively
    // To do this strictly, we would normally rebuild `orderIntent` from DB lines.
    // For this demonstration, we'll assume `intent.lines` matches the DB line state.
    const quote = await computeQuote({
      lines: intent.lines,
      discount_minor: intent.discount_minor,
      tip_minor: intent.tip_minor
    });

    if (quote.total_due_minor !== intent.amount_minor) {
      throw new Error(`Payment amount mismatch. Quote total: ${quote.total_due_minor}, Provided: ${intent.amount_minor}`);
    }

    // 4. Record Payment
    const paymentId = `PAY-${Date.now()}`;
    await tx.run(
      `INSERT INTO v3_payments (id, order_session_id, amount_minor, tip_minor, currency, payment_method, external_reference, idempotency_key, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`,
      [paymentId, sessionId, quote.total_due_minor, quote.tip_minor, quote.currency, intent.payment_method, intent.external_reference, intent.idempotency_key, intent.actor_id]
    );

    // 5. Transition Order & Table
    await tx.run(
      `UPDATE v3_order_sessions 
       SET status = 'PAID', subtotal_minor = ?, tax_minor = ?, service_minor = ?, discount_minor = ?, tip_minor = ?, total_minor = ?, version = version + 1, updated_at = datetime('now', 'localtime')
       WHERE id = ? AND version = ?`,
      [quote.subtotal_minor, quote.tax_minor, quote.service_minor, quote.discount_minor, quote.tip_minor, quote.total_due_minor, sessionId, expectedVersion]
    );

    if (order.table_id) {
      await tx.run(`UPDATE v3_tables SET status = 'PAID_PENDING_CLEAR', version = version + 1 WHERE id = ?`, [order.table_id]);
    }

    // 6. Deduct BOM (Mock call to InventoryLedger)
    // await InventoryLedgerService.deductBOM(tx, quote.lines);

    // 7. Enqueue Printer/Outbox Job
    const payloadJson = JSON.stringify({ order_id: sessionId, quote });
    const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
    await tx.run(
      `INSERT INTO printer_jobs (id, venue_id, target_printer_id, payload_hash, payload_json) VALUES (?, ?, ?, ?, ?)`,
      [`PRN-${Date.now()}`, intent.venue_id, 'DEFAULT_CASHIER', payloadHash, payloadJson]
    );

    // 8. Loyalty Award (if customer attached)
    if (order.customer_id) {
      const points = Math.floor(quote.total_due_minor / 100); // 1 point per 1 EGP
      // Note: We normally inject tx into awardLoyaltyPoints, but for simplicity here we rely on it handling its own tx if needed,
      // or we inline it. In production, CRM service would accept the active `tx`.
      await tx.run(
        `INSERT INTO loyalty_ledger (id, customer_id, change_points, balance_points, reference_type, reference_id)
         VALUES (?, ?, ?, (SELECT loyalty_balance FROM v3_customers WHERE id = ?) + ?, 'SETTLEMENT', ?)`,
        [`LL-${Date.now()}`, order.customer_id, points, order.customer_id, points, sessionId]
      );
      await tx.run(`UPDATE v3_customers SET loyalty_balance = loyalty_balance + ? WHERE id = ?`, [points, order.customer_id]);
    }

    const response = { status: 'SUCCESS', payment_id: paymentId, quote };

    // 9. Save Idempotency
    if (intent.idempotency_key) {
      const currentHash = crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');
      await tx.run(
        `INSERT INTO idempotency_keys (key, response_body, payload_hash) VALUES (?, ?, ?)`,
        [intent.idempotency_key, JSON.stringify(response), currentHash]
      );
    }

    return response;
  });
}

module.exports = { settleOrder };
