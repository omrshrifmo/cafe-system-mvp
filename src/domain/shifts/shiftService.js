const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { isPeriodLocked } = require('./periodService');

async function openShift(venueId, shiftType, businessDate, timezone, openingFloatMinor, actorId) {
  return runTransaction(async (tx) => {
    // Check for existing open shift of any type on this date, or if this specific type is already opened
    const existing = await getQuery(
      `SELECT * FROM v3_shifts WHERE venue_id = ? AND business_date = ? AND shift_type = ?`,
      [venueId, businessDate, shiftType]
    );

    if (existing) {
      if (existing.status !== 'ARCHIVED' && existing.status !== 'CLOSED') {
        throw new Error(`Shift ${shiftType} on ${businessDate} is already in state ${existing.status}`);
      }
      throw new Error(`Shift ${shiftType} on ${businessDate} has already been closed.`);
    }

    const shiftId = `SHF-${Date.now()}`;
    await tx.run(
      `INSERT INTO v3_shifts (id, venue_id, business_date, timezone, shift_type, status, opened_by, opened_at, opening_float_minor)
       VALUES (?, ?, ?, ?, ?, 'OPEN', ?, datetime('now', 'localtime'), ?)`,
      [shiftId, venueId, businessDate, timezone, shiftType, actorId, openingFloatMinor]
    );

    return { status: 'SUCCESS', shift_id: shiftId };
  });
}

async function recordBlindCount(shiftId, countedAmountMinor, actorId, expectedVersion) {
  return runTransaction(async (tx) => {
    const shift = await getQuery(`SELECT status, version FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'OPEN' && shift.status !== 'HANDOVER_PENDING') throw new Error(`Cannot count shift in status ${shift.status}`);
    if (expectedVersion !== undefined && shift.version !== expectedVersion) throw new Error(`Optimistic lock failure`);

    await tx.run(
      `UPDATE v3_shifts SET counted_cash_minor = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [countedAmountMinor, shiftId]
    );

    return { status: 'SUCCESS' };
  });
}

// Calculate the expected cash authoritatively from ledger events
async function calculateExpectedCash(tx, shiftId) {
  const shift = await getQuery(`SELECT opening_float_minor FROM v3_shifts WHERE id = ?`, [shiftId]);
  
  // 1. Cash Sales (from payments during this shift)
  // Note: For strict boundaries, we should query payments linked to orders created within this shift.
  // In a real system, payments themselves might have a shift_id. We will assume we fetch payments by time/shift mapping.
  const salesRow = await getQuery(`
    SELECT COALESCE(SUM(amount_minor + tip_minor), 0) as cash_in 
    FROM v3_payments 
    WHERE payment_method = 'CASH' AND status = 'COMPLETED' 
      AND created_at >= (SELECT opened_at FROM v3_shifts WHERE id = ?)
      AND (created_at <= (SELECT closed_at FROM v3_shifts WHERE id = ?) OR (SELECT closed_at FROM v3_shifts WHERE id = ?) IS NULL)
  `, [shiftId, shiftId, shiftId]);

  // 2. Cash Operations (Expenses, Advances, Withdrawals, Adjustments)
  const opsRow = await getQuery(`
    SELECT 
      COALESCE(SUM(CASE WHEN type IN ('EXPENSE', 'ADVANCE', 'WITHDRAWAL') THEN amount_minor ELSE 0 END), 0) as cash_out,
      COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount_minor ELSE 0 END), 0) as cash_adj
    FROM cash_operations WHERE shift_id = ?
  `, [shiftId]);

  // 3. Refunds (from Reversals ledger)
  const refundRow = await getQuery(`
    SELECT COALESCE(SUM(amount_minor), 0) as cash_refunds
    FROM reversals
    WHERE type = 'REFUND_FULL' AND payment_id IN (
      SELECT id FROM v3_payments WHERE payment_method = 'CASH'
    )
    AND created_at >= (SELECT opened_at FROM v3_shifts WHERE id = ?)
    AND (created_at <= (SELECT closed_at FROM v3_shifts WHERE id = ?) OR (SELECT closed_at FROM v3_shifts WHERE id = ?) IS NULL)
  `, [shiftId, shiftId, shiftId]);

  const expected = shift.opening_float_minor 
                 + salesRow.cash_in 
                 + opsRow.cash_adj 
                 - opsRow.cash_out 
                 - refundRow.cash_refunds;

  return expected;
}

async function closeShift(shiftId, actorId, expectedVersion, role) {
  return runTransaction(async (tx) => {
    const shift = await getQuery(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'OPEN' && shift.status !== 'HANDOVER_PENDING') throw new Error(`Cannot close shift in status ${shift.status}`);
    if (shift.counted_cash_minor === null) throw new Error('Cannot close shift without a blind count');
    if (expectedVersion !== undefined && shift.version !== expectedVersion) throw new Error(`Optimistic lock failure`);

    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) throw new Error('Accounting period is locked. Cannot close shift.');

    // Enforce check: All orders created in this shift must be paid or cancelled
    const openOrders = await getQuery(`
      SELECT COUNT(*) as c FROM v3_order_sessions 
      WHERE branch_id IN (SELECT id FROM branches WHERE venue_id = ?) 
      AND created_at >= ? AND (created_at <= ? OR ? IS NULL)
      AND status NOT IN ('PAID', 'CANCELLED', 'REFUNDED')
    `, [shift.venue_id, shift.opened_at, shift.closed_at, shift.closed_at]);

    if (openOrders.c > 0) {
      throw new Error(`Cannot close shift with ${openOrders.c} open orders. Transfer or close them first.`);
    }

    const expectedCash = await calculateExpectedCash(tx, shiftId);
    const variance = shift.counted_cash_minor - expectedCash;

    await tx.run(
      `UPDATE v3_shifts 
       SET status = 'CLOSED', expected_cash_minor = ?, variance_minor = ?, closed_by = ?, closed_at = datetime('now', 'localtime'), version = version + 1 
       WHERE id = ?`,
      [expectedCash, variance, actorId, shiftId]
    );

    // BLIND CASHIER Check
    let returnData = { status: 'SUCCESS' };
    if (role === 'OWNER' || role === 'MANAGER') {
      returnData.expected_cash_minor = expectedCash;
      returnData.variance_minor = variance;
    } else {
      // Blind mode - variance masked
      returnData.expected_cash_minor = null;
      returnData.variance_minor = null;
    }

    return returnData;
  });
}

async function reopenShift(shiftId, actorId, reason) {
  return runTransaction(async (tx) => {
    const shift = await getQuery(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift || shift.status !== 'CLOSED') throw new Error('Shift is not CLOSED');

    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) throw new Error('Accounting period is locked. Cannot reopen shift.');

    await tx.run(
      `UPDATE v3_shifts SET status = 'REOPENED_BY_APPROVAL', version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [shiftId]
    );

    // Audit log reason in a real app, here we rely on the state transition indicating the approval happened.
    return { status: 'SUCCESS' };
  });
}

module.exports = { openShift, recordBlindCount, calculateExpectedCash, closeShift, reopenShift };
