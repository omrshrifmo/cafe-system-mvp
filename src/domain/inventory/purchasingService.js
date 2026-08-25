/**
 * Purchasing & Safe Receiving Lifecycle Domain Service
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { verifyReauthentication, logAudit } = require('../auth/service');
const logger = require('../../observability/logger');

const PURCHASE_STATUSES = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  REVERSED: 'REVERSED'
};

async function getPurchases(filter = {}) {
  let query = `
    SELECT p.id, p.venue_id, p.supplier_id, p.invoice_ref as invoice_number, p.grn_number, p.document_ref,
           p.currency, p.status, p.subtotal_minor, p.tax_minor,
           COALESCE(p.subtotal_minor + p.tax_minor, CAST(p.total_cost * 100 as INTEGER)) as total_cost_minor,
           p.total_cost,
           p.receipt_date, p.attachment_ref, p.notes, p.approved_by, p.created_at,
           s.name as supplier_name, s.tax_identity as supplier_tax_id, s.phone as supplier_phone
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.status) {
    query += ` AND p.status = ?`;
    params.push(filter.status);
  }
  if (filter.supplier_id) {
    query += ` AND p.supplier_id = ?`;
    params.push(filter.supplier_id);
  }

  query += ` ORDER BY p.created_at DESC LIMIT 100`;
  const rows = await allQuery(query, params);

  // Attach lines
  for (const row of rows) {
    const lines = await allQuery(
      `SELECT pi.id, pi.purchase_id, pi.inventory_item_id, pi.quantity_microunits,
              (pi.quantity_microunits / 1000000.0) as quantity,
              pi.unit, pi.unit_cost_minor, (pi.unit_cost_minor / 100.0) as unit_cost,
              pi.total_line_minor, (pi.total_line_minor / 100.0) as total_line,
              i.name as item_name
       FROM purchase_items pi
       JOIN inventory_items i ON pi.inventory_item_id = i.id
       WHERE pi.purchase_id = ?`,
      [row.id]
    );
    row.lines = lines;
  }

  return rows;
}

async function getPurchaseById(purchaseId) {
  const purchases = await getPurchases();
  return purchases.find(p => String(p.id) === String(purchaseId)) || null;
}

async function createPurchaseDraft(data, actorId = null) {
  const {
    supplier_id,
    invoice_number,
    document_ref,
    grn_number,
    receipt_date = new Date().toISOString().split('T')[0],
    currency = 'ج.م',
    tax_minor = 0,
    items = [],
    notes,
    attachment_ref,
    idempotency_key,
    request_id
  } = data;

  if (!supplier_id) {
    throw new Error('VALIDATION_ERROR: المورد (supplier_id) مطلوب');
  }
  if (!items || items.length === 0) {
    throw new Error('VALIDATION_ERROR: يلزم إضافة صنف واحد على الأقل لفاتورة المشتريات');
  }

  return runTransaction(async (tx) => {
    // 1. Calculate Authoritative Line Totals and Subtotal
    let subtotalMinor = 0;
    const verifiedLines = [];

    for (const it of items) {
      let invItem = null;
      if (it.inventory_item_id || it.inventory_id) {
        invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits FROM inventory_items WHERE id = ?`, [it.inventory_item_id || it.inventory_id]);
      } else if (it.item_name) {
        invItem = await tx.get(`SELECT id, name, unit, cost_per_unit_minor, current_stock_microunits FROM inventory_items WHERE name = ?`, [it.item_name]);
      }

      if (!invItem) {
        throw new Error(`NOT_FOUND: خامة المخزون غير معرفة [${it.item_name || it.inventory_item_id}]`);
      }

      const qty = Number(it.quantity) || 0;
      if (qty <= 0) {
        throw new Error(`VALIDATION_ERROR: كمية الصنف [${invItem.name}] يجب أن تكون أكبر من الصفر`);
      }

      const qtyMicro = Math.round(qty * 1000000);
      const unitCostMinor = Math.round((Number(it.unit_cost !== undefined ? it.unit_cost : it.unit_price) || 0) * 100);
      if (unitCostMinor < 0) {
        throw new Error(`VALIDATION_ERROR: سعر الوحدة للصنف [${invItem.name}] لا يمكن أن يكون سالباً`);
      }

      const lineTotalMinor = Math.round((qtyMicro * unitCostMinor) / 1000000);
      subtotalMinor += lineTotalMinor;

      verifiedLines.push({
        inventory_item_id: invItem.id,
        item_name: invItem.name,
        quantity_microunits: qtyMicro,
        unit: it.unit || invItem.unit,
        unit_cost_minor: unitCostMinor,
        total_line_minor: lineTotalMinor
      });
    }

    const totalCostMinor = subtotalMinor + (Number(tax_minor) || 0);

    const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;

    // 2. Insert Purchase Draft (Drafts DO NOT affect inventory stock or ledger)
    const pRes = await tx.run(
      `INSERT INTO purchases (
         supplier_id, venue_id, invoice_ref, grn_number, document_ref, currency,
         subtotal_minor, tax_minor, total_cost, status, notes, attachment_ref,
         idempotency_key, request_id, receipt_date
       ) VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
      [
        supplier_id,
        invoice_number || null,
        grn_number || null,
        document_ref || null,
        currency,
        subtotalMinor,
        tax_minor,
        totalCostMinor / 100.0,
        notes || null,
        attachment_ref || null,
        idempotency_key || null,
        request_id || null,
        receipt_date
      ]
    );

    const purchaseId = pRes.lastID;

    // 3. Insert Purchase Lines
    for (const line of verifiedLines) {
      await tx.run(
        `INSERT INTO purchase_items (purchase_id, inventory_item_id, quantity_microunits, unit, unit_cost_minor, total_line_minor)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [purchaseId, line.inventory_item_id, line.quantity_microunits, line.unit, line.unit_cost_minor, line.total_line_minor]
      );
    }

    return {
      id: purchaseId,
      supplier_id,
      status: PURCHASE_STATUSES.DRAFT,
      subtotal: subtotalMinor / 100,
      subtotal_minor: subtotalMinor,
      total_cost: totalCostMinor / 100,
      total_cost_minor: totalCostMinor,
      lines_count: verifiedLines.length,
      message: 'تم إنشاء مسودة أمر الشراء بنجاح 📝 (لم يتم تغيير رصيد المخزون بعد)'
    };
  });
}

async function submitPurchase(purchaseId, actorId = null) {
  const purchase = await getQuery(`SELECT id, status FROM purchases WHERE id = ?`, [purchaseId]);
  if (!purchase) throw new Error('NOT_FOUND: أمر الشراء غير موجود');
  if (purchase.status !== PURCHASE_STATUSES.DRAFT) {
    throw new Error(`INVALID_STATE: لا يمكن إرسال أمر شراء بحالة [${purchase.status}]`);
  }

  await runQuery(
    `UPDATE purchases SET status = 'SUBMITTED', updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [purchaseId]
  );

  return { id: purchaseId, status: PURCHASE_STATUSES.SUBMITTED, message: 'تم تقديم أمر الشراء للاعتماد ⏳' };
}

async function approvePurchase(purchaseId, actorId = null, pin = null) {
  const purchase = await getQuery(`SELECT id, status FROM purchases WHERE id = ?`, [purchaseId]);
  if (!purchase) throw new Error('NOT_FOUND: أمر الشراء غير موجود');
  if (purchase.status !== PURCHASE_STATUSES.SUBMITTED && purchase.status !== PURCHASE_STATUSES.DRAFT) {
    throw new Error(`INVALID_STATE: لا يمكن اعتماد أمر شراء بحالة [${purchase.status}]`);
  }

  if (actorId && pin) {
    const isAuth = await verifyReauthentication(actorId, pin);
    if (!isAuth) throw new Error('UNAUTHORIZED: فشل التحقق من الرمز السري للاعتماد');
  }

  await runQuery(
    `UPDATE purchases SET status = 'APPROVED', approved_by = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [actorId, purchaseId]
  );

  return { id: purchaseId, status: PURCHASE_STATUSES.APPROVED, message: 'تم اعتماد أمر الشراء وجاهز للاستلام الفعلي ✅' };
}

async function receivePurchase(purchaseId, receivePayload = {}, actorId = null, idempotencyKey = null) {
  return runTransaction(async (tx) => {
    const purchase = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [purchaseId]);
    if (!purchase) throw new Error('NOT_FOUND: أمر الشراء غير موجود');

    // Safe Idempotency Check: if already received, return idempotent success
    if (purchase.status === PURCHASE_STATUSES.RECEIVED || purchase.status === PURCHASE_STATUSES.CLOSED) {
      return {
        id: purchase.id,
        status: purchase.status,
        already_received: true,
        message: 'تم استلام أمر الشراء مسبقاً (إعادة إرسال آمنة بدون تكرار إيداع المخزون) 📦'
      };
    }

    if (purchase.status !== PURCHASE_STATUSES.APPROVED && purchase.status !== PURCHASE_STATUSES.PARTIALLY_RECEIVED && purchase.status !== PURCHASE_STATUSES.DRAFT && purchase.status !== PURCHASE_STATUSES.SUBMITTED) {
      throw new Error(`INVALID_STATE: أمر الشراء بحالة [${purchase.status}] ولا يمكن استلامه`);
    }

    const lines = await tx.all(
      `SELECT pi.*, i.name as item_name, i.current_stock_microunits, i.cost_per_unit_minor
       FROM purchase_items pi
       JOIN inventory_items i ON pi.inventory_item_id = i.id
       WHERE pi.purchase_id = ?`,
      [purchaseId]
    );

    if (!lines || lines.length === 0) {
      throw new Error('VALIDATION_ERROR: أمر الشراء لا يحتوي على بنود أصناف للاستلام');
    }

    const receiptBatchId = `GRN-${purchaseId}-${Date.now()}`;
    const receiptDate = receivePayload.receipt_date || purchase.receipt_date || new Date().toISOString().split('T')[0];

    // Atomically update inventory stock, calculate Weighted Average Cost (WAC), and append ledger receipts
    for (const line of lines) {
      const currentStock = line.current_stock_microunits;
      const currentCost = line.cost_per_unit_minor;
      const receivedQty = line.quantity_microunits;
      const receivedUnitCost = line.unit_cost_minor;

      // Weighted Average Cost Calculation
      let newWacCost = receivedUnitCost;
      if (currentStock > 0) {
        const totalOldValue = (currentStock * currentCost) / 1000000;
        const totalNewValue = (receivedQty * receivedUnitCost) / 1000000;
        const totalCombinedStock = currentStock + receivedQty;
        newWacCost = Math.round(((totalOldValue + totalNewValue) * 1000000) / totalCombinedStock);
      }

      // Update Inventory Item Balance & Cost
      await tx.run(
        `UPDATE inventory_items 
         SET current_stock_microunits = current_stock_microunits + ?,
             cost_per_unit_minor = ?,
             default_supplier_id = COALESCE(default_supplier_id, ?),
             updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [receivedQty, newWacCost, purchase.supplier_id, line.inventory_item_id]
      );

      const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;

      // Append-Only Inventory Ledger RECEIPT Event
      const idempKey = idempotencyKey || `RECEIVE_PO_${purchaseId}_ITEM_${line.inventory_item_id}`;
      await tx.run(
        `INSERT INTO inventory_ledger (
           inventory_item_id, event_type, quantity_delta_microunits, unit,
           unit_cost_minor, source_type, source_id, idempotency_key,
           actor_id, location_id, cost_basis, batch_id, reason, created_at
         ) VALUES (?, 'RECEIPT', ?, ?, ?, 'PURCHASE_ORDER', ?, ?, ?, 'MAIN_STORE', 'WEIGHTED_AVERAGE', NULL, ?, datetime('now', 'localtime'))`,
        [
          line.inventory_item_id,
          receivedQty,
          line.unit,
          receivedUnitCost,
          String(purchaseId),
          idempKey,
          validActorId,
          `استلام مشتريات فاتورة رقم [${purchase.invoice_number || purchaseId}] من المورد`
        ]
      );
    }

    // Mark Purchase as RECEIVED
    await tx.run(
      `UPDATE purchases 
       SET status = 'RECEIVED', 
           grn_number = COALESCE(grn_number, ?),
           receipt_date = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [receiptBatchId, receiptDate, purchaseId]
    );

    // Audit trail log
    await logAudit(
      purchase.venue_id || 'V_DEFAULT',
      actorId || 'SYSTEM',
      'PURCHASE_RECEIVED',
      'PURCHASES',
      String(purchaseId),
      { purchase_id: purchaseId, batch_id: receiptBatchId, lines_count: lines.length },
      null
    );

    logger.info('Purchase order received and inventory deposited successfully', { purchaseId, receiptBatchId });

    return {
      id: purchaseId,
      status: PURCHASE_STATUSES.RECEIVED,
      grn_number: receiptBatchId,
      receipt_date: receiptDate,
      lines_received: lines.length,
      message: 'تم استلام وتوريد البضاعة للمخزن وتحديث متوسط التكلفة المرجح (WAC) بنجاح 📦'
    };
  });
}

async function reversePurchase(purchaseId, reason = 'إرجاع مشتريات / إلغاء استلام', actorId = null, pin = null) {
  if (actorId && pin) {
    const isAuth = await verifyReauthentication(actorId, pin);
    if (!isAuth) throw new Error('UNAUTHORIZED: فشل التحقق من الرمز السري لعكس المشتريات');
  }

  return runTransaction(async (tx) => {
    const purchase = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [purchaseId]);
    if (!purchase) throw new Error('NOT_FOUND: أمر الشراء غير موجود');
    if (purchase.status !== PURCHASE_STATUSES.RECEIVED) {
      throw new Error(`INVALID_STATE: لا يمكن عكس أمر شراء بحالة [${purchase.status}]`);
    }

    const lines = await tx.all(`SELECT * FROM purchase_items WHERE purchase_id = ?`, [purchaseId]);

    // Create compensatory RETURN_SUPPLIER ledger entries and deduct returned stock
    for (const line of lines) {
      await tx.run(
        `UPDATE inventory_items 
         SET current_stock_microunits = current_stock_microunits - ?, 
             updated_at = datetime('now', 'localtime') 
         WHERE id = ?`,
        [line.quantity_microunits, line.inventory_item_id]
      );

      const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;
      const reversalKey = `REVERSE_PO_${purchaseId}_ITEM_${line.inventory_item_id}_${Date.now()}`;
      await tx.run(
        `INSERT INTO inventory_ledger (
           inventory_item_id, event_type, quantity_delta_microunits, unit,
           unit_cost_minor, source_type, source_id, idempotency_key,
           actor_id, location_id, cost_basis, reason, created_at
         ) VALUES (?, 'RETURN_SUPPLIER', ?, ?, ?, 'PURCHASE_REVERSAL', ?, ?, ?, 'MAIN_STORE', 'WEIGHTED_AVERAGE', ?, datetime('now', 'localtime'))`,
        [
          line.inventory_item_id,
          -line.quantity_microunits,
          line.unit,
          line.unit_cost_minor,
          String(purchaseId),
          reversalKey,
          validActorId,
          reason
        ]
      );
    }

    await tx.run(
      `UPDATE purchases SET status = 'REVERSED', updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [purchaseId]
    );

    await logAudit(
      purchase.venue_id || 'V_DEFAULT',
      actorId || 'SYSTEM',
      'PURCHASE_REVERSED',
      'PURCHASES',
      String(purchaseId),
      { purchase_id: purchaseId, reason },
      null
    );

    return {
      id: purchaseId,
      status: PURCHASE_STATUSES.REVERSED,
      message: 'تم عكس أمر الشراء وإرجاع الخامات للمورد وتسجيل قيد العكس في السجل بنجاح 🔄'
    };
  });
}

async function getSupplierMaster(supplierId) {
  const supplier = await getQuery(`SELECT * FROM suppliers WHERE id = ?`, [supplierId]);
  if (!supplier) throw new Error('NOT_FOUND: المورد غير موجود');

  const history = await allQuery(
    `SELECT p.id as purchase_id, p.invoice_ref as invoice_number, p.status, p.total_cost,
            p.created_at, pi.inventory_item_id, pi.quantity_microunits / 1000000.0 as quantity,
            pi.unit, pi.unit_cost_minor / 100.0 as unit_cost, i.name as item_name
     FROM purchases p
     JOIN purchase_items pi ON p.id = pi.purchase_id
     JOIN inventory_items i ON pi.inventory_item_id = i.id
     WHERE p.supplier_id = ?
     ORDER BY p.created_at DESC LIMIT 50`,
    [supplierId]
  );

  return {
    ...supplier,
    history
  };
}

async function createPurchaseOrder(data) {
  const { id, supplier_id, venue_id = 'V_DEFAULT', actor_id, document_ref, notes } = data;
  const validActorId = (actor_id && !isNaN(Number(actor_id))) ? Number(actor_id) : 1;
  await runQuery(
    `INSERT INTO purchase_orders (id, supplier_id, venue_id, document_ref, actor_id, status, notes)
     VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
    [id, supplier_id, venue_id, document_ref || null, validActorId, notes || null]
  );
  return { id, status: 'DRAFT' };
}

async function addPurchaseOrderLine(line) {
  const { id, purchase_order_id, inventory_item_id, expected_quantity_microunits, unit = 'KG', unit_cost_minor = 0 } = line;
  const lineTotal = Math.round((expected_quantity_microunits * unit_cost_minor) / 1000000);
  await runQuery(
    `INSERT INTO purchase_order_lines (id, purchase_order_id, inventory_item_id, expected_quantity_microunits, unit, unit_cost_minor, line_total_minor, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [id, purchase_order_id, inventory_item_id, expected_quantity_microunits, unit, unit_cost_minor, lineTotal]
  );
  return { id, status: 'PENDING' };
}

async function submitPurchaseOrder(purchaseOrderId, actorId = null) {
  await runQuery(`UPDATE purchase_orders SET status = 'SUBMITTED', updated_at = datetime('now', 'localtime') WHERE id = ?`, [purchaseOrderId]);
  return { id: purchaseOrderId, status: 'SUBMITTED' };
}

async function approvePurchaseOrder(purchaseOrderId, actorId = null) {
  const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;
  await runQuery(
    `UPDATE purchase_orders SET status = 'APPROVED', approval_actor_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [validActorId, purchaseOrderId]
  );
  return { id: purchaseOrderId, status: 'APPROVED' };
}

async function receivePurchaseOrder(purchaseOrderId, lines = [], actorId = null, idempotencyKey = null) {
  return runTransaction(async (tx) => {
    const po = await tx.get(`SELECT * FROM purchase_orders WHERE id = ?`, [purchaseOrderId]);
    if (!po) throw new Error('NOT_FOUND: Purchase order not found');

    if (po.status === 'RECEIVED' || po.status === 'CLOSED' || (idempotencyKey && po.idempotency_key === idempotencyKey)) {
      return { id: purchaseOrderId, status: 'IDEMPOTENT_RETRY', message: 'Order already received' };
    }

    const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;

    for (const l of lines) {
      const qtyMicro = l.quantity_microunits || 0;
      const unitCost = l.unit_cost_minor || 0;

      // Update line
      await tx.run(
        `UPDATE purchase_order_lines SET received_quantity_microunits = ?, status = 'RECEIVED' WHERE id = ?`,
        [qtyMicro, l.line_id]
      );

      const poLine = await tx.get(`SELECT inventory_item_id, unit FROM purchase_order_lines WHERE id = ?`, [l.line_id]);
      const itemId = poLine ? poLine.inventory_item_id : 1;
      const unit = poLine ? poLine.unit : 'UNIT';

      // Update item stock
      await tx.run(
        `UPDATE inventory_items SET current_stock_microunits = current_stock_microunits + ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
        [qtyMicro, itemId]
      );

      // Append ledger
      const idemp = idempotencyKey ? `${idempotencyKey}_${l.line_id}` : `PO_REC_${purchaseOrderId}_${l.line_id}`;
      await tx.run(
        `INSERT INTO inventory_ledger (
           inventory_item_id, event_type, quantity_delta_microunits, unit,
           unit_cost_minor, source_type, source_id, idempotency_key, actor_id, location_id, reason
         ) VALUES (?, 'RECEIPT', ?, ?, ?, 'PURCHASE_ORDER', ?, ?, ?, ?, 'استلام أمر شراء')`,
        [itemId, qtyMicro, unit, unitCost, purchaseOrderId, idemp, validActorId, l.location_id || 'MAIN_STORE']
      );
    }

    await tx.run(
      `UPDATE purchase_orders SET status = 'RECEIVED', idempotency_key = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [idempotencyKey || null, purchaseOrderId]
    );

    return { id: purchaseOrderId, status: 'SUCCESS', message: 'Received successfully' };
  });
}

module.exports = {
  PURCHASE_STATUSES,
  getPurchases,
  getPurchaseById,
  createPurchaseDraft,
  submitPurchase,
  approvePurchase,
  receivePurchase,
  reversePurchase,
  getSupplierMaster,
  createPurchaseOrder,
  addPurchaseOrderLine,
  submitPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder
};
