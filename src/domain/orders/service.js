/**
 * Orders & KDS Lifecycle Domain Service
 */
const crypto = require('crypto');
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { getMenuItemWithActivePriceAndBOM } = require('../catalog/service');
const { getActiveOffers, evaluateOffer } = require('../catalog/offers');
const { deductBOM } = require('../inventory/service');
const logger = require('../../observability/logger');

async function createOrderSession(tableId, orderType = 'DINE_IN', customerPhone = null, actorId = null) {
  const publicRef = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const res = await runQuery(
    `INSERT INTO order_sessions (public_ref, order_type, table_id, customer_id, status, created_by)
     VALUES (?, ?, ?, ?, 'OPEN', ?)`,
    [publicRef, orderType, tableId || null, customerPhone || null, actorId || null]
  );

  return {
    id: res.lastID,
    public_ref: publicRef,
    order_type: orderType,
    table_id: tableId,
    customer_id: customerPhone,
    status: 'OPEN'
  };
}

async function getOrCreateActiveSessionForTable(tableNumber, actorId = null) {
  const table = await getQuery(`SELECT id, table_number, status FROM tables WHERE table_number = ?`, [tableNumber]);
  if (!table) {
    throw new Error(`NOT_FOUND: الطاولة رقم ${tableNumber} غير مسجلة بالنظام`);
  }

  let session = await getQuery(
    `SELECT * FROM order_sessions WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT') ORDER BY id DESC LIMIT 1`,
    [table.id]
  );

  if (!session) {
    session = await createOrderSession(table.id, 'DINE_IN', null, actorId);
  }

  return session;
}

async function addOrderItem(sessionId, menuItemIdOrName, quantity = 1, modifiers = {}, actorId = null) {
  const catalogItem = await getMenuItemWithActivePriceAndBOM(menuItemIdOrName);
  if (!catalogItem) {
    throw new Error(`NOT_FOUND: الصنف المطلوبة إضافته غير موجود في قائمة الطعام [${menuItemIdOrName}]`);
  }

  const session = await getQuery(`SELECT * FROM order_sessions WHERE id = ?`, [sessionId]);
  if (!session || session.status === 'SETTLED' || session.status === 'VOIDED') {
    throw new Error('INVALID_SESSION: لا يمكن إضافة عناصر لجلسة طلب مغلقة أو ملغاة');
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const unitPriceMinor = catalogItem.price_minor;
  // TODO: taxes and offers computation
  const taxMinor = 0;
  const serviceMinor = 0;
  const discountMinor = 0;
  const offerId = null;
  const catalogVersion = catalogItem.publication_version || 1;
  const quoteSnapshot = JSON.stringify(catalogItem);

  const res = await runQuery(
    `INSERT INTO order_items (
       session_id, menu_item_id, item_name_snapshot, unit_price_minor, quantity, modifiers_json, 
       recipe_version_id, department, waiter_id, price_minor, tax_minor, service_minor, 
       discount_minor, offer_id, catalog_version, quote_snapshot
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      catalogItem.id,
      catalogItem.name,
      unitPriceMinor,
      qty,
      JSON.stringify(modifiers || {}),
      catalogItem.recipe_version_id || null,
      catalogItem.department || 'BARISTA',
      actorId || null,
      unitPriceMinor,
      taxMinor,
      serviceMinor,
      discountMinor,
      offerId,
      catalogVersion,
      quoteSnapshot
    ]
  );

  // Update session subtotal snapshot
  const itemTotal = unitPriceMinor * qty;
  await runQuery(
    `UPDATE order_sessions SET subtotal_minor = subtotal_minor + ?, total_minor = total_minor + ?, version = version + 1 WHERE id = ?`,
    [itemTotal, itemTotal, sessionId]
  );

  return {
    id: res.lastID,
    session_id: sessionId,
    menu_item_id: catalogItem.id,
    item_name: catalogItem.name,
    unit_price: unitPriceMinor / 100,
    quantity: qty,
    department: catalogItem.department,
    modifiers
  };
}

async function submitOrderWithBOM(orderData, actorId = null) {
  const { table_number, item_name, quantity = 1, sugar_level, roast_type, customer_phone, waiter_id } = orderData;
  const tNum = parseInt(table_number, 10) || 0;
  const actualWaiterId = actorId || waiter_id || null;

  // Fetch active offers to apply automatically
  const activeOffers = await getActiveOffers();

  return runTransaction(async (tx) => {
    // 1. Resolve table & session
    let tableId = null;
    if (tNum > 0) {
      let table = await tx.get(`SELECT id, status FROM tables WHERE table_number = ?`, [tNum]);
      if (!table) {
        const tblRes = await tx.run(`INSERT INTO tables (table_number, status) VALUES (?, 'SEATED')`, [tNum]);
        tableId = tblRes.lastID;
      } else {
        tableId = table.id;
        await tx.run(
          `UPDATE tables SET status = CASE WHEN status = 'VACANT' THEN 'SEATED' ELSE status END,
                  first_ordered_at = COALESCE(first_ordered_at, datetime('now', 'localtime')),
                  last_ordered_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [tableId]
        );
      }
    }

    let session = await tx.get(
      `SELECT * FROM order_sessions WHERE table_id = ? AND status IN ('OPEN', 'PENDING_PAYMENT') ORDER BY id DESC LIMIT 1`,
      [tableId]
    );

    let validCustomerPhone = null;
    if (customer_phone && typeof customer_phone === 'string' && customer_phone.trim()) {
      const cleanPhone = customer_phone.trim();
      const existingCustomer = await tx.get(`SELECT phone FROM customers WHERE phone = ?`, [cleanPhone]);
      if (!existingCustomer) {
        await tx.run(
          `INSERT INTO customers (phone, name, points, total_spent, credit_balance, visit_count) VALUES (?, ?, 0, 0, 0, 1)`,
          [cleanPhone, orderData.customer_name || 'عميل']
        );
      } else {
        await tx.run(
          `UPDATE customers SET visit_count = visit_count + 1, last_visit = datetime('now', 'localtime') WHERE phone = ?`,
          [cleanPhone]
        );
      }
      validCustomerPhone = cleanPhone;
    }

    if (!session) {
      const publicRef = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const sRes = await tx.run(
        `INSERT INTO order_sessions (public_ref, order_type, table_id, customer_id, status, created_by)
         VALUES (?, 'DINE_IN', ?, ?, 'OPEN', ?)`,
        [publicRef, tableId, validCustomerPhone, actualWaiterId]
      );
      session = { id: sRes.lastID, public_ref: publicRef };
    }

    // 2. Resolve items & BOM
    const rawItems = (Array.isArray(orderData.items) && orderData.items.length > 0)
      ? orderData.items
      : [{
          name: item_name || 'قهوة تركي',
          item_name: item_name || 'قهوة تركي',
          quantity: quantity || 1,
          sugar_level: sugar_level || 'مظبوط',
          roast_type: roast_type || 'افتراضي',
          price: orderData.price || 0,
          department: orderData.department || null
        }];

    const createdItems = [];

    for (const rawItem of rawItems) {
      const targetItemName = rawItem.name || rawItem.item_name || 'قهوة تركي';
      const targetQty = Math.max(1, parseInt(rawItem.quantity || rawItem.qty || 1, 10) || 1);
      const targetSugar = rawItem.sugar_level || rawItem.sugar || sugar_level || null;
      const targetRoast = rawItem.roast_type || rawItem.roast || roast_type || null;

      let catalogItem = await getMenuItemWithActivePriceAndBOM(targetItemName);
      if (!catalogItem) {
        // Fallback lookup or create temporary ad-hoc representation
        catalogItem = await tx.get(`SELECT * FROM menu_items LIMIT 1`);
        if (catalogItem) {
          catalogItem.name = targetItemName;
          catalogItem.price_minor = catalogItem.price_minor || (rawItem.price ? Math.round(rawItem.price * 100) : 4500);
          catalogItem.department = rawItem.department || catalogItem.department || 'BARISTA';
        } else {
          catalogItem = { id: 1, name: targetItemName, price_minor: 4500, department: rawItem.department || 'BARISTA', publication_version: 1 };
        }
      }

      const qty = targetQty;
      const modifiers = { sugar_level: targetSugar, roast_type: targetRoast };

      // 3. Evaluate offers
      let itemDiscountMinor = 0;
      let appliedOfferId = null;
      for (const offer of activeOffers) {
        const d = evaluateOffer(offer, catalogItem, qty);
        if (d > itemDiscountMinor) {
          itemDiscountMinor = d;
          appliedOfferId = offer.id;
        }
      }

      const taxMinor = 0;
      const serviceMinor = 0;
      const catalogVersion = catalogItem.publication_version || 1;
      const quoteSnapshot = JSON.stringify(catalogItem);

      // 4. Create Order Item row
      const itemRes = await tx.run(
        `INSERT INTO order_items (
           session_id, menu_item_id, item_name_snapshot, unit_price_minor, quantity, modifiers_json, 
           recipe_version_id, department, waiter_id, price_minor, tax_minor, service_minor, 
           discount_minor, offer_id, catalog_version, quote_snapshot
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          catalogItem.id,
          catalogItem.name,
          catalogItem.price_minor,
          qty,
          JSON.stringify(modifiers),
          catalogItem.active_recipe_version_id || null,
          catalogItem.department || 'BARISTA',
          actualWaiterId,
          catalogItem.price_minor * qty,
          taxMinor,
          serviceMinor,
          itemDiscountMinor,
          appliedOfferId,
          catalogVersion,
          quoteSnapshot
        ]
      );

      const orderItemId = itemRes.lastID;

      // 5. BOM Inventory Deductions via immutable inventory_ledger
      await deductBOM(tx, orderItemId, catalogItem, qty, actualWaiterId);

      // 6. Update session totals
      const lineTotal = (catalogItem.price_minor * qty) - itemDiscountMinor;
      await tx.run(
        `UPDATE order_sessions SET subtotal_minor = subtotal_minor + ?, total_minor = total_minor + ?, version = version + 1 WHERE id = ?`,
        [lineTotal, lineTotal, session.id]
      );

      // 7. Insert print job for BOH Kitchen Ticket
      const printJobId = crypto.randomUUID();
      const ticketPayload = JSON.stringify({
        order_id: orderItemId,
        table_number: tNum,
        item_name: catalogItem.name,
        quantity: qty,
        department: catalogItem.department,
        sugar_level: targetSugar || 'مظبوط',
        roast_type: targetRoast || 'افتراضي',
        waiter_id: actualWaiterId,
        created_at: new Date().toLocaleString('ar-EG')
      });

      await tx.run(
        `INSERT INTO print_jobs (id, job_type, payload_json, status) VALUES (?, 'KITCHEN_TICKET', ?, 'PENDING')`,
        [printJobId, ticketPayload]
      );

      // 7. Insert outbox event for real-time WebSocket broadcast
      await tx.run(
        `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json)
         VALUES (?, 'ORDER_PLACED', 'ORDER_ITEM', ?, ?)`,
        [crypto.randomUUID(), String(orderItemId), ticketPayload]
      );

      createdItems.push({
        id: orderItemId,
        session_id: session.id,
        table_number: tNum,
        item_name: catalogItem.name,
        price: catalogItem.price,
        quantity: qty,
        department: catalogItem.department,
        kds_status: 'PENDING',
        sugar_level: targetSugar,
        roast_type: targetRoast,
        waiter_id: actualWaiterId
      });
    }

    return createdItems.length === 1
      ? createdItems[0]
      : { id: createdItems[0].id, session_id: session.id, items: createdItems, count: createdItems.length, order: createdItems[0] };
  });
}

const VALID_KDS_TRANSITIONS = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['READY', 'CANCEL_REQUESTED'],
  READY: ['DELIVERED'],
  DELIVERED: []
};

async function updateKdsStatus(orderItemId, targetStatus, actor = null) {
  const item = await getQuery(`SELECT * FROM order_items WHERE id = ?`, [orderItemId]);
  if (!item) {
    throw new Error(`NOT_FOUND: الطلب رقم ${orderItemId} غير موجود`);
  }

  const current = item.kds_status;
  const allowed = VALID_KDS_TRANSITIONS[current] || [];
  if (!allowed.includes(targetStatus) && targetStatus !== current) {
    throw new Error(`INVALID_STATE_TRANSITION: لا يمكن تغيير حالة الطلب من ${current} إلى ${targetStatus}`);
  }

  await runQuery(
    `UPDATE order_items SET kds_status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [targetStatus, orderItemId]
  );

  // Broadcast realtime event via outbox
  const payload = JSON.stringify({ id: orderItemId, kds_status: targetStatus, department: item.department });
  await runQuery(
    `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json)
     VALUES (?, 'KDS_STATUS_CHANGED', 'ORDER_ITEM', ?, ?)`,
    [crypto.randomUUID(), String(orderItemId), payload]
  );

  return { id: orderItemId, kds_status: targetStatus, department: item.department };
}

async function requestOrderCancellation(orderItemId, waiterId = null, reason = 'طلب العميل') {
  const item = await getQuery(`SELECT * FROM order_items WHERE id = ?`, [orderItemId]);
  if (!item) throw new Error('الطلب غير موجود');

  // If still PENDING, can cancel immediately
  if (item.kds_status === 'PENDING') {
    await runTransaction(async (tx) => {
      await tx.run(`UPDATE order_items SET status = 'CANCELLED', kds_status = 'CANCELLED', cancel_reason = ? WHERE id = ?`, [reason, orderItemId]);
      // Reverse inventory
      const ledgerConsumptions = await tx.all(`SELECT * FROM inventory_ledger WHERE source_type = 'ORDER_ITEM' AND source_id = ?`, [String(orderItemId)]);
      for (const entry of ledgerConsumptions) {
        const reversalMicrounits = Math.abs(entry.quantity_delta_microunits);
        await tx.run(`UPDATE inventory_items SET current_stock_microunits = current_stock_microunits + ? WHERE id = ?`, [reversalMicrounits, entry.inventory_item_id]);
        await tx.run(
          `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, source_type, source_id, idempotency_key, reason, actor_id)
           VALUES (?, 'REVERSAL', ?, ?, 'ORDER_ITEM_CANCEL', ?, ?, ?, ?)`,
          [entry.inventory_item_id, reversalMicrounits, entry.unit, String(orderItemId), `REV_${entry.idempotency_key}`, reason, waiterId]
        );
      }
    });
    return { success: true, id: orderItemId, status: 'CANCELLED', message: 'تم إلغاء الطلب واسترجاع الخامات مباشرة' };
  }

  // If already ACCEPTED or READY, initiate cancellation handshake
  await runQuery(`UPDATE order_items SET edit_request = 'CANCEL_REQUESTED', cancel_reason = ? WHERE id = ?`, [reason, orderItemId]);
  return { success: true, id: orderItemId, edit_request: 'CANCEL_REQUESTED', message: 'تم إرسال طلب إلغاء لشاشة التحضير بانتظار الموافقة' };
}

async function resolveOrderCancellation(orderItemId, approved = false, actorId = null) {
  const item = await getQuery(`SELECT * FROM order_items WHERE id = ?`, [orderItemId]);
  if (!item) throw new Error('الطلب غير موجود');

  if (approved) {
    await runTransaction(async (tx) => {
      await tx.run(`UPDATE order_items SET status = 'CANCELLED', kds_status = 'CANCELLED', edit_request = NULL WHERE id = ?`, [orderItemId]);
      // Reverse inventory
      const ledgerConsumptions = await tx.all(`SELECT * FROM inventory_ledger WHERE source_type = 'ORDER_ITEM' AND source_id = ?`, [String(orderItemId)]);
      for (const entry of ledgerConsumptions) {
        const reversalMicrounits = Math.abs(entry.quantity_delta_microunits);
        await tx.run(`UPDATE inventory_items SET current_stock_microunits = current_stock_microunits + ? WHERE id = ?`, [reversalMicrounits, entry.inventory_item_id]);
        await tx.run(
          `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, source_type, source_id, idempotency_key, reason, actor_id)
           VALUES (?, 'REVERSAL', ?, ?, 'ORDER_ITEM_CANCEL', ?, ?, ?, ?)`,
          [entry.inventory_item_id, reversalMicrounits, entry.unit, String(orderItemId), `REV_${entry.idempotency_key}`, 'موافقة إلغاء KDS', actorId]
        );
      }
    });
    return { success: true, message: 'تمت الموافقة على إلغاء الطلب واسترجاع المخزون' };
  } else {
    await runQuery(`UPDATE order_items SET edit_request = NULL WHERE id = ?`, [orderItemId]);
    return { success: true, message: 'تم رفض طلب الإلغاء، الطلب مستمر في التحضير' };
  }
}

async function getPendingOrdersByDepartment(department = null) {
  let sql = `
    SELECT oi.id, oi.session_id, oi.item_name_snapshot as item_name, oi.quantity,
           oi.modifiers_json, oi.department, oi.kds_status, oi.edit_request, oi.cancel_reason,
           oi.created_at, os.table_id, t.table_number, t.custom_name as table_custom_name
    FROM order_items oi
    JOIN order_sessions os ON oi.session_id = os.id
    LEFT JOIN tables t ON os.table_id = t.id
    WHERE oi.status = 'ACTIVE' AND oi.kds_status != 'DELIVERED'
  `;
  const params = [];
  if (department) {
    sql += ` AND oi.department = ?`;
    params.push(String(department).toUpperCase());
  }
  sql += ` ORDER BY oi.id ASC`;

  const rows = await allQuery(sql, params);
  return rows.map(r => {
    let mods = {};
    try { mods = JSON.parse(r.modifiers_json || '{}'); } catch (e) {}
    return {
      ...r,
      table_number: r.table_number || 0,
      sugar_level: mods.sugar_level || 'مظبوط',
      roast_type: mods.roast_type || 'افتراضي'
    };
  });
}

async function getPastOrdersByDepartment(department = null, { limit = 50, offset = 0 } = {}) {
  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
  const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

  let countSql = `
    SELECT COUNT(*) as total
    FROM order_items oi
    JOIN order_sessions os ON oi.session_id = os.id
    WHERE oi.kds_status = 'DELIVERED'
  `;
  let sql = `
    SELECT oi.id, oi.session_id, oi.item_name_snapshot as item_name, oi.quantity,
           oi.modifiers_json, oi.department, oi.kds_status, oi.edit_request, oi.cancel_reason,
           oi.created_at, os.table_id, t.table_number, t.custom_name as table_custom_name
    FROM order_items oi
    JOIN order_sessions os ON oi.session_id = os.id
    LEFT JOIN tables t ON os.table_id = t.id
    WHERE oi.kds_status = 'DELIVERED'
  `;
  const countParams = [];
  const params = [];
  if (department) {
    countSql += ` AND oi.department = ?`;
    countParams.push(String(department).toUpperCase());
    sql += ` AND oi.department = ?`;
    params.push(String(department).toUpperCase());
  }
  sql += ` ORDER BY oi.updated_at DESC LIMIT ? OFFSET ?`;
  params.push(parsedLimit, parsedOffset);

  const totalRow = await getQuery(countSql, countParams);
  const total = totalRow ? totalRow.total : 0;

  const rows = await allQuery(sql, params);
  const orders = rows.map(r => {
    let mods = {};
    try { mods = JSON.parse(r.modifiers_json || '{}'); } catch (e) {}
    return {
      ...r,
      table_number: r.table_number || 0,
      sugar_level: mods.sugar_level || 'مظبوط',
      roast_type: mods.roast_type || 'افتراضي',
      notes: mods.notes || ''
    };
  });

  return {
    orders,
    pagination: {
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      hasMore: (parsedOffset + orders.length) < total
    }
  };
}

const VALID_ORDER_SESSION_TRANSITIONS = {
  OPEN: ['SUBMITTED', 'IN_PREPARATION', 'CANCELLED', 'VOIDED'],
  SUBMITTED: ['IN_PREPARATION', 'PARTIALLY_READY', 'READY', 'CANCELLED', 'VOIDED'],
  IN_PREPARATION: ['PARTIALLY_READY', 'READY', 'SERVED', 'CANCELLED', 'VOIDED'],
  PARTIALLY_READY: ['READY', 'SERVED', 'PAYMENT_PENDING', 'CANCELLED', 'VOIDED'],
  READY: ['SERVED', 'PAYMENT_PENDING', 'PAID', 'CANCELLED', 'VOIDED'],
  SERVED: ['PAYMENT_PENDING', 'PAID', 'CANCELLED', 'VOIDED'],
  PAYMENT_PENDING: ['PAID', 'CANCELLED', 'VOIDED', 'REFUNDED'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED'],
  CANCELLED: [],
  VOIDED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ['REFUNDED']
};

async function updateOrderSessionStatus(sessionId, targetStatus, actorId = null, expectedVersion = null) {
  const normTarget = String(targetStatus).toUpperCase();
  return runTransaction(async (tx) => {
    let order = await tx.get(`SELECT * FROM v3_order_sessions WHERE id = ?`, [sessionId]);
    let isV3 = true;
    if (!order) {
      order = await tx.get(`SELECT * FROM order_sessions WHERE id = ? OR public_ref = ?`, [sessionId, sessionId]);
      isV3 = false;
    }
    if (!order) {
      throw new Error(`NOT_FOUND: جلسة الطلب غير موجودة [${sessionId}]`);
    }

    const currentStatus = order.status;
    if (expectedVersion !== null && expectedVersion !== undefined) {
      const curVer = order.version || 1;
      if (curVer !== expectedVersion) {
        const err = new Error(`تعارض التحديث المتزامن: إصدار الطلب هو ${curVer} بينما المطلوب هو ${expectedVersion}`);
        err.statusCode = 409;
        throw err;
      }
    }

    if (currentStatus !== normTarget) {
      const allowed = VALID_ORDER_SESSION_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(normTarget)) {
        throw new Error(`INVALID_STATE_TRANSITION: لا يمكن تغيير حالة جلسة الطلب من ${currentStatus} إلى ${normTarget}`);
      }
    }

    if (isV3) {
      await tx.run(
        `UPDATE v3_order_sessions SET status = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
        [normTarget, order.id]
      );
    } else {
      await tx.run(
        `UPDATE order_sessions SET status = ?, version = version + 1 WHERE id = ?`,
        [normTarget, order.id]
      );
    }

    return {
      success: true,
      order_id: order.id,
      previous_status: currentStatus,
      status: normTarget,
      version: (order.version || 1) + 1
    };
  });
}

module.exports = {
  createOrderSession,
  getOrCreateActiveSessionForTable,
  addOrderItem,
  submitOrderWithBOM,
  updateKdsStatus,
  requestOrderCancellation,
  resolveOrderCancellation,
  getPendingOrdersByDepartment,
  getPastOrdersByDepartment,
  updateOrderSessionStatus,
  VALID_ORDER_SESSION_TRANSITIONS
};
