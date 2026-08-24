const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function processReversal(venueId, sessionId, reversalData = {}) {
  return runTransaction(async (tx) => {
    // 1. Verify session
    let order = await tx.get(
      `SELECT * FROM v3_order_sessions WHERE id = ?`,
      [sessionId]
    );
    let isV3 = true;
    if (!order) {
      order = await tx.get(`SELECT * FROM order_sessions WHERE id = ? OR public_ref = ?`, [sessionId, sessionId]);
      isV3 = false;
    }
    if (!order) {
      throw new Error(`NOT_FOUND: جلسة الطلب غير موجودة [${sessionId}]`);
    }

    const revType = reversalData.type;
    const allowedTypes = ['CANCELLED_UNPAID', 'VOID_UNPAID', 'VOID_PAID', 'REFUND_FULL', 'REFUND_PARTIAL', 'ADJUSTMENT'];
    if (!allowedTypes.includes(revType)) {
      throw new Error(`INVALID_REVERSAL_TYPE: نوع العملية غير معروف: ${revType}`);
    }

    // 2. Validate paths
    const isPaid = ['PAID', 'SETTLED', 'PARTIALLY_REFUNDED'].includes(order.status);
    if (revType === 'REFUND_FULL' || revType === 'VOID_PAID' || revType === 'REFUND_PARTIAL') {
      if (!isPaid) {
        const err = new Error(`INVALID_STATE_TRANSITION: لا يمكن إجراء ${revType} لطلب غير مسدد (حالة الطلب: ${order.status})`);
        err.statusCode = 400;
        throw err;
      }
    } else if (revType === 'CANCELLED_UNPAID' || revType === 'VOID_UNPAID') {
      if (['PAID', 'SETTLED'].includes(order.status)) {
        const err = new Error(`INVALID_STATE_TRANSITION: لا يمكن إلغاء طلب مسدد ومغلق كطلب غير مسدد - يجب استخدام استرجاع مالي (VOID_PAID / REFUND_FULL)`);
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Permission & Approver Validation
    const approverId = reversalData.approval_actor_id || reversalData.actor_id;
    if (!approverId) {
      const err = new Error('UNAUTHORIZED: يلزم تحديد المسؤول المعتمد للعملية المالية');
      err.statusCode = 401;
      throw err;
    }

    // ULTIMATE VOID RULE: Paid voids require OWNER or SUPER_ADMIN role
    if (revType === 'VOID_PAID') {
      let approver = null;
      try {
        approver = await tx.get(
          `SELECT u.id, u.role_id, r.name as role_name 
           FROM v3_users u 
           LEFT JOIN roles r ON u.role_id = r.id 
           WHERE u.id = ?`,
          [approverId]
        );
      } catch (e) {}

      if (!approver) {
        try {
          approver = await tx.get(
            `SELECT u.id, u.role, u.role_id, r.name as role_name 
             FROM users u 
             LEFT JOIN roles r ON u.role_id = r.id 
             WHERE u.id = ?`,
            [approverId]
          );
        } catch (e) {}
      }

      const roleName = (approver ? (approver.role_name || approver.role_id || approver.role || '') : '').toUpperCase();
      if (!['OWNER', 'R_OWNER', 'SUPER_ADMIN', 'R_SUPER_ADMIN', 'ADMIN'].includes(roleName)) {
        const err = new Error('FORBIDDEN: صلاحية إلغاء الفواتير المسددة والمغلقة مالياً مقتصرة حصرياً على المالك (OWNER / SUPER_ADMIN)');
        err.statusCode = 403;
        throw err;
      }
    }

    // 4. Reverse Inventory Consumption (if order items were deducted)
    let totalReversedInventory = 0;
    try {
      const ledgerConsumptions = await tx.all(
        `SELECT * FROM inventory_ledger WHERE (source_type = 'ORDER_ITEM' OR source_type = 'ORDER_SESSION') AND source_id LIKE ?`,
        [`%${order.id}%`]
      );
      for (const entry of ledgerConsumptions) {
        const reversalMicro = Math.abs(entry.quantity_delta_microunits);
        if (reversalMicro > 0) {
          await tx.run(
            `UPDATE inventory_items SET current_stock_microunits = current_stock_microunits + ? WHERE id = ?`,
            [reversalMicro, entry.inventory_item_id]
          );
          await tx.run(
            `INSERT INTO inventory_ledger (inventory_item_id, event_type, quantity_delta_microunits, unit, source_type, source_id, idempotency_key, reason, actor_id)
             VALUES (?, 'REVERSAL', ?, ?, 'REVERSAL', ?, ?, ?, ?)`,
            [
              entry.inventory_item_id,
              reversalMicro,
              entry.unit,
              String(order.id),
              `REV_${entry.idempotency_key || entry.id}_${Date.now()}`,
              reversalData.reason || 'إلغاء واسترجاع المخزون',
              approverId
            ]
          );
          totalReversedInventory++;
        }
      }
    } catch (e) {}

    // 5. Record Immutable Reversal Ledger Entry
    const reversalId = `REV-${Date.now()}`;
    const amountMinor = reversalData.amount_minor !== undefined ? Number(reversalData.amount_minor) : (order.total_minor || 0);

    await tx.run(
      `INSERT INTO reversals (id, venue_id, order_session_id, payment_id, type, reason, amount_minor, actor_id, approval_actor_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reversalId,
        venueId || order.venue_id || 'V_DEFAULT',
        order.id,
        reversalData.payment_id || null,
        revType,
        reversalData.reason || 'إلغاء/استرجاع',
        amountMinor,
        reversalData.actor_id || approverId,
        approverId,
        reversalData.idempotency_key || null
      ]
    );

    // 6. Update Order Status
    let newStatus = order.status;
    if (revType === 'CANCELLED_UNPAID' || revType === 'VOID_UNPAID') {
      newStatus = 'CANCELLED';
    } else if (revType === 'VOID_PAID' || revType === 'REFUND_FULL') {
      newStatus = 'REFUNDED';
    } else if (revType === 'REFUND_PARTIAL') {
      newStatus = 'PARTIALLY_REFUNDED';
    }

    if (isV3) {
      await tx.run(
        `UPDATE v3_order_sessions SET status = ?, updated_at = datetime('now', 'localtime'), version = version + 1 WHERE id = ?`,
        [newStatus, order.id]
      );
      if (order.table_id && (newStatus === 'CANCELLED' || newStatus === 'REFUNDED')) {
        await tx.run(`UPDATE v3_tables SET status = 'AVAILABLE', version = version + 1 WHERE id = ?`, [order.table_id]);
      }
    } else {
      await tx.run(
        `UPDATE order_sessions SET status = ?, version = version + 1 WHERE id = ?`,
        [newStatus, order.id]
      );
      if (order.table_id && (newStatus === 'CANCELLED' || newStatus === 'REFUNDED')) {
        await tx.run(`UPDATE tables SET status = 'AVAILABLE' WHERE id = ?`, [order.table_id]);
      }
    }

    return {
      success: true,
      status: 'SUCCESS',
      reversal_id: reversalId,
      order_id: order.id,
      reversal_type: revType,
      new_status: newStatus,
      amount_minor: amountMinor,
      reversed_inventory_entries: totalReversedInventory
    };
  });
}

module.exports = { processReversal };
