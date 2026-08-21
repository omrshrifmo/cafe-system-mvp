/**
 * Offline Batch Command Synchronization Domain Service
 */
const crypto = require('crypto');
const { getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { submitOrderWithBOM, updateKdsStatus } = require('../orders/service');
const { settleSession } = require('../payments/service');
const logger = require('../../observability/logger');

async function processClientSyncBatch(commands = [], actor = null) {
  const results = [];

  for (const cmd of commands) {
    const { client_command_id, idempotency_key, action, payload } = cmd;
    const key = idempotency_key || client_command_id;

    if (!key) {
      results.push({
        client_command_id,
        status: 'REJECTED',
        error: 'VALIDATION_ERROR: مفتاح التكرار (idempotency_key) مطلوب لكل أمر مزامنة'
      });
      continue;
    }

    // Check if already processed
    const existing = await getQuery(`SELECT * FROM idempotency_keys WHERE key = ?`, [key]);
    if (existing) {
      let savedResponse = null;
      try { savedResponse = JSON.parse(existing.response_json); } catch (e) {}
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'DUPLICATE',
        result: savedResponse
      });
      continue;
    }

    // Process command by action type
    try {
      let commandResult = null;
      if (action === 'SUBMIT_ORDER') {
        commandResult = await submitOrderWithBOM(payload, actor ? actor.id : null);
      } else if (action === 'SETTLE_BILL') {
        commandResult = await settleSession(payload, actor);
      } else if (action === 'UPDATE_KDS_STATUS') {
        commandResult = await updateKdsStatus(payload.order_id, payload.status, actor);
      } else {
        throw new Error(`UNKNOWN_ACTION: أمر المزامنة غير مدعوم [${action}]`);
      }

      // Record idempotency record
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      await runQuery(
        `INSERT INTO idempotency_keys (key, actor_id, operation, request_hash, response_status, response_json, expires_at)
         VALUES (?, ?, ?, ?, 200, ?, ?)`,
        [key, actor ? actor.id : null, action, crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex'), JSON.stringify(commandResult), expiresAt]
      );

      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'APPLIED',
        result: commandResult
      });
    } catch (err) {
      logger.error('Error applying sync command', { key, action, error: err.message });
      results.push({
        client_command_id,
        idempotency_key: key,
        status: 'REJECTED',
        error: err.message
      });
    }
  }

  return {
    processed_count: results.length,
    results
  };
}

module.exports = {
  processClientSyncBatch
};
