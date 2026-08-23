const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { isPeriodLocked } = require('./periodService');

async function recordCashOperation(venueId, shiftId, type, amountMinor, reason, actorId, approvalActorId) {
  return runTransaction(async (tx) => {
    const shift = await getQuery(`SELECT * FROM v3_shifts WHERE id = ? AND venue_id = ?`, [shiftId, venueId]);
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'OPEN' && shift.status !== 'HANDOVER_PENDING' && shift.status !== 'REOPENED_BY_APPROVAL') {
      throw new Error(`Cannot record cash operation on shift in status ${shift.status}`);
    }

    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) throw new Error('Accounting period is locked. Cannot record cash operation.');

    if (!approvalActorId && type !== 'ADJUSTMENT') {
       throw new Error(`Cash operation ${type} requires an approval actor`);
    }

    const opId = `CSH-${Date.now()}`;
    await tx.run(
      `INSERT INTO cash_operations (id, venue_id, shift_id, type, amount_minor, reason, actor_id, approval_actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [opId, venueId, shiftId, type, amountMinor, reason, actorId, approvalActorId || actorId]
    );

    return { status: 'SUCCESS', operation_id: opId };
  });
}

module.exports = { recordCashOperation };
