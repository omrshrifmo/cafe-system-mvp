/**
 * Shift Domain Engine & Canonical Cash Reconciliation
 */
const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { isPeriodLocked } = require('./periodService');
const logger = require('../../observability/logger');

// Canonical Shift Statuses
const SHIFT_STATUSES = {
  PLANNED: 'PLANNED',
  OPEN: 'OPEN',
  HANDOVER_PENDING: 'HANDOVER_PENDING',
  CLOSED: 'CLOSED',
  REOPENED_BY_APPROVAL: 'REOPENED_BY_APPROVAL',
  ARCHIVED: 'ARCHIVED'
};

/**
 * Open a new shift (MORNING, NIGHT, ALL_DAY)
 */
async function openShift(venueId, shiftType, businessDate, timezone = 'UTC', openingFloatMinor = 0, actorId = null, assignedStaff = [], assignedDevices = []) {
  return runTransaction(async (tx) => {
    // 1. Check if accounting period is locked for this business date
    const locked = await isPeriodLocked(tx, venueId, businessDate, 'DAILY');
    if (locked) {
      const err = new Error(`PERIOD_LOCKED: الفترة المحاسبية لتاريخ [${businessDate}] مغلقة ومقفلة`);
      err.statusCode = 400;
      throw err;
    }

    // 2. Check for existing active or already closed shift of this type on this business date
    const existing = await tx.get(
      `SELECT * FROM v3_shifts WHERE venue_id = ? AND business_date = ? AND shift_type = ?`,
      [venueId, businessDate, shiftType]
    );

    if (existing) {
      if (existing.status === SHIFT_STATUSES.OPEN || existing.status === SHIFT_STATUSES.HANDOVER_PENDING) {
        const err = new Error(`SHIFT_ALREADY_OPEN: الوردية (${shiftType}) لتاريخ ${businessDate} مفتوحة بالفعل [${existing.id}]`);
        err.statusCode = 409;
        throw err;
      }
      if (existing.status === SHIFT_STATUSES.CLOSED) {
        const err = new Error(`SHIFT_ALREADY_CLOSED: الوردية (${shiftType}) لتاريخ ${businessDate} مغلقة مسبقاً [${existing.id}]`);
        err.statusCode = 409;
        throw err;
      }
    }

    const shiftId = `SHF-${shiftType}-${businessDate}-${Date.now().toString(36).toUpperCase()}`;
    const nowIso = new Date().toISOString();

    await tx.run(
      `INSERT INTO v3_shifts (
        id, venue_id, business_date, timezone, shift_type, status,
        opened_by, opened_at, opening_float_minor, version, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'OPEN',
        ?, datetime('now', 'localtime'), ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime')
      )`,
      [shiftId, venueId, businessDate, timezone, shiftType, actorId, Math.round(openingFloatMinor)]
    );

    // Persist outbox event
    const eventId = `EVT-SHF-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      shift_id: shiftId,
      shift_type: shiftType,
      business_date: businessDate,
      venue_id: venueId,
      opening_float_minor: Math.round(openingFloatMinor),
      opened_by: actorId,
      status: 'OPEN',
      created_at: nowIso
    };

    const seqRow = await tx.get(`SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?`, [venueId]);
    await tx.run(
      `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status)
       VALUES (?, 'SHIFT_OPENED', 'SHIFT', ?, ?, ?, 1, 'v1', ?, 'MANAGER', 'PENDING')`,
      [eventId, shiftId, JSON.stringify(payload), seqRow ? seqRow.seq : 1, venueId]
    );

    return {
      status: 'SUCCESS',
      shift_id: shiftId,
      shift_type: shiftType,
      business_date: businessDate,
      opening_float_minor: Math.round(openingFloatMinor),
      version: 1
    };
  });
}

/**
 * Capture Handover Snapshot for shift transition
 */
async function recordShiftHandover(shiftId, actorId) {
  return runTransaction(async (tx) => {
    const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) {
      const err = new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (shift.status !== SHIFT_STATUSES.OPEN && shift.status !== SHIFT_STATUSES.HANDOVER_PENDING) {
      const err = new Error(`INVALID_STATE: لا يمكن تسليم وردية بحالة [${shift.status}]`);
      err.statusCode = 400;
      throw err;
    }

    // Capture comprehensive floor snapshot
    const openOrders = await tx.all(
      `SELECT id, table_id, status, created_at FROM v3_order_sessions
       WHERE status NOT IN ('PAID', 'CANCELLED', 'REFUNDED')`
    );

    const pendingKdsLines = await tx.all(
      `SELECT l.id, l.kds_order_id, l.state, o.station_id
       FROM kds_order_lines l
       JOIN kds_orders o ON l.kds_order_id = o.id
       WHERE l.state NOT IN ('COLLECTED', 'CANCELLED', 'DELIVERED')`
    );

    const openRunnerTasks = await tx.all(
      `SELECT id, task_type, status, priority FROM runner_tasks
       WHERE status != 'COMPLETED' AND status != 'CANCELLED'`
    );

    const occupiedTables = await tx.all(
      `SELECT id, table_number, capacity, status FROM v3_tables WHERE status != 'VACANT'`
    );

    const cashOps = await tx.all(
      `SELECT id, type, amount_minor, reason, actor_id FROM cash_operations WHERE shift_id = ?`,
      [shiftId]
    );

    const snapshot = {
      shift_id: shiftId,
      shift_type: shift.shift_type,
      business_date: shift.business_date,
      handover_time: new Date().toISOString(),
      open_orders_count: openOrders.length,
      open_orders: openOrders,
      pending_kds_count: pendingKdsLines.length,
      pending_kds_lines: pendingKdsLines,
      open_runner_tasks_count: openRunnerTasks.length,
      open_runner_tasks: openRunnerTasks,
      occupied_tables_count: occupiedTables.length,
      occupied_tables: occupiedTables,
      cash_operations_count: cashOps.length,
      cash_operations: cashOps
    };

    const handoverId = `HND-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await tx.run(
      `INSERT INTO shift_handovers (id, shift_id, snapshot_json, created_by, created_at)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`,
      [handoverId, shiftId, JSON.stringify(snapshot), actorId]
    );

    const newVersion = shift.version + 1;
    await tx.run(
      `UPDATE v3_shifts 
       SET status = 'HANDOVER_PENDING', version = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [newVersion, shiftId]
    );

    return {
      status: 'SUCCESS',
      handover_id: handoverId,
      shift_id: shiftId,
      snapshot,
      version: newVersion
    };
  });
}

/**
 * Record blind cash count by Cashier (no expected cash or variance exposed to cashier)
 */
async function recordBlindCount(shiftId, countedAmountMinor, actorId, expectedVersion = null) {
  return runTransaction(async (tx) => {
    const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) {
      const err = new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (shift.status !== SHIFT_STATUSES.OPEN && shift.status !== SHIFT_STATUSES.HANDOVER_PENDING) {
      const err = new Error(`INVALID_STATE: لا يمكن إدخال جرد نقدي لوردية بحالة [${shift.status}]`);
      err.statusCode = 400;
      throw err;
    }

    if (expectedVersion !== undefined && expectedVersion !== null && shift.version !== expectedVersion) {
      const err = new Error(`OPTIMISTIC_LOCK_FAILURE: تعارض في إصدار الوردية (المتوقع: ${expectedVersion}، الحالي: ${shift.version})`);
      err.statusCode = 409;
      throw err;
    }

    const newVersion = shift.version + 1;
    await tx.run(
      `UPDATE v3_shifts 
       SET counted_cash_minor = ?, version = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [Math.round(countedAmountMinor), newVersion, shiftId]
    );

    return {
      status: 'SUCCESS',
      shift_id: shiftId,
      counted_cash_minor: Math.round(countedAmountMinor),
      version: newVersion
    };
  });
}

/**
 * Authoritative Canonical Cash Reconciliation Formula:
 * expected_cash = opening_float + posted_cash_payments + retained_cash_tips 
 *               - approved_cash_expenses - approved_cash_advances - approved_cash_withdrawals 
 *               + approved_adjustments - cash_refunds
 */
async function calculateExpectedCash(tx, shiftId) {
  const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
  if (!shift) throw new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);

  const openingFloat = shift.opening_float_minor || 0;

  // 1. Posted Cash Payments & Retained Cash Tips
  const cashPaymentsRow = await tx.get(
    `SELECT 
       COALESCE(SUM(amount_minor), 0) as cash_sales,
       COALESCE(SUM(tip_minor), 0) as cash_tips
     FROM v3_payments 
     WHERE payment_method = 'CASH' AND status = 'COMPLETED'
       AND created_at >= ? 
       AND (created_at <= ? OR ? IS NULL)`,
    [shift.opened_at, shift.closed_at, shift.closed_at]
  );

  const postedCashSales = cashPaymentsRow ? cashPaymentsRow.cash_sales : 0;
  const retainedCashTips = cashPaymentsRow ? cashPaymentsRow.cash_tips : 0;

  // 2. Cash Operations (Expenses, Advances, Withdrawals, Adjustments)
  const opsRow = await tx.get(
    `SELECT 
       COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount_minor ELSE 0 END), 0) as expenses,
       COALESCE(SUM(CASE WHEN type = 'ADVANCE' THEN amount_minor ELSE 0 END), 0) as advances,
       COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount_minor ELSE 0 END), 0) as withdrawals,
       COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount_minor ELSE 0 END), 0) as adjustments
     FROM cash_operations 
     WHERE shift_id = ?`,
    [shiftId]
  );

  const approvedExpenses = opsRow ? opsRow.expenses : 0;
  const approvedAdvances = opsRow ? opsRow.advances : 0;
  const approvedWithdrawals = opsRow ? opsRow.withdrawals : 0;
  const approvedAdjustments = opsRow ? opsRow.adjustments : 0;

  // 3. Cash Refunds
  const refundRow = await tx.get(
    `SELECT COALESCE(SUM(amount_minor), 0) as refunds
     FROM reversals
     WHERE type IN ('REFUND_FULL', 'REFUND_PARTIAL')
       AND payment_id IN (
         SELECT id FROM v3_payments WHERE payment_method = 'CASH'
       )
       AND (
         created_at >= ?
         AND (created_at <= ? OR ? IS NULL)
       )`,
    [shift.opened_at, shift.closed_at, shift.closed_at]
  );

  const cashRefunds = refundRow ? refundRow.refunds : 0;

  // Final expected cash
  const expectedCash = openingFloat 
                     + postedCashSales 
                     + retainedCashTips 
                     - approvedExpenses 
                     - approvedAdvances 
                     - approvedWithdrawals 
                     + approvedAdjustments 
                     - cashRefunds;

  return {
    opening_float_minor: openingFloat,
    posted_cash_sales_minor: postedCashSales,
    retained_cash_tips_minor: retainedCashTips,
    approved_expenses_minor: approvedExpenses,
    approved_advances_minor: approvedAdvances,
    approved_withdrawals_minor: approvedWithdrawals,
    approved_adjustments_minor: approvedAdjustments,
    cash_refunds_minor: cashRefunds,
    expected_cash_minor: expectedCash
  };
}

/**
 * Close Shift with Full Authoritative Reconciled Validation & Z-Report Spooling
 */
async function closeShift(shiftId, actorId, expectedVersion = null, userRole = 'CASHIER') {
  return runTransaction(async (tx) => {
    const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) {
      const err = new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (shift.status === SHIFT_STATUSES.CLOSED) {
      const err = new Error(`SHIFT_ALREADY_CLOSED: الوردية مغلقة مسبقاً [${shiftId}]`);
      err.statusCode = 409;
      throw err;
    }

    if (shift.status !== SHIFT_STATUSES.OPEN && shift.status !== SHIFT_STATUSES.HANDOVER_PENDING) {
      const err = new Error(`INVALID_STATE: لا يمكن إغلاق الوردية بحالتها الحالية [${shift.status}]`);
      err.statusCode = 400;
      throw err;
    }

    if (shift.counted_cash_minor === null || shift.counted_cash_minor === undefined) {
      const err = new Error(`COUNT_REQUIRED: يلزم إدخال الجرد الفعلي للنقدية أولاً قبل إغلاق الوردية`);
      err.statusCode = 400;
      throw err;
    }

    if (expectedVersion !== undefined && expectedVersion !== null && shift.version !== expectedVersion) {
      const err = new Error(`OPTIMISTIC_LOCK_FAILURE: تعارض في إصدار الوردية (المتوقع: ${expectedVersion}، الحالي: ${shift.version})`);
      err.statusCode = 409;
      throw err;
    }

    // Check accounting period lock
    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) {
      const err = new Error(`PERIOD_LOCKED: الفترة المحاسبية لتاريخ [${shift.business_date}] مغلقة ومقفلة`);
      err.statusCode = 400;
      throw err;
    }

    // Check unhandled/unpaid orders
    const openOrders = await tx.get(
      `SELECT COUNT(*) as cnt FROM v3_order_sessions
       WHERE created_at >= ?
         AND (created_at <= datetime('now', 'localtime'))
         AND status NOT IN ('PAID', 'CANCELLED', 'REFUNDED')`,
      [shift.opened_at]
    );

    if (openOrders && openOrders.cnt > 0) {
      const err = new Error(`OPEN_ORDERS_PENDING: لا يمكن إغلاق الوردية مع وجود (${openOrders.cnt}) طلبات غير مسواة أو معلقة`);
      err.statusCode = 400;
      throw err;
    }

    // Calculate cash reconciliation
    const recon = await calculateExpectedCash(tx, shiftId);
    const expectedCash = recon.expected_cash_minor;
    const countedCash = shift.counted_cash_minor;
    const variance = countedCash - expectedCash;

    const newVersion = shift.version + 1;
    const nowIso = new Date().toISOString();

    await tx.run(
      `UPDATE v3_shifts 
       SET status = 'CLOSED', expected_cash_minor = ?, variance_minor = ?,
           closed_by = ?, closed_at = datetime('now', 'localtime'),
           version = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [expectedCash, variance, actorId, newVersion, shiftId]
    );

    // Spool Z-Report in printer jobs
    const zReportPayload = {
      shift_id: shiftId,
      shift_type: shift.shift_type,
      business_date: shift.business_date,
      opened_at: shift.opened_at,
      closed_at: nowIso,
      closed_by: actorId,
      reconciliation: {
        ...recon,
        counted_cash_minor: countedCash,
        variance_minor: variance
      }
    };

    const jobId = `PJ-Z-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const zPayloadStr = JSON.stringify(zReportPayload);
    const zHash = crypto.createHash('sha256').update(zPayloadStr).digest('hex');

    await tx.run(
      `INSERT INTO printer_jobs (id, venue_id, target_printer_id, payload_hash, payload_json, status, retry_count, created_at, updated_at)
       VALUES (?, ?, 'PRN-MANAGER', ?, ?, 'PENDING', 0, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [jobId, shift.venue_id, zHash, zPayloadStr]
    );

    // Mask variance for Cashiers if role is not privileged
    const isPrivileged = ['OWNER', 'MANAGER', 'OP_MANAGER', 'SUPER_ADMIN', 'R_OWNER', 'R_MANAGER'].includes((userRole || '').toUpperCase());

    return {
      status: 'SUCCESS',
      shift_id: shiftId,
      shift_status: 'CLOSED',
      version: newVersion,
      closed_at: nowIso,
      z_report_job_id: jobId,
      counted_cash_minor: countedCash,
      expected_cash_minor: isPrivileged ? expectedCash : null,
      variance_minor: isPrivileged ? variance : null,
      reconciliation: isPrivileged ? recon : null
    };
  });
}

/**
 * Reopen a Closed Shift (Requires Owner/Manager Authorization)
 */
async function reopenShift(shiftId, actorId, reason, userRole = 'OWNER') {
  return runTransaction(async (tx) => {
    const isPrivileged = ['OWNER', 'MANAGER', 'OP_MANAGER', 'SUPER_ADMIN', 'R_OWNER', 'R_MANAGER'].includes((userRole || '').toUpperCase());
    if (!isPrivileged) {
      const err = new Error(`FORBIDDEN: يلزم صلاحية المالك أو المدير لإعادة فتح وردية مغلقة`);
      err.statusCode = 403;
      throw err;
    }

    const shift = await tx.get(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
    if (!shift) {
      const err = new Error(`NOT_FOUND: الوردية غير موجودة [${shiftId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (shift.status !== SHIFT_STATUSES.CLOSED) {
      const err = new Error(`INVALID_STATE: لا يمكن إعادة فتح وردية بحالة [${shift.status}] - يجب أن تكون مغلقة`);
      err.statusCode = 400;
      throw err;
    }

    const isLocked = await isPeriodLocked(tx, shift.venue_id, shift.business_date, 'DAILY');
    if (isLocked) {
      const err = new Error(`PERIOD_LOCKED: لا يمكن إعادة فتح الوردية لأن الفترة المحاسبية مقفلة`);
      err.statusCode = 400;
      throw err;
    }

    const newVersion = shift.version + 1;
    await tx.run(
      `UPDATE v3_shifts 
       SET status = 'REOPENED_BY_APPROVAL', version = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [newVersion, shiftId]
    );

    return {
      status: 'SUCCESS',
      shift_id: shiftId,
      shift_status: 'REOPENED_BY_APPROVAL',
      reason,
      reopened_by: actorId,
      version: newVersion
    };
  });
}

/**
 * Get active/current open shift for a venue
 */
async function getActiveShift(venueId = 'V_DEFAULT') {
  const shift = await getQuery(
    `SELECT * FROM v3_shifts 
     WHERE venue_id = ? AND status IN ('OPEN', 'HANDOVER_PENDING', 'REOPENED_BY_APPROVAL')
     ORDER BY created_at DESC LIMIT 1`,
    [venueId]
  );
  return shift || null;
}

/**
 * Get shift by ID with role-based masking
 */
async function getShiftById(shiftId, userRole = 'CASHIER') {
  const shift = await getQuery(`SELECT * FROM v3_shifts WHERE id = ?`, [shiftId]);
  if (!shift) return null;

  const isPrivileged = ['OWNER', 'MANAGER', 'OP_MANAGER', 'SUPER_ADMIN', 'R_OWNER', 'R_MANAGER'].includes((userRole || '').toUpperCase());

  // If cashier and shift is not yet closed/counted, mask expected cash and variance
  if (!isPrivileged && shift.status !== 'CLOSED') {
    return {
      ...shift,
      expected_cash_minor: null,
      variance_minor: null
    };
  }

  return shift;
}

module.exports = {
  SHIFT_STATUSES,
  openShift,
  recordShiftHandover,
  recordBlindCount,
  calculateExpectedCash,
  closeShift,
  reopenShift,
  getActiveShift,
  getShiftById
};
