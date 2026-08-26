/**
 * Append-Only Inventory Ledger, Stocktaking & Negative Stock Control Service
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { verifyReauthentication, logAudit } = require('../auth/service');
const logger = require('../../observability/logger');

const NEGATIVE_STOCK_POLICIES = {
  BLOCK: 'BLOCK',
  ALERT_ALLOW: 'ALERT_ALLOW',
  BACKORDER: 'BACKORDER'
};

const STOCKTAKE_STATUSES = {
  FROZEN: 'FROZEN',
  COUNTED: 'COUNTED',
  REVIEWED: 'REVIEWED',
  POSTED: 'POSTED',
  REOPENED: 'REOPENED'
};

async function getInventory() {
  const items = await allQuery(
    `SELECT i.id, i.name, i.category as department, i.unit, i.min_limit as min_stock_level,
            i.cost_per_unit_minor / 100.0 as unit_cost,
            i.cost_basis, i.negative_stock_policy,
            i.current_stock_microunits / 1000000.0 as current_stock,
            i.is_active, s.name as supplier_name, s.phone as supplier_phone,
            COALESCE(SUM(l.quantity_delta_microunits), 0) / 1000000.0 as ledger_sum_stock
     FROM inventory_items i
     LEFT JOIN suppliers s ON i.default_supplier_id = s.id
     LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
     WHERE i.is_active = 1
     GROUP BY i.id
     ORDER BY i.name ASC`
  );
  return items;
}

async function getInventoryReconciliationAudit() {
  const items = await allQuery(
    `SELECT i.id, i.name, i.category as department, i.unit,
            (i.cost_per_unit_minor / 100.0) as unit_cost,
            (i.current_stock_microunits / 1000000.0) as balance_stock,
            COALESCE(SUM(l.quantity_delta_microunits), 0) / 1000000.0 as ledger_calculated_stock,
            i.negative_stock_policy,
            i.cost_basis
     FROM inventory_items i
     LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
     GROUP BY i.id
     ORDER BY i.name ASC`
  );

  return items.map(it => {
    const variance = Math.round((it.balance_stock - it.ledger_calculated_stock) * 1000000) / 1000000;
    let status = 'مطابق بالكامل ✅';
    if (!it.unit || it.unit === '') {
      status = 'ERROR: وحدة القياس مفقودة ❌';
    } else if (variance !== 0) {
      status = `UNRECONCILED: فرق رصيد (${variance}) ⚠️`;
    } else if (it.balance_stock < 0) {
      status = 'ALERT: رصيد سالب مسجل ⚠️';
    } else if (it.unit_cost === 0) {
      status = 'ALERT: تكلفة صفرية ⚠️';
    }

    return {
      ...it,
      variance,
      is_reconciled: variance === 0 && it.unit_cost > 0 && !!it.unit,
      status
    };
  });
}

// Backward-compatible logPurchase delegating to purchasingService
async function logPurchase(purchaseData, actorId = null) {
  const { createPurchaseDraft, approvePurchase, receivePurchase } = require('./purchasingService');
  const draft = await createPurchaseDraft(purchaseData, actorId);
  await approvePurchase(draft.id, actorId);
  return receivePurchase(draft.id, purchaseData, actorId, purchaseData.idempotency_key);
}

async function logWaste(wasteData, actorId = null) {
  const { inventory_id, item_name, quantity, unit = 'g', department = 'GENERAL', reason = 'تلف / هالك' } = wasteData;
  const qtyMicro = Math.round((Number(quantity) || 0) * 1000000);
  if (qtyMicro <= 0) throw new Error('VALIDATION_ERROR: كمية الهالك يجب أن تكون أكبر من الصفر');

  return runTransaction(async (tx) => {
    let invItem = null;
    if (inventory_id) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits, negative_stock_policy FROM inventory_items WHERE id = ?`, [inventory_id]);
    } else if (item_name) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits, negative_stock_policy FROM inventory_items WHERE name = ?`, [item_name]);
    }

    if (!invItem) {
      throw new Error(`NOT_FOUND: خامة المخزون غير مسجلة [${item_name || inventory_id}]`);
    }

    // Negative Stock Policy Check
    const effectivePolicy = invItem.negative_stock_policy || NEGATIVE_STOCK_POLICIES.BLOCK;
    const isBlocking = effectivePolicy === NEGATIVE_STOCK_POLICIES.BLOCK || effectivePolicy === 'VENUE_DEFAULT' || effectivePolicy !== NEGATIVE_STOCK_POLICIES.ALLOW_WARN;
    if (isBlocking && (invItem.current_stock_microunits - qtyMicro < 0)) {
      throw new Error(`INSUFFICIENT_STOCK: رصيد المخزون للخامة [${invItem.name}] غير كافٍ لتسجيل الهالك`);
    }

    const costMinor = Math.round((qtyMicro * (invItem.cost_per_unit_minor || 0)) / 1000000);

    const wRes = await tx.run(
      `INSERT INTO waste_log (inventory_item_id, quantity_microunits, unit, department, reason, cost_minor, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invItem.id, qtyMicro, invItem.unit, department, reason, costMinor, actorId]
    );

    // Deduct stock
    await tx.run(
      `UPDATE inventory_items 
       SET current_stock_microunits = current_stock_microunits - ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [qtyMicro, invItem.id]
    );

    // Append-Only Inventory ledger entry
    const idempKey = `WASTE_${wRes.lastID}`;
    await tx.run(
      `INSERT INTO inventory_ledger (
         inventory_item_id, event_type, quantity_delta_microunits, unit,
         unit_cost_minor, source_type, source_id, idempotency_key,
         reason, actor_id, location_id, cost_basis, created_at
       ) VALUES (?, 'WASTE', ?, ?, ?, 'WASTE_LOG', ?, ?, ?, ?, 'MAIN_STORE', 'WEIGHTED_AVERAGE', datetime('now', 'localtime'))`,
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
  const { item_name, inventory_id, source_dept, target_dept, quantity, unit = 'g' } = transferData;
  const qtyMicro = Math.round((Number(quantity) || 0) * 1000000);
  if (qtyMicro <= 0) throw new Error('VALIDATION_ERROR: كمية التحويل يجب أن تكون أكبر من الصفر');

  return runTransaction(async (tx) => {
    let invItem = null;
    if (inventory_id) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits, negative_stock_policy FROM inventory_items WHERE id = ?`, [inventory_id]);
    } else if (item_name) {
      invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits, negative_stock_policy FROM inventory_items WHERE name = ?`, [item_name]);
    }

    if (!invItem) {
      const invRes = await tx.run(`INSERT INTO inventory_items (name, unit, min_limit, cost_per_unit_minor) VALUES (?, ?, 5, 100)`, [item_name, unit]);
      invItem = { id: invRes.lastID, name: item_name, unit, cost_per_unit_minor: 100, current_stock_microunits: 0, negative_stock_policy: 'BLOCK' };
    }

    // Negative Stock Policy Check
    if (invItem.negative_stock_policy === NEGATIVE_STOCK_POLICIES.BLOCK && (invItem.current_stock_microunits - qtyMicro < 0)) {
      throw new Error(`INSUFFICIENT_STOCK: رصيد المخزون للخامة [${invItem.name}] غير كافٍ للتحويل`);
    }

    const tRes = await tx.run(
      `INSERT INTO material_transfers (inventory_item_id, item_name, source_dept, target_dept, quantity_microunits, unit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invItem.id, invItem.name, source_dept, target_dept, qtyMicro, unit, actorId]
    );

    const transferId = tRes.lastID;
    // Record paired TRANSFER_OUT and TRANSFER_IN ledger events
    await tx.run(
      `INSERT INTO inventory_ledger (
         inventory_item_id, event_type, quantity_delta_microunits, unit,
         unit_cost_minor, source_type, source_id, idempotency_key,
         reason, actor_id, location_id, cost_basis, created_at
       ) VALUES (?, 'TRANSFER_OUT', ?, ?, ?, 'TRANSFER', ?, ?, ?, ?, ?, 'WEIGHTED_AVERAGE', datetime('now', 'localtime'))`,
      [invItem.id, -qtyMicro, unit, invItem.cost_per_unit_minor, String(transferId), `XFER_OUT_${transferId}`, `تحويل من ${source_dept} إلى ${target_dept}`, actorId, source_dept]
    );

    await tx.run(
      `INSERT INTO inventory_ledger (
         inventory_item_id, event_type, quantity_delta_microunits, unit,
         unit_cost_minor, source_type, source_id, idempotency_key,
         reason, actor_id, location_id, cost_basis, created_at
       ) VALUES (?, 'TRANSFER_IN', ?, ?, ?, 'TRANSFER', ?, ?, ?, ?, ?, 'WEIGHTED_AVERAGE', datetime('now', 'localtime'))`,
      [invItem.id, qtyMicro, unit, invItem.cost_per_unit_minor, String(transferId), `XFER_IN_${transferId}`, `استلام في ${target_dept} من ${source_dept}`, actorId, target_dept]
    );

    return {
      id: transferId,
      item_name: invItem.name,
      source_dept,
      target_dept,
      quantity,
      status: 'POSTED'
    };
  });
}

async function deductBOM(tx, orderItemId, catalogItem, qty, actorId) {
  if (!catalogItem.ingredients || catalogItem.ingredients.length === 0) return;

  for (const ing of catalogItem.ingredients) {
    if (!ing.unit) {
      throw new Error(`UNRECONCILED: Invalid unit mapping for ingredient ${ing.inventory_item_id}`);
    }

    const yieldFactor = (ing.yield_percent || 100) / 100.0;
    const lossFactor = (ing.preparation_loss_percent || 0) / 100.0;
    const rawRequired = ing.quantity_microunits * qty;
    const totalRequiredMicrounits = Math.round((rawRequired / yieldFactor) * (1 + lossFactor));

    const invItem = await tx.get(`SELECT id, name, cost_per_unit_minor, unit, current_stock_microunits, negative_stock_policy FROM inventory_items WHERE id = ?`, [ing.inventory_item_id]);
    if (!invItem) {
      throw new Error(`UNRECONCILED: Missing inventory item ${ing.inventory_item_id}`);
    }
    if (invItem.unit !== ing.unit) {
      throw new Error(`UNRECONCILED: Unit mismatch for ${ing.inventory_item_id}`);
    }

    // Negative Stock Policy Check on Consumption
    if (invItem.negative_stock_policy === NEGATIVE_STOCK_POLICIES.BLOCK && (invItem.current_stock_microunits - totalRequiredMicrounits < 0)) {
      throw new Error(`INSUFFICIENT_STOCK: نفاد رصيد الخامة [${invItem.name}] في المخزن. يرجى إعادة التوريد.`);
    }

    // Deduct stock
    await tx.run(
      `UPDATE inventory_items 
       SET current_stock_microunits = current_stock_microunits - ?, 
           updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [totalRequiredMicrounits, ing.inventory_item_id]
    );

    // Ledger for actual consumed
    const consumeKey = `CONSUME_ORD_${orderItemId}_ING_${ing.inventory_item_id}`;
    await tx.run(
      `INSERT INTO inventory_ledger (
         inventory_item_id, event_type, quantity_delta_microunits, unit,
         source_type, source_id, idempotency_key, actor_id,
         unit_cost_minor, cost_basis, location_id, created_at
       ) VALUES (?, 'CONSUMPTION', ?, ?, 'ORDER_ITEM', ?, ?, ?, ?, 'WEIGHTED_AVERAGE', 'MAIN_STORE', datetime('now', 'localtime'))`,
      [ing.inventory_item_id, -totalRequiredMicrounits, ing.unit, String(orderItemId), consumeKey, actorId, invItem.cost_per_unit_minor]
    );
  }
}

// ----------------------------------------------------
// Stocktaking (Physical Inventory Count) Lifecycle
// ----------------------------------------------------

async function createStocktakeFreeze(venueId = 'V_DEFAULT', notes = null, actorId = null) {
  const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;
  return runTransaction(async (tx) => {
    const sessionId = `STK_${Date.now()}`;
    await tx.run(
      `INSERT INTO stocktake_sessions (id, venue_id, status, notes, created_by, created_at)
       VALUES (?, ?, 'FROZEN', ?, ?, datetime('now', 'localtime'))`,
      [sessionId, venueId, notes, validActorId]
    );

    const activeItems = await tx.all(`SELECT id, name, unit, current_stock_microunits FROM inventory_items WHERE is_active = 1`);
    for (const it of activeItems) {
      const lineId = `STK_L_${sessionId}_${it.id}`;
      await tx.run(
        `INSERT INTO stocktake_lines (id, stocktake_session_id, inventory_item_id, expected_microunits, counted_microunits, variance_microunits)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [lineId, sessionId, it.id, it.current_stock_microunits, it.current_stock_microunits]
      );
    }

    return {
      id: sessionId,
      status: STOCKTAKE_STATUSES.FROZEN,
      items_frozen: activeItems.length,
      message: 'تم تجميد أرصدة المخزون لبدء الجرد الفعلي ❄️'
    };
  });
}

async function recordStocktakeCount(sessionId, countLines = [], actorId = null) {
  const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;
  return runTransaction(async (tx) => {
    const session = await tx.get(`SELECT * FROM stocktake_sessions WHERE id = ?`, [sessionId]);
    if (!session) throw new Error('NOT_FOUND: جلسة الجرد غير موجودة');
    if (session.status !== STOCKTAKE_STATUSES.FROZEN && session.status !== STOCKTAKE_STATUSES.COUNTED && session.status !== STOCKTAKE_STATUSES.REOPENED) {
      throw new Error(`INVALID_STATE: لا يمكن إدخال جرد لجلسة بحالة [${session.status}]`);
    }

    for (const c of countLines) {
      const countedMicro = Math.round((Number(c.counted_quantity) || 0) * 1000000);
      const line = await tx.get(
        `SELECT * FROM stocktake_lines WHERE stocktake_session_id = ? AND inventory_item_id = ?`,
        [sessionId, c.inventory_item_id]
      );

      if (line) {
        const varianceMicro = countedMicro - line.expected_microunits;
        await tx.run(
          `UPDATE stocktake_lines 
           SET counted_microunits = ?, 
               variance_microunits = ?, 
               reason = ?, 
               counter_id = ?, 
               counted_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [countedMicro, varianceMicro, c.reason || null, validActorId, line.id]
        );
      }
    }

    await tx.run(`UPDATE stocktake_sessions SET status = 'COUNTED' WHERE id = ?`, [sessionId]);

    return { id: sessionId, status: STOCKTAKE_STATUSES.COUNTED, message: 'تم حفظ الكميات الفعلية المحصورة 📝' };
  });
}

async function reviewStocktake(sessionId, reviewerId = null) {
  const validReviewerId = (reviewerId && !isNaN(Number(reviewerId))) ? Number(reviewerId) : 1;
  const session = await getQuery(`SELECT * FROM stocktake_sessions WHERE id = ?`, [sessionId]);
  if (!session) throw new Error('NOT_FOUND: جلسة الجرد غير موجودة');

  await runQuery(
    `UPDATE stocktake_sessions SET status = 'REVIEWED', reviewer_id = ? WHERE id = ?`,
    [validReviewerId, sessionId]
  );

  const lines = await allQuery(
    `SELECT sl.*, i.name as item_name, i.unit,
            (sl.expected_microunits / 1000000.0) as expected_quantity,
            (sl.counted_microunits / 1000000.0) as counted_quantity,
            (sl.variance_microunits / 1000000.0) as variance_quantity
     FROM stocktake_lines sl
     JOIN inventory_items i ON sl.inventory_item_id = i.id
     WHERE sl.stocktake_session_id = ?`,
    [sessionId]
  );

  return { id: sessionId, status: STOCKTAKE_STATUSES.REVIEWED, lines };
}

async function postStocktake(sessionId, actorId = null, pin = null) {
  if (actorId && pin) {
    const isAuth = await verifyReauthentication(actorId, pin);
    if (!isAuth) throw new Error('UNAUTHORIZED: فشل التحقق من الرمز السري لترحيل الجرد');
  }

  const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;

  return runTransaction(async (tx) => {
    const session = await tx.get(`SELECT * FROM stocktake_sessions WHERE id = ?`, [sessionId]);
    if (!session) throw new Error('NOT_FOUND: جلسة الجرد غير موجودة');
    if (session.status === STOCKTAKE_STATUSES.POSTED) {
      return { id: sessionId, status: STOCKTAKE_STATUSES.POSTED, message: 'جلسة الجرد مرحلة مسبقاً' };
    }

    const lines = await tx.all(
      `SELECT sl.*, i.name as item_name, i.unit, i.cost_per_unit_minor
       FROM stocktake_lines sl
       JOIN inventory_items i ON sl.inventory_item_id = i.id
       WHERE sl.stocktake_session_id = ?`,
      [sessionId]
    );

    for (const line of lines) {
      if (line.variance_microunits !== 0) {
        // Update Inventory Item Balance
        await tx.run(
          `UPDATE inventory_items 
           SET current_stock_microunits = ?, 
               updated_at = datetime('now', 'localtime') 
           WHERE id = ?`,
          [line.counted_microunits, line.inventory_item_id]
        );

        // Append-Only Inventory Ledger COUNT_ADJUSTMENT Event
        const idempKey = `STK_ADJ_${sessionId}_${line.inventory_item_id}`;
        await tx.run(
          `INSERT INTO inventory_ledger (
             inventory_item_id, event_type, quantity_delta_microunits, unit,
             unit_cost_minor, source_type, source_id, idempotency_key,
             reason, actor_id, location_id, cost_basis, created_at
           ) VALUES (?, 'COUNT_ADJUSTMENT', ?, ?, ?, 'STOCKTAKE', ?, ?, ?, ?, 'MAIN_STORE', 'WEIGHTED_AVERAGE', datetime('now', 'localtime'))`,
          [
            line.inventory_item_id,
            line.variance_microunits,
            line.unit,
            line.cost_per_unit_minor,
            sessionId,
            idempKey,
            line.reason || `تسوية فروق جرد جلسة [${sessionId}]`,
            validActorId
          ]
        );
      }
    }

    await tx.run(
      `UPDATE stocktake_sessions SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?`,
      [sessionId]
    );

    await logAudit(
      session.venue_id || 'V_DEFAULT',
      actorId || 'SYSTEM',
      'STOCKTAKE_POSTED',
      'STOCKTAKE',
      sessionId,
      { session_id: sessionId, lines_count: lines.length },
      null
    );

    return {
      id: sessionId,
      status: STOCKTAKE_STATUSES.POSTED,
      message: 'تم ترحيل فروق الجرد وتسوية أرصدة المخزون في السجل بنجاح 📋✅'
    };
  });
}

module.exports = {
  NEGATIVE_STOCK_POLICIES,
  STOCKTAKE_STATUSES,
  getInventory,
  getInventoryReconciliationAudit,
  logPurchase,
  logWaste,
  transferMaterial,
  deductBOM,
  createStocktakeFreeze,
  recordStocktakeCount,
  reviewStocktake,
  postStocktake
};
