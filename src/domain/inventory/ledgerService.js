const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

/**
 * Calculates current available balance from the ledger.
 */
async function getLedgerBalance(inventoryItemId) {
  const row = await getQuery(
    `SELECT SUM(quantity_delta_microunits) as balance 
     FROM inventory_ledger 
     WHERE inventory_item_id = ?`,
    [inventoryItemId]
  );
  return row ? (row.balance || 0) : 0;
}

/**
 * Validates whether we can deduct from stock based on negative stock policy.
 */
async function validateNegativeStock(inventoryItem, quantityMicrounitsToDeduct) {
  const policy = inventoryItem.negative_stock_policy;
  
  if (policy === 'ALLOW') return true;

  const currentBalance = await getLedgerBalance(inventoryItem.id);
  const available = currentBalance - (inventoryItem.reserved_microunits || 0) - (inventoryItem.quarantined_microunits || 0) - (inventoryItem.damaged_microunits || 0);

  if (available < quantityMicrounitsToDeduct) {
    if (policy === 'BLOCK') {
      throw new Error(`Insufficient stock for ${inventoryItem.name || 'item'}. Available: ${available}, Required: ${quantityMicrounitsToDeduct}`);
    } else if (policy === 'WARN' || policy === 'VENUE_DEFAULT') {
      logger.warn(`Negative stock reached for ${inventoryItem.name || 'item'}. Available: ${available}, Required: ${quantityMicrounitsToDeduct}`);
    }
  }
  return true;
}

/**
 * Appends a movement to the inventory ledger
 */
async function appendLedgerEvent(tx, event) {
  const change = event.quantity_delta_microunits !== undefined ? event.quantity_delta_microunits : (event.change_microunits || 0);
  const eventType = event.event_type || event.reference_type || 'ADJUSTMENT';
  const unit = event.unit || 'UNIT';
  const unitCostMinor = event.unit_cost_minor || 0;
  const sourceType = event.source_type || 'MANUAL';
  const sourceId = event.source_id || event.reference_id || null;
  const idempotencyKey = event.idempotency_key || ('LEDGER-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7));

  await tx.run(
    `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, unit_cost_minor, source_type, source_id, idempotency_key, reason, actor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.inventory_item_id,
      eventType,
      change,
      unit,
      unitCostMinor,
      sourceType,
      sourceId,
      idempotencyKey,
      event.reason || null,
      event.actor_id || null
    ]
  );
}

module.exports = {
  getLedgerBalance,
  validateNegativeStock,
  appendLedgerEvent
};
