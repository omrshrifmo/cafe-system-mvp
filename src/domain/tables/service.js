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

module.exports = {
  getAllTables,
  seatTable,
  requestTableCheck,
  vacateTable,
  moveTable
};
