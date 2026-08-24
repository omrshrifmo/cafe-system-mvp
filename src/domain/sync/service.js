/**
 * Offline Batch Command Synchronization Domain Service
 */
const crypto = require('crypto');
const { getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

async function processClientSyncBatch(commands = [], actor = null, venueId = 'V_DEFAULT') {
  if (!Array.isArray(commands)) {
    throw new Error('VALIDATION_ERROR: يجب تقديم مصفوفة من أوامر المزامنة (commands array required)');
  }

  const results = [];

  for (const cmd of commands) {
    const { client_command_id, idempotency_key, action, payload = {}, expected_version } = cmd;
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

    // 2. Unsafe Offline Financial Settlement Policy Check
    if (['SETTLE_PAYMENT', 'VOID_PAID', 'EOD_CLOSE', 'SETTLE_BILL', 'PAYMENT_SETTLE'].includes(action)) {
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'REJECTED',
        error: `UNSAFE_OFFLINE_ACTION: إجراء التسوية المالية [${action}] غير مسموح في المزامنة غير المتصلة - يلزم اتصال مباشر بالخادم لإتمام الدفع`
      });
      continue;
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

          await tx.run(
            `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, created_at, updated_at)
             VALUES (?, (SELECT id FROM branches LIMIT 1), ?, ?, ?, 'OPEN', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
            [sessId, tableId, actor ? actor.id : '108', orderType]
          );

          const lines = payload.lines || payload.items || [];
          const lineRecords = [];
          for (const item of lines) {
            const lineId = `LN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const priceMinor = item.unit_price_minor || (item.price ? Math.round(item.price * 100) : 5000);
            const qty = item.quantity || 1;
            await tx.run(
              `INSERT INTO v3_order_lines (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'PENDING', datetime('now', 'localtime'))`,
              [lineId, sessId, item.menu_item_id || item.item_id || 'MI_DEFAULT', qty, priceMinor, priceMinor * qty]
            );
            lineRecords.push({ id: lineId, menu_item_id: item.menu_item_id || item.item_id || 'MI_DEFAULT', quantity: qty, name: item.name });
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

      } else {
        throw new Error(`UNKNOWN_ACTION: أمر المزامنة غير مدعوم [${action}]`);
      }

      // Record Idempotency Result
      const numericActor = actor && actor.id && !isNaN(parseInt(actor.id, 10)) ? parseInt(actor.id, 10) : null;
      try {
        await runQuery(
          `INSERT INTO idempotency_keys (key, actor_id, operation, request_hash, response_status, response_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, 200, ?, datetime('now', 'localtime'), datetime('now', '+7 days'))`,
          [key, numericActor, action, currentHash, JSON.stringify(commandResult)]
        );
      } catch (e) {
        try {
          await runQuery(
            `INSERT INTO idempotency_keys (key, request_params, response_json, created_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'))`,
            [key, currentHash, JSON.stringify(commandResult)]
          );
        } catch (e2) {}
      }

      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'ACCEPTED',
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

  return {
    processed_count: results.length,
    accepted_count: results.filter(r => r.status === 'ACCEPTED').length,
    results
  };
}

module.exports = {
  processClientSyncBatch
};
