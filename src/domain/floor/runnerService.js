const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function getNextSequence(tx, venueId) {
  const row = await (tx ? tx.get(`SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?`, [venueId])
                        : getQuery(`SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?`, [venueId]));
  return row ? row.seq : 1;
}

/**
 * Creates a new runner task (e.g. DELIVERY, TABLE_ASSISTANCE, WAITER_CALL)
 */
async function createTask(venueId, taskType, priority = 0, contextJson = '{}', externalTx = null) {
  const execute = async (tx) => {
    const taskId = `TSK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const nowIso = new Date().toISOString();

    await tx.run(
      `INSERT INTO runner_tasks (id, venue_id, task_type, priority, context_json, status, version, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, 'PENDING', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [taskId, venueId, taskType, priority, typeof contextJson === 'string' ? contextJson : JSON.stringify(contextJson)]
    );

    const nextSeq = await getNextSequence(tx, venueId);
    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      task_id: taskId,
      task_type: taskType,
      priority,
      status: 'PENDING',
      context: typeof contextJson === 'string' ? JSON.parse(contextJson) : contextJson,
      version: 1,
      created_at: nowIso
    };

    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status) 
       VALUES (?, 'RUNNER_TASK_CREATED', 'RUNNER_TASK', ?, ?, ?, 1, 'v1', ?, 'HALL', 'PENDING')`,
      [eventId, taskId, JSON.stringify(payload), nextSeq, venueId]
    );

    return taskId;
  };

  if (externalTx) {
    return execute(externalTx);
  }
  return runTransaction(execute);
}

/**
 * Claims a task for a specific runner/waiter with optimistic concurrency check
 */
async function claimTask(taskId, runnerId, expectedVersion = 1) {
  return runTransaction(async (tx) => {
    const task = await tx.get(`SELECT * FROM runner_tasks WHERE id = ?`, [taskId]);
    if (!task) {
      const err = new Error(`NOT_FOUND: مهمة التوصيل غير موجودة [${taskId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (task.status !== 'PENDING') {
      const err = new Error(`ALREADY_CLAIMED: المهمة محجوزة مسبقاً بواسطة موظف آخر أو مكتملة (الحالة الحالية: ${task.status})`);
      err.statusCode = 409;
      throw err;
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (task.version !== expectedVersion) {
        const err = new Error(`OPTIMISTIC_LOCK_FAILURE: تعارض إصدار المهمة (المتوقع: ${expectedVersion}، الحالي: ${task.version})`);
        err.statusCode = 409;
        throw err;
      }
    }

    const newVersion = task.version + 1;
    const nowIso = new Date().toISOString();

    await tx.run(
      `UPDATE runner_tasks 
       SET status = 'CLAIMED', owner_id = ?, version = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [runnerId, newVersion, taskId]
    );

    const nextSeq = await getNextSequence(tx, task.venue_id);
    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      task_id: taskId,
      runner_id: runnerId,
      status: 'CLAIMED',
      version: newVersion,
      claimed_at: nowIso
    };

    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status) 
       VALUES (?, 'RUNNER_TASK_CLAIMED', 'RUNNER_TASK', ?, ?, ?, ?, 'v1', ?, 'HALL', 'PENDING')`,
      [eventId, taskId, JSON.stringify(payload), nextSeq, newVersion, task.venue_id]
    );

    return {
      status: 'SUCCESS',
      task_id: taskId,
      runner_id: runnerId,
      task_status: 'CLAIMED',
      version: newVersion
    };
  });
}

/**
 * Completes a delivery or assistance task
 */
async function completeTask(taskId, runnerId, expectedVersion = null) {
  return runTransaction(async (tx) => {
    const task = await tx.get(`SELECT * FROM runner_tasks WHERE id = ?`, [taskId]);
    if (!task) {
      const err = new Error(`NOT_FOUND: مهمة التوصيل غير موجودة [${taskId}]`);
      err.statusCode = 404;
      throw err;
    }

    if (task.status === 'COMPLETED') {
      return {
        status: 'SUCCESS',
        task_id: taskId,
        task_status: 'COMPLETED',
        version: task.version
      };
    }

    if (task.owner_id && String(task.owner_id) !== String(runnerId) && task.status === 'CLAIMED') {
      const err = new Error(`FORBIDDEN: لا يمكن إتمام مهمة محجوزة لموظف آخر (${task.owner_id})`);
      err.statusCode = 403;
      throw err;
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (task.version !== expectedVersion) {
        const err = new Error(`OPTIMISTIC_LOCK_FAILURE: تعارض في إصدار المهمة (المتوقع: ${expectedVersion}، الحالي: ${task.version})`);
        err.statusCode = 409;
        throw err;
      }
    }

    const newVersion = task.version + 1;
    const nowIso = new Date().toISOString();

    await tx.run(
      `UPDATE runner_tasks 
       SET status = 'COMPLETED', owner_id = COALESCE(owner_id, ?), version = ?, updated_at = datetime('now', 'localtime') 
       WHERE id = ?`,
      [runnerId, newVersion, taskId]
    );

    const nextSeq = await getNextSequence(tx, task.venue_id);
    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      task_id: taskId,
      runner_id: runnerId,
      status: 'COMPLETED',
      version: newVersion,
      completed_at: nowIso
    };

    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status) 
       VALUES (?, 'RUNNER_TASK_COMPLETED', 'RUNNER_TASK', ?, ?, ?, ?, 'v1', ?, 'HALL', 'PENDING')`,
      [eventId, taskId, JSON.stringify(payload), nextSeq, newVersion, task.venue_id]
    );

    return {
      status: 'SUCCESS',
      task_id: taskId,
      runner_id: runnerId,
      task_status: 'COMPLETED',
      version: newVersion
    };
  });
}

/**
 * Retrieves active runner tasks with table context and timers
 */
async function getRunnerTasks(venueId, statusFilter = null) {
  let query = `
    SELECT t.*, u.name as owner_name,
           CAST((strftime('%s', 'now', 'localtime') - strftime('%s', t.created_at)) AS INTEGER) as elapsed_seconds
    FROM runner_tasks t
    LEFT JOIN v3_users u ON t.owner_id = u.id
    WHERE t.venue_id = ?`;
  const params = [venueId];

  if (statusFilter) {
    query += ` AND t.status = ?`;
    params.push(statusFilter);
  } else {
    query += ` AND t.status != 'COMPLETED' AND t.status != 'CANCELLED'`;
  }

  query += ` ORDER BY t.priority DESC, t.created_at ASC`;

  const tasks = await allQuery(query, params);
  return tasks.map(t => {
    let context = {};
    try { context = JSON.parse(t.context_json || '{}'); } catch (e) {}
    return {
      ...t,
      context
    };
  });
}

module.exports = {
  createTask,
  claimTask,
  completeTask,
  getRunnerTasks
};
