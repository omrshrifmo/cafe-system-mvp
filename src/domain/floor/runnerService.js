const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function getNextSequence(tx, venueId) {
  const row = await getQuery(tx ? `SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?` : `SELECT 1`, [venueId], tx);
  return row ? row.seq : 1;
}

async function createTask(venueId, taskType, priority, contextJson) {
  return runTransaction(async (tx) => {
    const taskId = `TSK-${Date.now()}`;
    await tx.run(
      `INSERT INTO runner_tasks (id, venue_id, task_type, priority, context_json) VALUES (?, ?, ?, ?, ?)`,
      [taskId, venueId, taskType, priority, contextJson]
    );

    const nextSeq = await getNextSequence(tx, venueId);
    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, venue_id, station_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`EVT-${Date.now()}-${Math.random()}`, 'runner_task_created', 'runner_task', taskId, JSON.stringify({ taskId, taskType }), nextSeq, 1, venueId, 'HALL']
    );
    return taskId;
  });
}

async function claimTask(taskId, runnerId, expectedVersion) {
  return runTransaction(async (tx) => {
    const task = await getQuery(`SELECT * FROM runner_tasks WHERE id = ?`, [taskId]);
    if (!task) throw new Error('Task not found');
    
    if (task.status !== 'PENDING') {
      throw new Error(`Task already claimed or completed (Current status: ${task.status})`);
    }

    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Expected ${expectedVersion}, got ${task.version}`);
    }

    await tx.run(
      `UPDATE runner_tasks SET status = 'CLAIMED', owner_id = ?, version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [runnerId, taskId]
    );

    const nextSeq = await getNextSequence(tx, task.venue_id);
    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, venue_id, station_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`EVT-${Date.now()}-${Math.random()}`, 'runner_task_claimed', 'runner_task', taskId, JSON.stringify({ taskId, runnerId }), nextSeq, task.version + 1, task.venue_id, 'HALL']
    );

    return { status: 'SUCCESS', version: task.version + 1 };
  });
}

async function completeTask(taskId, runnerId, expectedVersion) {
  return runTransaction(async (tx) => {
    const task = await getQuery(`SELECT * FROM runner_tasks WHERE id = ?`, [taskId]);
    if (!task) throw new Error('Task not found');

    if (task.owner_id !== runnerId && task.status === 'CLAIMED') {
      throw new Error('Task owned by another runner');
    }

    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Expected ${expectedVersion}, got ${task.version}`);
    }

    await tx.run(
      `UPDATE runner_tasks SET status = 'COMPLETED', version = version + 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [taskId]
    );

    const nextSeq = await getNextSequence(tx, task.venue_id);
    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, venue_id, station_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`EVT-${Date.now()}-${Math.random()}`, 'runner_task_completed', 'runner_task', taskId, JSON.stringify({ taskId, runnerId }), nextSeq, task.version + 1, task.venue_id, 'HALL']
    );

    return { status: 'SUCCESS', version: task.version + 1 };
  });
}

module.exports = { createTask, claimTask, completeTask };
