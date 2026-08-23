const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function processReversal(venueId, sessionId, reversalData) {
  return runTransaction(async (tx) => {
    // 1. Verify session
    const order = await getQuery(`SELECT status FROM v3_order_sessions WHERE id = ? AND branch_id IN (SELECT id FROM branches WHERE venue_id = ?)`, [sessionId, venueId]);
    if (!order) throw new Error('Order not found or venue mismatch');

    // 2. Validate paths
    if (reversalData.type === 'REFUND_FULL' || reversalData.type === 'VOID_PAID') {
      if (order.status !== 'PAID') {
        throw new Error(`Cannot perform ${reversalData.type} on order in status ${order.status}`);
      }
      if (!reversalData.payment_id) {
        throw new Error('Payment ID is required for paid reversals');
      }
    } else if (reversalData.type === 'CANCELLED_UNPAID' || reversalData.type === 'VOID_UNPAID') {
      if (order.status === 'PAID') {
        throw new Error(`Cannot perform unpaid reversal on PAID order`);
      }
    } else {
      throw new Error(`Unknown reversal type: ${reversalData.type}`);
    }

    // 3. Permission checks (Simplified - in prod, query actor_id roles)
    if (!reversalData.approval_actor_id) {
      throw new Error('Approval actor is required for financial reversals');
    }

    // 4. Record Immutable Ledger Event
    const reversalId = `REV-${Date.now()}`;
    await tx.run(
      `INSERT INTO reversals (id, venue_id, order_session_id, payment_id, type, reason, amount_minor, actor_id, approval_actor_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reversalId, venueId, sessionId, 
        reversalData.payment_id || null, 
        reversalData.type, 
        reversalData.reason, 
        reversalData.amount_minor, 
        reversalData.actor_id, 
        reversalData.approval_actor_id, 
        reversalData.idempotency_key || null
      ]
    );

    // 5. Update Order Status (optional depending on exact business logic)
    // Often VOID means transitioning back or moving to a terminal VOIDED state.
    // Assuming standard terminal state 'CANCELLED' for unpaid, 'REFUNDED' for full refund.
    let newStatus = order.status;
    if (reversalData.type === 'CANCELLED_UNPAID' || reversalData.type === 'VOID_UNPAID') {
      newStatus = 'CANCELLED';
    } else if (reversalData.type === 'REFUND_FULL' || reversalData.type === 'VOID_PAID') {
      newStatus = 'REFUNDED';
    }

    if (newStatus !== order.status) {
      // NOTE: We omit strict optimistic lock `version` checking here for simplicity 
      // but in prod we would pass expectedVersion.
      await tx.run(`UPDATE v3_order_sessions SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newStatus, sessionId]);
    }

    return { status: 'SUCCESS', reversal_id: reversalId };
  });
}

module.exports = { processReversal };
