/**
 * Inventory, Purchasing, Waste & Material Transfers Domain Service
 */
const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

async function getInventory() {
  const items = await allQuery(
    `SELECT i.id, i.name, i.category as department, i.unit, i.min_limit as min_stock_level,
            i.cost_per_unit_minor / 100.0 as unit_cost,
            i.current_stock_microunits / 1000000.0 as current_stock,
            i.is_active, s.name as supplier_name
     FROM inventory_items i
     LEFT JOIN suppliers s ON i.default_supplier_id = s.id
     WHERE i.is_active = 1
     ORDER BY i.name ASC`
  );
  return items;
}

async function logPurchase(purchaseData, actorId = null) {
  const { supplier_id, invoice_number, items = [], notes } = purchaseData;

  return runTransaction(async (tx) => {
    let totalCostMinor = 0;
    for (const it of items) {
      const qtyMicro = Math.round((Number(it.quantity) || 0) * 1000000);
      const unitCostMinor = Math.round((Number(it.unit_price) || 0) * 100);
      totalCostMinor += Math.round((qtyMicro * unitCostMinor) / 1000000);
    }

    const pRes = await tx.run(
      `INSERT INTO purchases (supplier_id, invoice_number, total_cost_minor, notes, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [supplier_id || null, invoice_number || null, totalCostMinor, notes || null, actorId]
    );

    const purchaseId = pRes.lastID;

    for (const it of items) {
      let invItem = null;
      if (it.inventory_id) {
        invItem = await tx.get(`SELECT id, unit FROM inventory_items WHERE id = ?`, [it.inventory_id]);
      } else if (it.item_name) {
        invItem = await tx.get(`SELECT id, unit FROM inventory_items WHERE name = ?`, [it.item_name]);
        if (!invItem) {
          const invRes = await tx.run(
            `INSERT INTO inventory_items (name, unit, min_limit) VALUES (?, ?, 5)`,
            [it.item_name, it.unit || 'g']
          );
          invItem = { id: invRes.lastID, unit: it.unit || 'g' };
        }
      }

      if (invItem) {
        const qtyMicro = Math.round((Number(it.quantity) || 0) * 1000000);
        const unitCostMinor = Math.round((Number(it.unit_price) || 0) * 100);
        const lineTotalMinor = Math.round((qtyMicro * unitCostMinor) / 1000000);

        await tx.run(
          `INSERT INTO purchase_items (purchase_id, inventory_item_id, quantity_microunits, unit, unit_cost_minor, total_line_minor)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [purchaseId, invItem.id, qtyMicro, invItem.unit, unitCostMinor, lineTotalMinor]
        );

        // Update inventory stock
        await tx.run(
          `UPDATE inventory_items 
           SET current_stock_microunits = current_stock_microunits + ?,
               cost_per_unit_minor = ?,
               updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [qtyMicro, unitCostMinor, invItem.id]
        );

        // Insert inventory ledger entry
        const idempKey = `PURCHASE_${purchaseId}_ITEM_${invItem.id}`;
        await tx.run(
          `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, unit_cost_minor, source_type, source_id, idempotency_key, actor_id)
           VALUES (?, 'PURCHASE', ?, ?, ?, 'PURCHASE_INVOICE', ?, ?, ?)`,
          [invItem.id, qtyMicro, invItem.unit, unitCostMinor, String(purchaseId), idempKey, actorId]
        );
      }
    }

    return {
      id: purchaseId,
      invoice_number,
      total_cost: totalCostMinor / 100,
      status: 'POSTED'
    };
  });
}

async function logWaste(wasteData, actorId = null) {
  const { inventory_id, item_name, quantity, unit = 'g', department = 'GENERAL', reason = 'تلف / هالك' } = wasteData;
  const qtyMicro = Math.round((Number(quantity) || 0) * 1000000);

  return runTransaction(async (tx) => {
    let invItem = null;
    if (inventory_id) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor FROM inventory_items WHERE id = ?`, [inventory_id]);
    } else if (item_name) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor FROM inventory_items WHERE name = ?`, [item_name]);
    }

    if (!invItem) {
      throw new Error(`NOT_FOUND: خامة المخزون غير مسجلة [${item_name || inventory_id}]`);
    }

    const costMinor = Math.round((qtyMicro * invItem.cost_per_unit_minor) / 1000000);

    const wRes = await tx.run(
      `INSERT INTO waste_log (inventory_item_id, quantity_microunits, unit, department, reason, cost_minor, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invItem.id, qtyMicro, invItem.unit, department, reason, costMinor, actorId]
    );

    // Deduct stock
    await tx.run(
      `UPDATE inventory_items SET current_stock_microunits = current_stock_microunits - ? WHERE id = ?`,
      [qtyMicro, invItem.id]
    );

    // Inventory ledger entry
    const idempKey = `WASTE_${wRes.lastID}`;
    await tx.run(
      `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, unit_cost_minor, source_type, source_id, idempotency_key, reason, actor_id)
       VALUES (?, 'WASTE', ?, ?, ?, 'WASTE_LOG', ?, ?, ?, ?)`,
      [invItem.id, -qtyMicro, invItem.unit, invItem.cost_per_unit_minor, String(wRes.lastID), idempKey, reason, actorId]
    );

    return {
      id: wRes.lastID,
      inventory_item: invItem.name,
      quantity_wasted: quantity,
      cost: costMinor / 100
    };
  });
}

async function transferMaterial(transferData, actorId = null) {
  const { item_name, source_dept, target_dept, quantity, unit = 'g' } = transferData;
  const qtyMicro = Math.round((Number(quantity) || 0) * 1000000);

  return runTransaction(async (tx) => {
    let invItem = await tx.get(`SELECT id, name, unit FROM inventory_items WHERE name = ?`, [item_name]);
    if (!invItem) {
      const invRes = await tx.run(`INSERT INTO inventory_items (name, unit, min_limit) VALUES (?, ?, 5)`, [item_name, unit]);
      invItem = { id: invRes.lastID, name: item_name, unit };
    }

    const tRes = await tx.run(
      `INSERT INTO material_transfers (inventory_item_id, item_name, source_dept, target_dept, quantity_microunits, unit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invItem.id, item_name, source_dept, target_dept, qtyMicro, unit, actorId]
    );

    // Record paired TRANSFER_OUT and TRANSFER_IN ledger events
    const transferId = tRes.lastID;
    await tx.run(
      `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, source_type, source_id, idempotency_key, reason, actor_id)
       VALUES (?, 'TRANSFER_OUT', ?, ?, 'TRANSFER', ?, ?, ?, ?)`,
      [invItem.id, -qtyMicro, unit, String(transferId), `XFER_OUT_${transferId}`, `تحويل من ${source_dept} إلى ${target_dept}`, actorId]
    );
    await tx.run(
      `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, source_type, source_id, idempotency_key, reason, actor_id)
       VALUES (?, 'TRANSFER_IN', ?, ?, 'TRANSFER', ?, ?, ?, ?)`,
      [invItem.id, qtyMicro, unit, String(transferId), `XFER_IN_${transferId}`, `استلام من ${source_dept}`, actorId]
    );

    return {
      id: transferId,
      item_name,
      source_dept,
      target_dept,
      quantity,
      status: 'POSTED'
    };
  });
}

module.exports = {
  getInventory,
  logPurchase,
  logWaste,
  transferMaterial
};
