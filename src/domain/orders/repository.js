/**
 * Orders Repository
 * Encapsulates all database interactions for Orders and Payments.
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');

class OrderRepository {
  async findSessionById(id, tx = null) {
    const query = tx ? tx.get : getQuery;
    const session = await query(`SELECT * FROM v3_order_sessions WHERE id = ?`, [id]);
    if (!session) return null;
    
    const all = tx ? tx.all : allQuery;
    const lines = await all(`SELECT * FROM v3_order_lines WHERE order_session_id = ?`, [id]);
    return { ...session, lines };
  }

  async createSession(session, tx = null) {
    const run = tx ? tx.run : runQuery;
    const { id, branchId, tableId, createdBy, orderType, totalMinor } = session;
    await run(
      `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, total_minor) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, branchId, tableId, createdBy, orderType, totalMinor]
    );
    return await this.findSessionById(id, tx);
  }

  async addOrderLine(line, tx = null) {
    const run = tx ? tx.run : runQuery;
    const { id, orderSessionId, menuItemId, quantity, unitPriceMinor, totalMinor } = line;
    await run(
      `INSERT INTO v3_order_lines (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, orderSessionId, menuItemId, quantity, unitPriceMinor, totalMinor]
    );
  }
}

module.exports = new OrderRepository();
