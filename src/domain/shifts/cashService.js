const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { isPeriodLocked } = require('./periodService');

/**
 * Records an authorized cash operation (EXPENSE, ADVANCE, WITHDRAWAL, ADJUSTMENT)
 */
async function recordCashOperation(venueId, shiftId, type, amountMinor, reason, actorId, approvalActorId) {
  return runTransaction(async (tx) => {
    const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ? AND venue_id = ?`, [shiftId, venueId]);
    if (!shift) {
      const err = new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (shift.status !== 'OPEN' && shift.status !== 'HANDOVER_PENDING' && shift.status !== 'REOPENED_BY_APPROVAL') {
      const err = new Error(`INVALID_STATE: لا يمكن تسجيل عمليات نقدية على وردية بحالة [${shift.status}]`);
      err.statusCode = 400;
      throw err;
    }

    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) {
      const err = new Error(`PERIOD_LOCKED: الفترة المحاسبية لتاريخ [${shift.business_date}] مغلقة`);
      err.statusCode = 400;
      throw err;
    }

    if (!approvalActorId && type !== 'ADJUSTMENT') {
      const err = new Error(`APPROVAL_REQUIRED: تتطلب العملية النقدية [${type}] اعتماداً إدارياً`);
      err.statusCode = 403;
      throw err;
    }

    const opId = `CSH-${type}-${Date.now()}`;
    await tx.run(
      `INSERT INTO cash_operations (id, venue_id, shift_id, type, amount_minor, reason, actor_id, approval_actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [opId, venueId, shiftId, type, Math.round(amountMinor), reason, actorId, approvalActorId || actorId]
    );

    return {
      status: 'SUCCESS',
      operation_id: opId,
      shift_id: shiftId,
      type,
      amount_minor: Math.round(amountMinor)
    };
  });
}

module.exports = { recordCashOperation };
