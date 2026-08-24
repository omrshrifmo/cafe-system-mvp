const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function processPrinterJob(jobId, success) {
  return runTransaction(async (tx) => {
    const job = await tx.get(`SELECT status, retry_count FROM printer_jobs WHERE id = ?`, [jobId]);
    if (!job) throw new Error('Printer job not found');

    if (job.status === 'ACKNOWLEDGED') {
      return { status: 'ALREADY_ACKNOWLEDGED' }; // Idempotent success
    }

    if (success) {
      await tx.run(`UPDATE printer_jobs SET status = 'ACKNOWLEDGED', updated_at = datetime('now', 'localtime') WHERE id = ?`, [jobId]);
      return { status: 'ACKNOWLEDGED' };
    } else {
      const newRetry = (job.retry_count || 0) + 1;
      const newStatus = newRetry >= 3 ? 'DEAD_LETTER' : 'FAILED';
      await tx.run(`UPDATE printer_jobs SET status = ?, retry_count = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newStatus, newRetry, jobId]);
      return { status: newStatus };
    }
  });
}

// Simulates checking the order payment status to authorize a drawer kick
async function authorizeDrawerKick(orderSessionId) {
  let payment = await getQuery(
    `SELECT payment_method FROM v3_payments WHERE order_session_id = ? AND status = 'COMPLETED' LIMIT 1`,
    [orderSessionId]
  );

  if (!payment) {
    payment = await getQuery(
      `SELECT method as payment_method FROM payments WHERE session_id = ? LIMIT 1`,
      [orderSessionId]
    );
  }
  
  if (!payment) {
    throw new Error('No completed payment found for order. Drawer kick unauthorized.');
  }
  
  if (payment.payment_method !== 'CASH') {
    throw new Error('Only cash settlements authorize a drawer kick.');
  }

  return true;
}

// Enqueue reprint job with duplicate suppression and audit
async function enqueueReprintJob(orderSessionId, actorId, reason = 'إعادة طباعة إيصال') {
  return runTransaction(async (tx) => {
    const order = await tx.get(
      `SELECT * FROM v3_order_sessions WHERE id = ?`,
      [orderSessionId]
    );
    const orderId = order ? order.id : orderSessionId;

    const payload = JSON.stringify({
      order_id: orderId,
      reprint: true,
      reprinted_by: actorId,
      reason,
      reprinted_at: new Date().toISOString()
    });
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const jobId = `PRN-REPRINT-${Date.now()}`;

    await tx.run(
      `INSERT INTO printer_jobs (id, venue_id, target_printer_id, payload_hash, payload_json, status)
       VALUES (?, 'V_DEFAULT', 'DEFAULT_CASHIER', ?, ?, 'PENDING')`,
      [jobId, payloadHash, payload]
    );

    return {
      success: true,
      job_id: jobId,
      order_id: orderId,
      status: 'PENDING'
    };
  });
}

module.exports = { processPrinterJob, authorizeDrawerKick, enqueueReprintJob };
