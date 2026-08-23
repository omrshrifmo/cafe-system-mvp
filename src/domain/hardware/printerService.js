const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function processPrinterJob(jobId, success) {
  return runTransaction(async (tx) => {
    const job = await getQuery(`SELECT status, retry_count FROM printer_jobs WHERE id = ?`, [jobId]);
    if (!job) throw new Error('Printer job not found');

    if (job.status === 'ACKNOWLEDGED') {
      return { status: 'ALREADY_ACKNOWLEDGED' }; // Idempotent success
    }

    if (success) {
      await tx.run(`UPDATE printer_jobs SET status = 'ACKNOWLEDGED', updated_at = datetime('now', 'localtime') WHERE id = ?`, [jobId]);
      return { status: 'ACKNOWLEDGED' };
    } else {
      const newRetry = job.retry_count + 1;
      const newStatus = newRetry >= 3 ? 'DEAD_LETTER' : 'FAILED';
      await tx.run(`UPDATE printer_jobs SET status = ?, retry_count = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newStatus, newRetry, jobId]);
      return { status: newStatus };
    }
  });
}

// Simulates checking the order payment status to authorize a drawer kick
async function authorizeDrawerKick(orderSessionId) {
  const payment = await getQuery(`SELECT payment_method FROM v3_payments WHERE order_session_id = ? AND status = 'COMPLETED' LIMIT 1`, [orderSessionId]);
  
  if (!payment) {
    throw new Error('No completed payment found for order. Drawer kick unauthorized.');
  }
  
  if (payment.payment_method !== 'CASH') {
    throw new Error('Only cash settlements authorize a drawer kick.');
  }

  return true;
}

module.exports = { processPrinterJob, authorizeDrawerKick };
