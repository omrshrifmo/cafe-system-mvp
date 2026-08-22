/**
 * Table Lifecycle & Seating Management Domain Service
 */
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

async function getAllTables() {
  const sql = `
    SELECT t.id, t.table_number, t.custom_name, t.customer_name, t.customer_phone,
           t.guest_count, t.status, t.zone, t.capacity,
           t.seated_at, t.first_ordered_at, t.last_ordered_at, t.check_requested_at, t.paid_at, t.vacated_at,
           ROUND((julianday('now', 'localtime') - julianday(t.seated_at)) * 1440) as seated_minutes,
           ROUND((julianday('now', 'localtime') - julianday(t.check_requested_at)) * 1440) as check_requested_minutes,
           ROUND((julianday('now', 'localtime') - julianday(t.paid_at)) * 1440) as paid_minutes,
           COUNT(DISTINCT oi.id) as active_items_count,
           COALESCE(SUM(CASE WHEN oi.status = 'ACTIVE' THEN (oi.unit_price_minor * oi.quantity) / 100.0 ELSE 0 END), 0) as active_total_amount
    FROM tables t
    LEFT JOIN order_sessions os ON t.id = os.table_id AND os.status IN ('OPEN', 'PENDING_PAYMENT')
    LEFT JOIN order_items oi ON os.id = oi.session_id AND oi.status = 'ACTIVE'
    GROUP BY t.id
    ORDER BY t.table_number ASC
  `;
  const tables = await allQuery(sql);
  return tables.map(t => ({
    ...t,
    seated_minutes: t.seated_at && t.seated_minutes > 0 ? Math.round(t.seated_minutes) : null,
    check_requested_minutes: t.check_requested_at && t.check_requested_minutes > 0 ? Math.round(t.check_requested_minutes) : null,
    paid_minutes: t.paid_at && t.paid_minutes > 0 ? Math.round(t.paid_minutes) : null
  }));
}

async function seatTable(tableNumber, customName = null, customerName = null, customerPhone = null, guestCount = 2, actorId = null) {
  const tNum = parseInt(tableNumber, 10);
  const count = Math.max(1, parseInt(guestCount, 10) || 2);

  return runTransaction(async (tx) => {
    let table = await tx.get(`SELECT id, table_number FROM tables WHERE table_number = ?`, [tNum]);
    if (!table) {
      const res = await tx.run(
        `INSERT INTO tables (table_number, custom_name, customer_name, customer_phone, guest_count, status, seated_at)
         VALUES (?, ?, ?, ?, ?, 'SEATED', datetime('now', 'localtime'))`,
        [tNum, customName, customerName, customerPhone, count]
      );
      table = { id: res.lastID };
    } else {
      await tx.run(
        `UPDATE tables 
         SET status = 'SEATED',
             custom_name = COALESCE(?, custom_name),
             customer_name = COALESCE(?, customer_name),
             customer_phone = COALESCE(?, customer_phone),
             guest_count = ?,
             seated_at = COALESCE(seated_at, datetime('now', 'localtime'))
         WHERE id = ?`,
        [customName, customerName, customerPhone, count, table.id]
      );
    }

    // Insert or update table session
    await tx.run(
      `INSERT INTO table_sessions (table_number, guest_count, opened_by_user_id, status)
       VALUES (?, ?, ?, 'OPEN')`,
      [tNum, count, actorId]
    );

    return { success: true, table_number: tNum, guest_count: count };
  });
}

async function requestTableCheck(tableNumber) {
  const tNum = parseInt(tableNumber, 10);
  await runQuery(
    `UPDATE tables SET status = 'CHECK_REQUESTED', check_requested_at = datetime('now', 'localtime') WHERE table_number = ?`,
    [tNum]
  );
  return { success: true, table_number: tNum };
}

async function vacateTable(tableNumber) {
  const tNum = parseInt(tableNumber, 10);
  await runQuery(
    `UPDATE tables 
     SET status = 'VACANT',
         custom_name = NULL,
         customer_name = NULL,
         customer_phone = NULL,
         seated_at = NULL,
         first_ordered_at = NULL,
         last_ordered_at = NULL,
         check_requested_at = NULL,
         paid_at = NULL,
         vacated_at = datetime('now', 'localtime')
     WHERE table_number = ?`,
    [tNum]
  );
  return { success: true, table_number: tNum };
}

async function moveTable(fromTable, toTable, actorId = null) {
  const fromT = parseInt(fromTable, 10);
  const toT = parseInt(toTable, 10);

  return runTransaction(async (tx) => {
    const srcTable = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [fromT]);
    if (!srcTable) throw new Error(`الطاولة المصدر رقم ${fromT} غير موجودة`);

    let dstTable = await tx.get(`SELECT * FROM tables WHERE table_number = ?`, [toT]);
    if (!dstTable) {
      const res = await tx.run(`INSERT INTO tables (table_number, status) VALUES (?, 'VACANT')`, [toT]);
      dstTable = { id: res.lastID };
    }

    // Transfer active order session
    await tx.run(
      `UPDATE order_sessions SET table_id = ? WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT')`,
      [dstTable.id, srcTable.id]
    );

    // Update destination table with source details
    await tx.run(
      `UPDATE tables 
       SET status = src.status,
           custom_name = src.custom_name,
           customer_name = src.customer_name,
           customer_phone = src.customer_phone,
           guest_count = src.guest_count,
           seated_at = src.seated_at,
           first_ordered_at = src.first_ordered_at,
           last_ordered_at = src.last_ordered_at
       FROM (SELECT * FROM tables WHERE table_number = ?) AS src
       WHERE tables.table_number = ?`,
      [fromT, toT]
    );

    // Vacate source table
    await tx.run(
      `UPDATE tables SET status = 'VACANT', custom_name = NULL, customer_name = NULL, customer_phone = NULL, seated_at = NULL WHERE table_number = ?`,
      [fromT]
    );

    return { success: true, from_table: fromT, to_table: toT };
  });
}

async function getTableSessionDetails(tableNumber) {
  const tNum = parseInt(tableNumber, 10);
  let table = await getQuery(
    `SELECT t.id, t.table_number, t.custom_name, t.customer_name, t.customer_phone,
            t.guest_count, t.status, t.zone, t.capacity,
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
      status: 'VACANT',
      capacity: 4,
      zone: 'INDOOR_1',
      seated_minutes: null,
      check_requested_minutes: null
    };
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
  
  // Tax config
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

async function upsertTable({ table_number, custom_name, zone = 'INDOOR_1', capacity = 4, customer_name = null, customer_phone = null }) {
  const tNum = parseInt(table_number, 10);
  if (!tNum || tNum <= 0) throw new Error('رقم الطاولة مطلوب وصحيح');

  const existing = await getQuery(`SELECT id FROM tables WHERE table_number = ?`, [tNum]);
  if (existing) {
    await runQuery(
      `UPDATE tables 
       SET custom_name = COALESCE(?, custom_name),
           zone = COALESCE(?, zone),
           capacity = COALESCE(?, capacity),
           customer_name = COALESCE(?, customer_name),
           customer_phone = COALESCE(?, customer_phone)
       WHERE id = ?`,
      [custom_name, zone, capacity, customer_name, customer_phone, existing.id]
    );
    return { success: true, table_id: existing.id, table_number: tNum };
  } else {
    const res = await runQuery(
      `INSERT INTO tables (table_number, custom_name, zone, capacity, customer_name, customer_phone, status)
       VALUES (?, ?, ?, ?, ?, ?, 'VACANT')`,
      [tNum, custom_name || `طاولة ${tNum}`, zone, capacity, customer_name, customer_phone]
    );
    return { success: true, table_id: res.lastID, table_number: tNum };
  }
}

async function updateTableLifecycle(tableNumber, status, userId = null, waiterId = null) {
  const tNum = parseInt(tableNumber, 10);
  let table = await getQuery(`SELECT id, status FROM tables WHERE table_number = ?`, [tNum]);
  if (!table) {
    const res = await runQuery(`INSERT INTO tables (table_number, status) VALUES (?, 'VACANT')`, [tNum]);
    table = { id: res.lastID, status: 'VACANT' };
  }

  let timestampField = null;
  if (status === 'SEATED' || status === 'OPENED' || status === 'OCCUPIED') {
    timestampField = 'seated_at';
  } else if (status === 'WAITER_APPROACHED') {
    timestampField = 'first_ordered_at';
  } else if (status === 'CHECK_REQUESTED') {
    timestampField = 'check_requested_at';
  } else if (status === 'PAID') {
    timestampField = 'paid_at';
  } else if (status === 'VACANT') {
    timestampField = 'vacated_at';
  }

  if (status === 'VACANT') {
    await runQuery(
      `UPDATE tables 
       SET status = 'VACANT',
           custom_name = NULL,
           customer_name = NULL,
           customer_phone = NULL,
           seated_at = NULL,
           first_ordered_at = NULL,
           last_ordered_at = NULL,
           check_requested_at = NULL,
           paid_at = NULL,
           vacated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [table.id]
    );
  } else {
    let sql = `UPDATE tables SET status = ?`;
    const params = [status];
    if (timestampField) {
      sql += `, ${timestampField} = COALESCE(${timestampField}, datetime('now', 'localtime'))`;
    }
    sql += ` WHERE id = ?`;
    params.push(table.id);
    await runQuery(sql, params);
  }

  return { success: true, table_number: tNum, status };
}

module.exports = {
  getAllTables,
  getTableSessionDetails,
  upsertTable,
  updateTableLifecycle,
  seatTable,
  requestTableCheck,
  vacateTable,
  moveTable
};
