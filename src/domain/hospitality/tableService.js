const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

const VALID_STATES = [
  'AVAILABLE', 'HELD_FOR_RESERVATION', 'OCCUPIED', 
  'ORDER_OPEN', 'REQUESTED_CHECK', 'PAYMENT_PENDING', 
  'PAID_PENDING_CLEAR', 'CLEANING', 'OUT_OF_SERVICE'
];

async function updateTableState(tableId, targetState, expectedVersion) {
  if (!VALID_STATES.includes(targetState)) throw new Error(`Invalid state: ${targetState}`);

  return runTransaction(async (tx) => {
    const table = await getQuery(`SELECT version, status FROM v3_tables WHERE id = ?`, [tableId]);
    if (!table) throw new Error('Table not found');
    if (table.version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Table version mismatch. Expected ${expectedVersion}, got ${table.version}`);
    }

    const res = await tx.run(
      `UPDATE v3_tables SET status = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ? AND version = ?`,
      [targetState, tableId, expectedVersion]
    );

    if (res.changes !== 1) {
      throw new Error('Optimistic lock failure during update');
    }
    return true;
  });
}

async function claimTable(tableId, expectedVersion, activeOrderId = null, activeReservationId = null, customerContext = null) {
  return runTransaction(async (tx) => {
    const table = await getQuery(`SELECT version, status FROM v3_tables WHERE id = ?`, [tableId]);
    if (!table) throw new Error('Table not found');
    if (table.version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Table version mismatch`);
    }

    if (table.status !== 'AVAILABLE' && table.status !== 'HELD_FOR_RESERVATION') {
      throw new Error(`Table cannot be claimed from state: ${table.status}`);
    }

    const customerCtxStr = customerContext ? JSON.stringify(customerContext) : null;
    const targetState = activeOrderId ? 'ORDER_OPEN' : 'OCCUPIED';

    const res = await tx.run(
      `UPDATE v3_tables 
       SET status = ?, active_order_id = ?, active_reservation_id = ?, customer_context_json = ?, version = version + 1, updated_at = datetime('now', 'localtime') 
       WHERE id = ? AND version = ?`,
      [targetState, activeOrderId, activeReservationId, customerCtxStr, tableId, expectedVersion]
    );

    if (res.changes !== 1) throw new Error('Optimistic lock failure during update');
    return true;
  });
}

async function clearTable(tableId, expectedVersion) {
  return runTransaction(async (tx) => {
    const table = await getQuery(`SELECT version, status FROM v3_tables WHERE id = ?`, [tableId]);
    if (!table) throw new Error('Table not found');
    if (table.version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Table version mismatch`);
    }

    const res = await tx.run(
      `UPDATE v3_tables 
       SET status = 'AVAILABLE', active_order_id = NULL, active_reservation_id = NULL, customer_context_json = NULL, version = version + 1, updated_at = datetime('now', 'localtime') 
       WHERE id = ? AND version = ?`,
      [tableId, expectedVersion]
    );

    if (res.changes !== 1) throw new Error('Optimistic lock failure during update');
    return true;
  });
}

module.exports = {
  updateTableState,
  claimTable,
  clearTable,
  VALID_STATES
};
