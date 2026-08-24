/**
 * Canonical Table Lifecycle & Hospitality Domain Service
 * Enforces optimistic concurrency, immutable lifecycle events, and exact server state.
 */
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

const CANONICAL_TABLE_STATES = [
  'AVAILABLE',
  'HELD_FOR_RESERVATION',
  'OCCUPIED',
  'ORDER_OPEN',
  'REQUESTED_CHECK',
  'PAYMENT_PENDING',
  'PAID_PENDING_CLEAR',
  'CLEANING',
  'OUT_OF_SERVICE'
];

/**
 * Maps legacy status to canonical status
 */
function normalizeTableStatus(status) {
  if (!status) return 'AVAILABLE';
  const s = String(status).toUpperCase();
  if (s === 'VACANT') return 'AVAILABLE';
  if (s === 'SEATED' || s === 'OPENED') return 'OCCUPIED';
  if (s === 'ORDERED' || s === 'REORDERED' || s === 'WAITER_APPROACHED' || s === 'REAPPROACHED') return 'ORDER_OPEN';
  if (s === 'CHECK_REQUESTED') return 'REQUESTED_CHECK';
  if (s === 'PAID') return 'PAID_PENDING_CLEAR';
  if (CANONICAL_TABLE_STATES.includes(s)) return s;
  return 'AVAILABLE';
}

/**
 * Get all tables with consolidated counters and live session details
 */
async function getAllTables() {
  const sql = `
    SELECT t.id, t.table_number, t.custom_name, t.customer_name, t.customer_phone,
           t.guest_count, t.status, t.zone, t.capacity, t.version,
           t.opened_by_user_id, t.shift_id, t.device_id, t.turnover_count,
           t.seated_at, t.first_ordered_at, t.last_ordered_at, t.check_requested_at, t.paid_at, t.vacated_at,
           ROUND((julianday('now', 'localtime') - julianday(COALESCE(t.seated_at, datetime('now', 'localtime')))) * 1440) as seated_minutes,
           ROUND((julianday('now', 'localtime') - julianday(t.check_requested_at)) * 1440) as check_requested_minutes,
           ROUND((julianday('now', 'localtime') - julianday(t.paid_at)) * 1440) as paid_minutes,
           ROUND((julianday('now', 'localtime') - julianday(COALESCE(t.last_ordered_at, t.seated_at, datetime('now', 'localtime')))) * 1440) as idle_minutes,
           COUNT(DISTINCT oi.id) as active_items_count,
           COALESCE(SUM(CASE WHEN oi.status = 'ACTIVE' THEN (oi.unit_price_minor * oi.quantity) / 100.0 ELSE 0 END), 0) as active_total_amount
    FROM tables t
    LEFT JOIN order_sessions os ON t.id = os.table_id AND os.status IN ('OPEN', 'PENDING_PAYMENT')
    LEFT JOIN order_items oi ON os.id = oi.session_id AND oi.status = 'ACTIVE'
    GROUP BY t.id
    ORDER BY t.table_number ASC
  `;
  const rawTables = await allQuery(sql);

  const tables = rawTables.map(t => {
    const canonicalStatus = normalizeTableStatus(t.status);
    const isAvailable = canonicalStatus === 'AVAILABLE' || canonicalStatus === 'CLEANING' || canonicalStatus === 'OUT_OF_SERVICE';

    return {
      ...t,
      status: canonicalStatus,
      raw_status: t.status,
      version: t.version || 1,
      customer_name: isAvailable ? null : t.customer_name,
      customer_phone: isAvailable ? null : t.customer_phone,
      custom_name: t.custom_name || `طاولة ${t.table_number}`,
      seated_minutes: !isAvailable && t.seated_at && t.seated_minutes > 0 ? Math.round(t.seated_minutes) : null,
      check_requested_minutes: !isAvailable && t.check_requested_at && t.check_requested_minutes > 0 ? Math.round(t.check_requested_minutes) : null,
      paid_minutes: !isAvailable && t.paid_at && t.paid_minutes > 0 ? Math.round(t.paid_minutes) : null,
      idle_minutes: !isAvailable && t.idle_minutes > 0 ? Math.round(t.idle_minutes) : 0,
      active_items_count: isAvailable ? 0 : (t.active_items_count || 0),
      active_total_amount: isAvailable ? 0 : (t.active_total_amount || 0)
    };
  });

  const stats = {
    total: tables.length,
    available: tables.filter(t => t.status === 'AVAILABLE').length,
    occupied: tables.filter(t => t.status === 'OCCUPIED' || t.status === 'ORDER_OPEN').length,
    requested_check: tables.filter(t => t.status === 'REQUESTED_CHECK').length,
    payment_pending: tables.filter(t => t.status === 'PAYMENT_PENDING' || t.status === 'PAID_PENDING_CLEAR').length,
    held_for_reservation: tables.filter(t => t.status === 'HELD_FOR_RESERVATION').length,
    cleaning: tables.filter(t => t.status === 'CLEANING').length,
    out_of_service: tables.filter(t => t.status === 'OUT_OF_SERVICE').length
  };

  return { tables, stats };
}

/**
 * Open Table Session with Full Metadata, Optimistic Lock, and Event Audit
 */
async function openTable({
  table_number,
  guest_count = 2,
  custom_name = null,
  customer_name = null,
  customer_phone = null,
  venue_id = 'V_DEFAULT',
  device_id = null,
  actor_id = null,
  shift_id = null,
  expected_version = null
}) {
  const tNum = parseInt(table_number, 10);
  if (!tNum || tNum <= 0) throw new Error('رقم الطاولة مطلوب وغير صحيح');
  const count = Math.max(1, parseInt(guest_count, 10) || 2);

  return runTransaction(async (tx) => {
    let table = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [tNum]);
    if (!table) {
      const res = await tx.run(
        `INSERT INTO tables (table_number, custom_name, customer_name, customer_phone, guest_count, status, version, created_at)
         VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1, datetime('now', 'localtime'))`,
        [tNum, custom_name, customer_name, customer_phone, count]
      );
      table = { id: res.lastID, table_number: tNum, status: 'AVAILABLE', version: 1 };
    }

    // Optimistic concurrency check
    if (expected_version !== null && expected_version !== undefined && table.version !== Number(expected_version)) {
      const err = new Error(`تعارض التحديث المتزامن (Optimistic Concurrency Conflict): إصدار الطاولة الحالي هو ${table.version} بينما المطلوب هو ${expected_version}`);
      err.code = 'CONCURRENCY_CONFLICT';
      err.status = 409;
      throw err;
    }

    const currentStatus = normalizeTableStatus(table.status);
    if (currentStatus !== 'AVAILABLE' && currentStatus !== 'HELD_FOR_RESERVATION' && currentStatus !== 'CLEANING') {
      const err = new Error(`لا يمكن فتح الطاولة رقم ${tNum} لأن حالتها الحالية هي [${currentStatus}] وليست متاحة`);
      err.code = 'TABLE_NOT_AVAILABLE';
      err.status = 409;
      throw err;
    }

    const newVersion = (table.version || 1) + 1;
    const now = new Date().toISOString();
    const validActorId = (actor_id && !isNaN(Number(actor_id))) ? Number(actor_id) : 1;

    // Update table record
    await tx.run(
      `UPDATE tables 
       SET status = 'OCCUPIED',
           custom_name = COALESCE(?, custom_name),
           customer_name = ?,
           customer_phone = ?,
           guest_count = ?,
           opened_by_user_id = ?,
           shift_id = ?,
           device_id = ?,
           version = ?,
           seated_at = datetime('now', 'localtime'),
           first_ordered_at = NULL,
           last_ordered_at = NULL,
           check_requested_at = NULL,
           paid_at = NULL,
           vacated_at = NULL
       WHERE id = ?`,
      [custom_name, customer_name, customer_phone, count, validActorId, shift_id, device_id, newVersion, table.id]
    );

    // Synchronize v3_tables
    await tx.run(
      `UPDATE v3_tables 
       SET status = 'OCCUPIED', 
           custom_name = COALESCE(?, custom_name), 
           version = ?, 
           updated_at = datetime('now', 'localtime') 
       WHERE table_number = ?`,
      [custom_name, newVersion, tNum]
    );

    // Create active table session
    let sessionId = String(Date.now());
    try {
      const sessionRes = await tx.run(
        `INSERT INTO table_sessions (table_number, guest_count, opened_by_user_id, status, opened_at)
         VALUES (?, ?, ?, 'OPEN', datetime('now', 'localtime'))`,
        [tNum, count, validActorId]
      );
      sessionId = String(sessionRes.lastID);
    } catch (e) {
      try {
        const sessionRes = await tx.run(
          `INSERT INTO table_sessions (table_number, guest_count, status, opened_at)
           VALUES (?, ?, 'OPEN', datetime('now', 'localtime'))`,
          [tNum, count]
        );
        sessionId = String(sessionRes.lastID);
      } catch (e2) {
        try {
          const sessionRes = await tx.run(
            `INSERT INTO table_sessions (table_number, guest_count, status)
             VALUES (?, ?, 'OPEN')`,
            [tNum, count]
          );
          sessionId = String(sessionRes.lastID);
        } catch (e3) {}
      }
    }

    // Log immutable table event
    const eventId = `TE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await tx.run(
      `INSERT INTO table_events (id, venue_id, table_id, table_number, session_id, event_type, from_state, to_state, guest_count, actor_id, shift_id, device_id, context_notes)
       VALUES (?, ?, ?, ?, ?, 'OPEN', ?, 'OCCUPIED', ?, ?, ?, ?, ?)`,
      [eventId, venue_id, String(table.id), tNum, sessionId, currentStatus, count, validActorId, shift_id, device_id, custom_name ? `فتح طاولة مخصصة: ${custom_name}` : 'فتح طاولة قياسية']
    );

    logger.info(`Table ${tNum} successfully opened by user ${validActorId} (version: ${newVersion})`);

    return {
      success: true,
      table_id: table.id,
      table_number: tNum,
      guest_count: count,
      status: 'OCCUPIED',
      version: newVersion,
      session_id: sessionId,
      opened_at: now
    };
  });
}

/**
 * Safely Revert Opened Table with Zero Orphaned Records
 */
async function revertTableOpen(tableNumber, actorId = null, reason = 'CANCELED_BEFORE_ORDER') {
  const tNum = parseInt(tableNumber, 10);
  return runTransaction(async (tx) => {
    const table = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [tNum]);
    if (!table) throw new Error(`الطاولة رقم ${tNum} غير موجودة`);

    // Check if table has active order items
    const activeItems = await tx.get(
      `SELECT COUNT(oi.id) as count
       FROM order_sessions os
       JOIN order_items oi ON os.id = oi.session_id AND oi.status = 'ACTIVE'
       WHERE os.table_id = ? AND os.status IN ('OPEN', 'PENDING_PAYMENT')`,
      [table.id]
    );

    if (activeItems && activeItems.count > 0) {
      throw new Error(`لا يمكن إلغاء فتح الطاولة رقم ${tNum} لأنها تحتوي على ${activeItems.count} طلبات نشطة. يجب تسوية الطلبات أولاً.`);
    }

    // Cancel open table sessions
    await tx.run(
      `UPDATE table_sessions SET status = 'REVERTED' WHERE table_number = ? AND status = 'OPEN'`,
      [tNum]
    );

    // Cancel open order sessions without active items
    await tx.run(
      `UPDATE order_sessions SET status = 'CANCELLED' WHERE table_id = ? AND status = 'OPEN'`,
      [table.id]
    );

    const newVersion = (table.version || 1) + 1;

    // Reset table fields cleanly
    await tx.run(
      `UPDATE tables 
       SET status = 'AVAILABLE',
           custom_name = NULL,
           customer_name = NULL,
           customer_phone = NULL,
           guest_count = 0,
           opened_by_user_id = NULL,
           shift_id = NULL,
           device_id = NULL,
           seated_at = NULL,
           first_ordered_at = NULL,
           last_ordered_at = NULL,
           check_requested_at = NULL,
           paid_at = NULL,
           vacated_at = datetime('now', 'localtime'),
           version = ?
       WHERE id = ?`,
      [newVersion, table.id]
    );

    // Synchronize v3_tables
    await tx.run(
      `UPDATE v3_tables SET status = 'AVAILABLE', version = ?, updated_at = datetime('now', 'localtime') WHERE table_number = ?`,
      [newVersion, tNum]
    );

    // Log revert event
    const eventId = `TE-REV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await tx.run(
      `INSERT INTO table_events (id, venue_id, table_id, table_number, event_type, from_state, to_state, actor_id, context_notes)
       VALUES (?, 'V_DEFAULT', ?, ?, 'REVERTED', ?, 'AVAILABLE', ?, ?)`,
      [eventId, String(table.id), tNum, table.status, actorId, reason]
    );

    return { success: true, table_number: tNum, status: 'AVAILABLE', version: newVersion };
  });
}

/**
 * Optimistic Concurrency Update for Table State Lifecycle
 */
async function updateTableState(tableNumber, targetState, expectedVersion = null, actorId = null, notes = null) {
  const tNum = parseInt(tableNumber, 10);
  const normalizedTarget = normalizeTableStatus(targetState);

  return runTransaction(async (tx) => {
    const table = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [tNum]);
    if (!table) throw new Error(`الطاولة رقم ${tNum} غير موجودة`);

    if (expectedVersion !== null && expectedVersion !== undefined && table.version !== Number(expectedVersion)) {
      const err = new Error(`تعارض التحديث المتزامن (Optimistic Lock Failure): إصدار الطاولة المتوقع هو ${expectedVersion} ولكن الحالي هو ${table.version}`);
      err.code = 'CONCURRENCY_CONFLICT';
      err.status = 409;
      throw err;
    }

    const newVersion = (table.version || 1) + 1;
    let sql = `UPDATE tables SET status = ?, version = ?`;
    const params = [normalizedTarget, newVersion];

    if (normalizedTarget === 'REQUESTED_CHECK') {
      sql += `, check_requested_at = COALESCE(check_requested_at, datetime('now', 'localtime'))`;
    } else if (normalizedTarget === 'PAID_PENDING_CLEAR' || normalizedTarget === 'PAYMENT_PENDING') {
      sql += `, paid_at = COALESCE(paid_at, datetime('now', 'localtime'))`;
    } else if (normalizedTarget === 'AVAILABLE' || normalizedTarget === 'CLEANING') {
      sql += `, custom_name = NULL, customer_name = NULL, customer_phone = NULL, guest_count = 0, seated_at = NULL, first_ordered_at = NULL, last_ordered_at = NULL, check_requested_at = NULL, paid_at = NULL, vacated_at = datetime('now', 'localtime'), turnover_count = turnover_count + 1`;
    }

    sql += ` WHERE id = ?`;
    params.push(table.id);
    await tx.run(sql, params);

    // Update v3_tables
    await tx.run(
      `UPDATE v3_tables SET status = ?, version = ?, updated_at = datetime('now', 'localtime') WHERE table_number = ?`,
      [normalizedTarget, newVersion, tNum]
    );

    // Append table event
    const eventId = `TE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await tx.run(
      `INSERT INTO table_events (id, venue_id, table_id, table_number, event_type, from_state, to_state, actor_id, context_notes)
       VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, String(table.id), tNum, normalizedTarget, table.status, normalizedTarget, actorId, notes]
    );

    return { success: true, table_number: tNum, status: normalizedTarget, version: newVersion };
  });
}

/**
 * Move / Transfer Active Table Session
 */
async function moveTable(fromTable, toTable, actorId = null) {
  const fromT = parseInt(fromTable, 10);
  const toT = parseInt(toTable, 10);

  return runTransaction(async (tx) => {
    const srcTable = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [fromT]);
    if (!srcTable) throw new Error(`الطاولة المصدر رقم ${fromT} غير موجودة`);

    let dstTable = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [toT]);
    if (!dstTable) {
      const res = await tx.run(`INSERT INTO tables (table_number, status, version) VALUES (?, 'AVAILABLE', 1)`, [toT]);
      dstTable = { id: res.lastID, table_number: toT, status: 'AVAILABLE', version: 1 };
    }

    const dstStatus = normalizeTableStatus(dstTable.status);
    if (dstStatus !== 'AVAILABLE' && dstStatus !== 'CLEANING') {
      throw new Error(`لا يمكن نقل الجلسة إلى الطاولة رقم ${toT} لأن حالتها هي [${dstStatus}]`);
    }

    const newSrcVersion = (srcTable.version || 1) + 1;
    const newDstVersion = (dstTable.version || 1) + 1;

    // Transfer active order session
    await tx.run(
      `UPDATE order_sessions SET table_id = ? WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT')`,
      [dstTable.id, srcTable.id]
    );

    // Transfer table session
    await tx.run(
      `UPDATE table_sessions SET table_number = ? WHERE table_number = ? AND status = 'OPEN'`,
      [toT, fromT]
    );

    // Update destination table
    await tx.run(
      `UPDATE tables 
       SET status = src.status,
           custom_name = src.custom_name,
           customer_name = src.customer_name,
           customer_phone = src.customer_phone,
           guest_count = src.guest_count,
           opened_by_user_id = src.opened_by_user_id,
           shift_id = src.shift_id,
           device_id = src.device_id,
           seated_at = src.seated_at,
           first_ordered_at = src.first_ordered_at,
           last_ordered_at = src.last_ordered_at,
           version = ?
       FROM (SELECT * FROM tables WHERE table_number = ?) AS src
       WHERE tables.table_number = ?`,
      [newDstVersion, fromT, toT]
    );

    // Vacate source table
    await tx.run(
      `UPDATE tables 
       SET status = 'AVAILABLE',
           custom_name = NULL,
           customer_name = NULL,
           customer_phone = NULL,
           guest_count = 0,
           seated_at = NULL,
           first_ordered_at = NULL,
           last_ordered_at = NULL,
           check_requested_at = NULL,
           paid_at = NULL,
           vacated_at = datetime('now', 'localtime'),
           version = ?
       WHERE table_number = ?`,
      [newSrcVersion, fromT]
    );

    // Log move event
    const eventId = `TE-MOVE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await tx.run(
      `INSERT INTO table_events (id, venue_id, table_id, table_number, event_type, from_state, to_state, actor_id, context_notes)
       VALUES (?, 'V_DEFAULT', ?, ?, 'MOVED', ?, 'AVAILABLE', ?, ?)`,
      [eventId, String(srcTable.id), fromT, srcTable.status, actorId, `نقل الجلسة من طاولة ${fromT} إلى طاولة ${toT}`]
    );

    return { success: true, from_table: fromT, to_table: toT, destination_version: newDstVersion };
  });
}

/**
 * Session Details for a specific table
 */
async function getTableSessionDetails(tableNumber) {
  const tNum = parseInt(tableNumber, 10);
  let table = await getQuery(
    `SELECT t.id, t.table_number, t.custom_name, t.customer_name, t.customer_phone,
            t.guest_count, t.status, t.zone, t.capacity, t.version,
            t.seated_at, t.first_ordered_at, t.last_ordered_at, t.check_requested_at, t.paid_at, t.vacated_at,
            ROUND((julianday('now', 'localtime') - julianday(t.seated_at)) * 1440) as seated_minutes,
            ROUND((julianday('now', 'localtime') - julianday(t.check_requested_at)) * 1440) as check_requested_minutes
     FROM tables t 
     WHERE t.table_number = ?`,
    [tNum]
  );

  if (!table) {
    table = {
      table_number: tNum,
      status: 'AVAILABLE',
      capacity: 4,
      zone: 'INDOOR_1',
      version: 1,
      seated_minutes: null,
      check_requested_minutes: null
    };
  } else {
    table.status = normalizeTableStatus(table.status);
  }

  let session = null;
  let items = [];
  if (table.id) {
    session = await getQuery(
      `SELECT * FROM order_sessions WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT') ORDER BY id DESC LIMIT 1`,
      [table.id]
    );
  }

  if (session) {
    items = await allQuery(
      `SELECT oi.id, oi.menu_item_id, oi.item_name_snapshot as item_name, 
              oi.unit_price_minor, oi.quantity, oi.modifiers_json, 
              oi.department, oi.kds_status, oi.status, oi.created_at
       FROM order_items oi
       WHERE oi.session_id = ? AND oi.status = 'ACTIVE'
       ORDER BY oi.id ASC`,
      [session.id]
    );
  }

  const subtotalMinor = items.reduce((sum, it) => sum + (it.unit_price_minor * it.quantity), 0);

  const configs = await allQuery(`SELECT key, value FROM system_config`);
  const cfg = {};
  for (const c of configs) cfg[c.key] = c.value;
  const currency = cfg.currency || 'ج.م';
  const vatPercent = parseFloat(cfg.vat_percent || '14');
  const servicePercent = parseFloat(cfg.service_percent || '12');
  const applyTaxes = cfg.apply_taxes !== 'false';

  let serviceMinor = 0;
  let taxMinor = 0;
  if (applyTaxes) {
    serviceMinor = Math.round((subtotalMinor * servicePercent) / 100);
    const taxableBase = subtotalMinor + serviceMinor;
    taxMinor = Math.round((taxableBase * vatPercent) / 100);
  }
  const totalMinor = subtotalMinor + serviceMinor + taxMinor;

  return {
    table,
    session,
    items: items.map(it => {
      let mods = {};
      try {
        mods = typeof it.modifiers_json === 'string' ? JSON.parse(it.modifiers_json) : (it.modifiers_json || {});
      } catch (e) {}
      return {
        id: it.id,
        menu_item_id: it.menu_item_id,
        item_name: it.item_name,
        unit_price: it.unit_price_minor / 100,
        unit_price_minor: it.unit_price_minor,
        quantity: it.quantity,
        total_price: (it.unit_price_minor * it.quantity) / 100,
        department: it.department,
        kds_status: it.kds_status,
        status: it.status,
        sugar_level: mods.sugar_level || null,
        roast_type: mods.roast_type || null,
        addons: mods.addons || null,
        created_at: it.created_at
      };
    }),
    totals: {
      currency,
      subtotal: subtotalMinor / 100,
      service_amount: serviceMinor / 100,
      vat_amount: taxMinor / 100,
      total_amount: totalMinor / 100,
      service_percent: servicePercent,
      vat_percent: vatPercent,
      apply_taxes: applyTaxes
    }
  };
}

/**
 * Upsert Table Definition
 */
async function upsertTable({ table_number, custom_name, zone = 'INDOOR_1', capacity = 4, customer_name = null, customer_phone = null }) {
  const tNum = parseInt(table_number, 10);
  if (!tNum || tNum <= 0) throw new Error('رقم الطاولة مطلوب وصحيح');

  const existing = await getQuery(`SELECT id, version FROM tables WHERE table_number = ?`, [tNum]);
  if (existing) {
    const newVersion = (existing.version || 1) + 1;
    await runQuery(
      `UPDATE tables 
       SET custom_name = COALESCE(?, custom_name),
           zone = COALESCE(?, zone),
           capacity = COALESCE(?, capacity),
           customer_name = COALESCE(?, customer_name),
           customer_phone = COALESCE(?, customer_phone),
           version = ?
       WHERE id = ?`,
      [custom_name, zone, capacity, customer_name, customer_phone, newVersion, existing.id]
    );
    return { success: true, table_id: existing.id, table_number: tNum, version: newVersion };
  } else {
    const res = await runQuery(
      `INSERT INTO tables (table_number, custom_name, zone, capacity, customer_name, customer_phone, status, version)
       VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', 1)`,
      [tNum, custom_name || `طاولة ${tNum}`, zone, capacity, customer_name, customer_phone]
    );
    return { success: true, table_id: res.lastID, table_number: tNum, version: 1 };
  }
}

/**
 * Legacy compatibility wrappers
 */
async function seatTable(tableNumber, customName = null, customerName = null, customerPhone = null, guestCount = 2, actorId = null) {
  return openTable({
    table_number: tableNumber,
    custom_name: customName,
    customer_name: customerName,
    customer_phone: customerPhone,
    guest_count: guestCount,
    actor_id: actorId
  });
}

async function requestTableCheck(tableNumber, actorId = null) {
  return updateTableState(tableNumber, 'REQUESTED_CHECK', null, actorId, 'طلب الشيك من قبل العميل/الويتر');
}

async function vacateTable(tableNumber, actorId = null) {
  return updateTableState(tableNumber, 'AVAILABLE', null, actorId, 'تفريغ الطاولة وإتاحتها للجلوس');
}

async function updateTableLifecycle(tableNumber, status, userId = null) {
  return updateTableState(tableNumber, status, null, userId);
}

module.exports = {
  CANONICAL_TABLE_STATES,
  normalizeTableStatus,
  getAllTables,
  openTable,
  revertTableOpen,
  updateTableState,
  moveTable,
  getTableSessionDetails,
  upsertTable,
  seatTable,
  requestTableCheck,
  vacateTable,
  updateTableLifecycle
};
