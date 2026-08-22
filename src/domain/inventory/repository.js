/**
 * Inventory Repository
 * Encapsulates all database interactions for Inventory and Ledger.
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');

class InventoryRepository {
  async findItemById(id, tx = null) {
    const query = tx ? tx.get : getQuery;
    return await query(`SELECT * FROM v3_inventory_items WHERE id = ?`, [id]);
  }

  async recordLedgerEntry(entry, tx = null) {
    const run = tx ? tx.run : runQuery;
    const { id, inventoryItemId, locationId, changeMicrounits, balanceMicrounits, referenceType, referenceId } = entry;
    await run(
      `INSERT INTO inventory_ledger (id, inventory_item_id, location_id, change_microunits, balance_microunits, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, inventoryItemId, locationId, changeMicrounits, balanceMicrounits, referenceType, referenceId]
    );
  }

  async updateItemStock(id, newStockMicrounits, tx = null) {
    const run = tx ? tx.run : runQuery;
    await run(`UPDATE v3_inventory_items SET updated_at = datetime('now', 'localtime') WHERE id = ?`, [id]);
    // Note: Stock could be derived exclusively from ledger in a strict event-sourced design.
  }
}

module.exports = new InventoryRepository();
