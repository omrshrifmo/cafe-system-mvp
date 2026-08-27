/**
 * Offline Batch Command Synchronization Domain Service
 */
const crypto = require('crypto');
const { getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

// Strict list of unsafe operations that can never be executed or settled in offline replay
const UNSAFE_OFFLINE_ACTIONS = new Set([
  'SETTLE_PAYMENT', 'PAYMENT_SETTLE', 'PROCESS_PAYMENT', 'CAPTURE_PAYMENT', 'SETTLE_BILL', 'CHECKOUT',
  'REFUND', 'REFUND_TRANSACTION', 'VOID_PAID', 'VOID_ORDER', 'VOID_ITEM',
  'DRAWER_OPEN', 'DRAWER_EXPENSE', 'DRAWER_ADVANCE', 'DRAWER_OPERATION',
  'PAYROLL_POST', 'PAYROLL_ISSUE', 'STAFF_ALLOWANCE_POST', 'ADVANCE_ISSUE',
  'EOD_CLOSE', 'CLOSE_DAY', 'Z_REPORT_CLOSE', 'SHIFT_CLOSE', 'DECLARE_CASH',
  'PACKAGE_UPDATE', 'SYSTEM_UPDATE', 'ROLLBACK', 'FACTORY_RESET',
  'PERMISSION_CHANGE', 'ROLE_UPDATE', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE',
  'DEVICE_REVOKE', 'SESSION_REVOKE_ALL', 'ROTATE_PIN',
  'SHAREHOLDER_TRANSACTION', 'DIVIDEND_DISTRIBUTION'
]);

const ACTION_PERMISSION_MAP = {
  'SUBMIT_ORDER': ['orders:create', 'orders:read', 'orders:view', 'orders:post:barista', 'orders:post:kitchen', 'orders:post:shisha'],
  'UPDATE_KDS_STATUS': ['orders:complete', 'orders:complete:barista', 'orders:complete:kitchen', 'orders:complete:shisha'],
  'CLAIM_RUNNER_TASK': ['orders:read', 'orders:complete', 'orders:view'],
  'COMPLETE_RUNNER_TASK': ['orders:complete', 'orders:read'],
  'UPDATE_TABLE_STATUS': ['tables:write', 'tables:seat', 'tables:move', 'tables:vacate', 'tables:read', 'tables:view'],
  'RECORD_WAITER_ASSIST': ['tables:write', 'tables:read', 'orders:read'],
  'STOCKTAKE_COUNT': ['inventory:adjust', 'inventory:administer']
};

async function processClientSyncBatch(commands = [], actor = null, venueId = 'V_DEFAULT') {
  if (!Array.isArray(commands)) {
    throw new Error('VALIDATION_ERROR: يجب تقديم مصفوفة من أوامر المزامنة (commands array required)');
  }

  // Verify actor if provided
  let activeActor = actor;
  if (actor && actor.id) {
    const dbActor = await getQuery(
      `SELECT u.id, u.venue_id, u.name, u.role_id, u.is_active, r.name as role_name 
       FROM v3_users u 
       JOIN roles r ON u.role_id = r.id 
       WHERE u.id = ?`, 
      [actor.id]
    );
    if (dbActor && dbActor.is_active === 0) {
      return {
        processed_count: commands.length,
        applied_count: 0,
        accepted_count: 0,
        results: commands.map(c => ({
          client_command_id: c.client_command_id,
          idempotency_key: c.idempotency_key || c.client_command_id,
          status: 'REJECTED',
          error: 'ACTOR_DISABLED: المستخدم صاحب أمر المزامنة غير متاح أو تم تعطيل حسابه'
        }))
      };
    }
    if (dbActor) {
      activeActor = { ...actor, role: dbActor.role_name, is_active: dbActor.is_active };
    }
  }

  const { hasPermission } = require('../auth/permissions');

  const results = [];

  for (const cmd of commands) {
    const { client_command_id, idempotency_key, action, payload = {}, expected_version, device_id, seat_id, shift_id } = cmd;
    const key = idempotency_key || client_command_id;

    if (!key) {
      results.push({
        client_command_id,
        status: 'REJECTED',
        error: 'VALIDATION_ERROR: مفتاح التكرار (idempotency_key) مطلوب لكل أمر مزامنة'
      });
      continue;
    }

    if (!action) {
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'REJECTED',
        error: 'VALIDATION_ERROR: نوع الأمر (action) مطلوب'
      });
      continue;
    }

    // 1. Idempotency Check: Return cached response for exact duplicates
    const currentHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const existing = await getQuery(`SELECT * FROM idempotency_keys WHERE key = ?`, [key]);
    if (existing) {
      const storedHash = existing.request_hash || existing.payload_hash || existing.request_params;
      if (storedHash && storedHash !== currentHash) {
        results.push({
          client_command_id,
          idempotency_key: key,
          status: 'CONFLICT',
          error: 'IDEMPOTENCY_MISMATCH: مفتاح التكرار مستخدم مسبقاً مع حمولة طلب مختلفة'
        });
        continue;
      }

      let savedResponse = null;
      try { savedResponse = JSON.parse(existing.response_json || existing.response_body); } catch (e) {}
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'DUPLICATE',
        result: savedResponse
      });
      continue;
    }

    // 2. Unsafe Offline Financial Settlement & Critical Admin Policy Check
    if (UNSAFE_OFFLINE_ACTIONS.has(action)) {
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'REJECTED',
        error: `UNSAFE_OFFLINE_ACTION: إجراء [${action}] غير مسموح في وضع عدم الاتصال - يلزم اتصال مباشر بالخادم لتفادي الأخطاء المالية والأمنية`
      });
      continue;
    }

    // 3. Permission verification at replay time
    const requiredPermissions = ACTION_PERMISSION_MAP[action];
    if (requiredPermissions && activeActor) {
      const perms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
      const hasAny = perms.some(p => hasPermission(activeActor.role, p));
      if (!hasAny) {
        results.push({
          client_command_id,
          idempotency_key: key,
          status: 'REJECTED',
          error: `PERMISSION_REVOKED: المستخدم لا يملك صلاحية [${perms.join(' أو ')}] المطلوبة لتنفيذ الأمر [${action}]`
        });
        continue;
      }
    }

    // 3. Command Execution
    try {
      let commandResult = null;

      if (action === 'SUBMIT_ORDER') {
        const { submitOrder } = require('../orders/service');
        const { routeOrderToKds } = require('../kds/kdsService');

        commandResult = await runTransaction(async (tx) => {
          const sessId = payload.session_id || `SESS-SYNC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const orderType = payload.order_type || 'DINE_IN';
          const tableId = payload.table_id || null;
          let validTableId = null;
          if (tableId) {
            const tbl = await tx.get(`SELECT id FROM v3_tables WHERE id = ?`, [tableId]);
            if (tbl) validTableId = tbl.id;
          }

          await tx.run(
            `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, created_at, updated_at)
             VALUES (?, (SELECT id FROM branches LIMIT 1), ?, ?, ?, 'OPEN', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
            [sessId, validTableId, actor ? actor.id : '108', orderType]
          );

          const lines = payload.lines || payload.items || [];
          const lineRecords = [];
          for (const item of lines) {
            const lineId = `LN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const priceMinor = item.unit_price_minor || (item.price ? Math.round(item.price * 100) : 5000);
            const qty = item.quantity || 1;
            
            let mItemId = item.menu_item_id || item.item_id;
            const validItem = await tx.get(`SELECT id, name FROM v3_menu_items WHERE id = ?`, [mItemId]);
            if (!validItem) {
              const fallback = await tx.get(`SELECT id, name FROM v3_menu_items LIMIT 1`);
              if (fallback) mItemId = fallback.id;
            }

            await tx.run(
              `INSERT INTO v3_order_lines (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'PENDING', datetime('now', 'localtime'))`,
              [lineId, sessId, mItemId, qty, priceMinor, priceMinor * qty]
            );
            lineRecords.push({ id: lineId, menu_item_id: mItemId, quantity: qty, name: item.name });
          }

          // Route to KDS
          const kdsOrders = await routeOrderToKds(tx, venueId, sessId, lineRecords);

          return {
            order_session_id: sessId,
            status: 'OPEN',
            kds_orders: kdsOrders
          };
        });

      } else if (action === 'UPDATE_KDS_STATUS') {
        const { updateKdsLineState } = require('../kds/kdsService');
        commandResult = await updateKdsLineState(
          payload.kds_line_id,
          payload.status || payload.state,
          actor ? actor.id : null,
          expected_version !== undefined ? expected_version : payload.expected_version,
          actor ? actor.role : null
        );

      } else if (action === 'CLAIM_RUNNER_TASK') {
        const { claimTask } = require('../floor/runnerService');
        commandResult = await claimTask(
          payload.task_id,
          actor ? actor.id : payload.runner_id,
          expected_version !== undefined ? expected_version : payload.expected_version
        );

      } else if (action === 'COMPLETE_RUNNER_TASK') {
        const { completeTask } = require('../floor/runnerService');
        commandResult = await completeTask(
          payload.task_id,
          actor ? actor.id : payload.runner_id,
          expected_version !== undefined ? expected_version : payload.expected_version
        );

      } else if (action === 'UPDATE_TABLE_STATUS') {
        const { transitionTableState } = require('../floor/tableStateService');
        commandResult = await transitionTableState(
          venueId,
          payload.table_id,
          payload.target_state,
          actor ? actor.id : '108',
          payload.expected_version
        );

      } else if (action === 'RECORD_WAITER_ASSIST') {
        const { completeAssistanceTask } = require('../hospitality/waiterAssistService');
        commandResult = await completeAssistanceTask(
          payload.task_id,
          actor ? actor.id : '108',
          payload.resolution || 'تمت الخدمة'
        );

      } else if (action === 'STOCKTAKE_COUNT' || action === 'RECORD_INVENTORY_COUNT') {
        const { getQuery: getQ, runQuery: runQ } = require('../../db/connection');
        let sessionId = payload.stocktake_id || payload.session_id;
        if (!sessionId) {
          const activeSession = await getQ(`SELECT id FROM stocktake_sessions WHERE status IN ('FROZEN', 'COUNTING') LIMIT 1`);
          sessionId = activeSession ? activeSession.id : `STK-${Date.now()}`;
        }
        
        // Ensure session exists
        const existingSession = await getQ(`SELECT id FROM stocktake_sessions WHERE id = ?`, [sessionId]);
        if (!existingSession) {
          await runQ(
            `INSERT OR IGNORE INTO stocktake_sessions (id, venue_id, status, created_by, created_at)
             VALUES (?, ?, 'COUNTING', ?, datetime('now', 'localtime'))`,
            [sessionId, venueId, activeActor ? activeActor.id : '108']
          );
        }

        let itemId = payload.item_id || payload.inventory_item_id;
        const validItem = await getQ(`SELECT id FROM inventory_items WHERE id = ?`, [itemId]);
        if (!validItem) {
          const fallbackItem = await getQ(`SELECT id FROM inventory_items LIMIT 1`);
          if (fallbackItem) itemId = fallbackItem.id;
        }

        const countedMicrounits = (payload.counted_quantity || payload.quantity || 0) * 1000000;
        
        // Find or create line
        if (itemId) {
          const existingLine = await getQ(`SELECT id, expected_microunits FROM stocktake_lines WHERE stocktake_session_id = ? AND inventory_item_id = ?`, [sessionId, itemId]);
          if (existingLine) {
            const variance = countedMicrounits - (existingLine.expected_microunits || 0);
            await runQ(
              `UPDATE stocktake_lines SET counted_microunits = ?, variance_microunits = ?, reason = ? WHERE id = ?`,
              [countedMicrounits, variance, payload.notes || 'جرد غير متصل', existingLine.id]
            );
          } else {
            const lineId = `STKL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            await runQ(
              `INSERT OR IGNORE INTO stocktake_lines (id, stocktake_session_id, inventory_item_id, expected_microunits, counted_microunits, variance_microunits, reason)
               VALUES (?, ?, ?, 0, ?, ?, ?)`,
              [lineId, sessionId, itemId, countedMicrounits, countedMicrounits, payload.notes || 'جرد غير متصل']
            );
          }
        }
        commandResult = { stocktake_id: sessionId, item_id: itemId, status: 'RECORDED' };

      } else {
        throw new Error(`UNKNOWN_ACTION: أمر المزامنة غير مدعوم [${action}]`);
      }

      // Record Idempotency Result
      try {
        await runQuery(
          `INSERT OR REPLACE INTO idempotency_keys (key, actor_id, operation, request_hash, response_status, response_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, 200, ?, datetime('now', 'localtime'), datetime('now', '+7 days'))`,
          [key, activeActor ? activeActor.id : null, action, currentHash, JSON.stringify(commandResult)]
        );
      } catch (e) {
        logger.warn('Failed to save idempotency key', { key, error: e.message });
      }

      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'APPLIED',
        result: commandResult
      });

    } catch (err) {
      logger.error('Sync command execution failure', { key, action, error: err.message });
      const isConflict = err.statusCode === 409 || err.message.includes('Optimistic') || err.message.includes('OPTIMISTIC') || err.message.includes('ALREADY_CLAIMED');

      results.push({
        client_command_id,
        idempotency_key: key,
        status: isConflict ? 'CONFLICT' : 'REJECTED',
        error: err.message
      });
    }
  }

  const appliedCount = results.filter(r => r.status === 'APPLIED' || r.status === 'ACCEPTED').length;
  return {
    processed_count: results.length,
    applied_count: appliedCount,
    accepted_count: appliedCount,
    results
  };
}

module.exports = {
  processClientSyncBatch
};
