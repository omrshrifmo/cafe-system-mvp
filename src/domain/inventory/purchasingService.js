const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { appendLedgerEvent } = require('./ledgerService');

async function createPurchaseOrder(poData) {
  return runTransaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO purchase_orders (id, supplier_id, venue_id, document_ref, currency, tax_treatment, status, actor_id) 
       VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [poData.id, poData.supplier_id, poData.venue_id, poData.document_ref, poData.currency || 'EGP', poData.tax_treatment || 'INCLUSIVE', poData.actor_id]
    );
    return res;
  });
}

async function addPurchaseOrderLine(lineData) {
  return runTransaction(async (tx) => {
    const po = await tx.get(`SELECT status FROM purchase_orders WHERE id = ?`, [lineData.purchase_order_id]);
    if (!po || po.status !== 'DRAFT') throw new Error('Cannot add lines to non-draft PO');

    const lineTotal = lineData.expected_quantity_microunits * lineData.unit_cost_minor;

    const res = await tx.run(
      `INSERT INTO purchase_order_lines (id, purchase_order_id, inventory_item_id, expected_quantity_microunits, unit, unit_cost_minor, line_total_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lineData.id, lineData.purchase_order_id, lineData.inventory_item_id, lineData.expected_quantity_microunits, lineData.unit, lineData.unit_cost_minor, lineTotal]
    );
    return res;
  });
}

async function submitPurchaseOrder(poId, actorId) {
  return runTransaction(async (tx) => {
    await tx.run(`UPDATE purchase_orders SET status = 'SUBMITTED', updated_at = datetime('now', 'localtime') WHERE id = ? AND status = 'DRAFT'`, [poId]);
  });
}

async function approvePurchaseOrder(poId, approverId) {
  return runTransaction(async (tx) => {
    await tx.run(`UPDATE purchase_orders SET status = 'APPROVED', approval_actor_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND status = 'SUBMITTED'`, [approverId, poId]);
  });
}

async function receivePurchaseOrder(poId, linesToReceive, actorId, idempotencyKey) {
  return runTransaction(async (tx) => {
    // Check idempotency for receiving action first
    const existingKey = await tx.get(`SELECT key FROM idempotency_keys WHERE key = ?`, [idempotencyKey]);
    if (existingKey) {
      return { status: 'IDEMPOTENT_RETRY' }; // Already processed
    }

    const po = await tx.get(`SELECT status FROM purchase_orders WHERE id = ?`, [poId]);
    if (!po || !['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new Error(`PO is not in a receivable state (current status: ${po ? po.status : 'not found'})`);
    }
    
    // Save idempotency key
    await tx.run(
      `INSERT INTO idempotency_keys (key, actor_id, operation, request_hash, expires_at) 
       VALUES (?, ?, ?, ?, datetime('now', '+1 day'))`,
      [idempotencyKey, actorId || null, 'RECEIVE_PO', idempotencyKey]
    );

    let allFullyReceived = true;
    for (const rec of linesToReceive) {
      const line = await tx.get(`SELECT inventory_item_id, expected_quantity_microunits, received_quantity_microunits FROM purchase_order_lines WHERE id = ?`, [rec.line_id]);
      if (!line) continue;

      const newReceived = line.received_quantity_microunits + rec.quantity_microunits;
      const status = newReceived >= line.expected_quantity_microunits ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      if (status !== 'RECEIVED') allFullyReceived = false;

      // Update line
      await tx.run(
        `UPDATE purchase_order_lines SET received_quantity_microunits = ?, status = ? WHERE id = ?`,
        [newReceived, status, rec.line_id]
      );

      // Append ledger event for receiving
      await appendLedgerEvent(tx, {
        inventory_item_id: line.inventory_item_id,
        location_id: rec.location_id,
        change_microunits: rec.quantity_microunits,
        reference_type: 'PURCHASE_RECEIPT',
        reference_id: poId
      });
      
      // Update inventory_items WAC (Weighted Average Costing)
      const item = await tx.get(`SELECT cost_basis, cost_per_unit_minor FROM inventory_items WHERE id = ?`, [line.inventory_item_id]);
      if (item && item.cost_basis === 'WEIGHTED_AVERAGE') {
        const balance = await tx.get(`SELECT SUM(quantity_delta_microunits) as b FROM inventory_ledger WHERE inventory_item_id = ?`, [line.inventory_item_id]);
        const oldBalance = (balance && balance.b) ? balance.b - rec.quantity_microunits : 0;
        
        // Simplified WAC update
        const newWac = ((oldBalance * item.cost_per_unit_minor) + (rec.quantity_microunits * rec.unit_cost_minor)) / (oldBalance + rec.quantity_microunits);
        await tx.run(`UPDATE inventory_items SET cost_per_unit_minor = ? WHERE id = ?`, [Math.round(newWac), line.inventory_item_id]);
      }
    }

    const newPoStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await tx.run(`UPDATE purchase_orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newPoStatus, poId]);
    return { status: 'SUCCESS' };
  });
}

module.exports = {
  createPurchaseOrder,
  addPurchaseOrderLine,
  submitPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder
};
