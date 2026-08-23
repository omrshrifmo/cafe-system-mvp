const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function recordAdjustment(userId, type, amountMinor, reason, effectiveDate, actorId, approvalActorId) {
  return runTransaction(async (tx) => {
    // If effectiveDate is in a locked payroll period, we shouldn't allow it. 
    // However, corrections to locked payrolls must be appended to the NEXT open payroll period.
    // So effectiveDate should represent the date it is applied, not necessarily when the event occurred.
    
    // We check if the effective date falls into a locked payroll period
    const lockedPeriod = await getQuery(`
      SELECT id FROM payroll_periods 
      WHERE start_date <= ? AND end_date >= ? AND status IN ('LOCKED', 'PAID')
      AND venue_id = (SELECT venue_id FROM v3_users WHERE id = ?)
    `, [effectiveDate, effectiveDate, userId]);

    if (lockedPeriod) {
      throw new Error(`Effective date falls within a locked payroll period. Please apply this adjustment to an open period.`);
    }

    const adjustmentId = `ADJ-${Date.now()}`;
    await tx.run(
      `INSERT INTO hr_adjustments (id, user_id, type, amount_minor, reason, effective_date, actor_id, approval_actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [adjustmentId, userId, type, amountMinor, reason, effectiveDate, actorId, approvalActorId]
    );

    return { status: 'SUCCESS', adjustment_id: adjustmentId };
  });
}

// Internal function to bind adjustments to a period during calculation
async function bindAdjustmentsToPeriod(tx, userId, periodStartDate, periodEndDate, periodId) {
    // Find unassigned adjustments in date range and link them
    await tx.run(`
        UPDATE hr_adjustments 
        SET payroll_period_id = ?
        WHERE user_id = ? AND effective_date >= ? AND effective_date <= ? AND payroll_period_id IS NULL
    `, [periodId, userId, periodStartDate, periodEndDate]);
}

module.exports = { recordAdjustment, bindAdjustmentsToPeriod };
