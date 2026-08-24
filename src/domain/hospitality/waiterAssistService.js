/**
 * Waiter Assistance & Non-Intrusive Hospitality Recommendations Service
 * Detects idle tables (30-45 mins without orders) and creates deduplicated service tasks.
 */
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

/**
 * Scan tables and create assistance recommendations for idle guests
 */
async function scanIdleTablesAndGenerateTasks({ idleThresholdMinutes = 30, venueId = 'V_DEFAULT' } = {}) {
  const threshold = parseInt(idleThresholdMinutes, 10) || 30;

  // Query occupied/open tables with computed idle minutes and v3_table linkage
  const sql = `
    SELECT t.id, t.table_number, t.custom_name, t.customer_name, t.status,
           t.seated_at, t.last_ordered_at,
           COALESCE(vt.id, 'T-' || t.table_number) as v3_table_id,
           ROUND((julianday('now', 'localtime') - julianday(COALESCE(t.last_ordered_at, t.seated_at, datetime('now', 'localtime')))) * 1440) as idle_minutes
    FROM tables t
    LEFT JOIN v3_tables vt ON t.table_number = vt.table_number
    WHERE t.status IN ('OCCUPIED', 'ORDER_OPEN', 'SEATED', 'OPENED', 'ORDERED')
  `;

  const tables = await allQuery(sql);
  const createdTasks = [];

  for (const table of tables) {
    const idle = Math.round(table.idle_minutes || 0);
    if (idle < threshold) continue;

    const tableIdRef = `T-${table.table_number}`;

    // Ensure v3_table row exists for foreign key constraint
    await runQuery(
      `INSERT OR IGNORE INTO v3_tables (id, branch_id, table_number, custom_name, zone, capacity, status, version, updated_at)
       VALUES (?, COALESCE((SELECT id FROM branches LIMIT 1), 'BR_DEFAULT'), ?, ?, 'INDOOR_1', 4, 'OCCUPIED', 1, datetime('now', 'localtime'))`,
      [tableIdRef, table.table_number, table.custom_name || `طاولة ${table.table_number}`]
    );

    // Check if there is already an active service request for this table
    const existing = await getQuery(
      `SELECT id, status FROM service_requests 
       WHERE table_id = ? AND type = 'CUSTOMER_ASSISTANCE' AND status IN ('PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS')`,
      [tableIdRef]
    );

    if (existing) {
      // Already has an active assist task, do not duplicate
      continue;
    }

    const priority = idle >= 45 ? 2 : 1;
    const priorityLevel = idle >= 45 ? 'HIGH' : 'NORMAL';
    const taskId = `SR-IDLE-${table.table_number}-${Date.now()}`;
    const idempKey = `IDLE_ASSIST_T${table.table_number}_${table.seated_at || Date.now()}_${Math.floor(idle / 15)}`;

    const contextNotes = table.customer_name
      ? `طاولة #${table.table_number} (${table.custom_name || 'عامة'} - العميل: ${table.customer_name}) لم تسجل طلبات جديدة منذ ${idle} دقيقة. يُرجى الاطمئنان على مستوى الرضا وتقديم الخدمة المطلوبة.`
      : `طاولة #${table.table_number} (${table.custom_name || 'عامة'}) لم تسجل طلبات جديدة منذ ${idle} دقيقة. يُرجى الاطمئنان على مستوى الرضا وتقديم الخدمة المطلوبة.`;

    const auditTrail = JSON.stringify([
      { action: 'AUTO_GENERATED', timestamp: new Date().toISOString(), idle_minutes: idle, threshold }
    ]);

    await runQuery(
      `INSERT OR IGNORE INTO service_requests (
        id, venue_id, table_id, type, priority, priority_level, status,
        sla_minutes, elapsed_minutes, context_notes, idempotency_key, audit_trail_json, created_at
      ) VALUES (?, COALESCE((SELECT id FROM venues LIMIT 1), 'V_DEFAULT'), ?, 'CUSTOMER_ASSISTANCE', ?, ?, 'PENDING', 5, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [taskId, tableIdRef, priority, priorityLevel, idle, contextNotes, idempKey, auditTrail]
    );

    logger.info(`Generated waiter assistance task for idle table ${table.table_number} (idle: ${idle}m)`);
    createdTasks.push({
      task_id: taskId,
      table_number: table.table_number,
      idle_minutes: idle,
      priority: priorityLevel
    });
  }

  return {
    scanned_count: tables.length,
    generated_count: createdTasks.length,
    tasks: createdTasks
  };
}

/**
 * Get active waiter assistance and service requests
 */
async function getActiveAssistanceTasks(venueId = 'V_DEFAULT') {
  const sql = `
    SELECT sr.id, sr.venue_id, sr.table_id, sr.order_session_id, sr.type,
           sr.priority, sr.priority_level, sr.status, sr.sla_minutes, sr.elapsed_minutes,
           sr.assigned_waiter_id, sr.context_notes, sr.created_at, sr.acknowledged_at,
           COALESCE(vt.table_number, t.table_number) as table_number,
           COALESCE(t.custom_name, vt.custom_name, vt.display_name) as table_custom_name,
           COALESCE(t.zone, vt.zone) as table_zone,
           t.customer_name,
           u.name as assigned_waiter_name
    FROM service_requests sr
    LEFT JOIN v3_tables vt ON sr.table_id = vt.id
    LEFT JOIN tables t ON sr.table_id = CAST(t.id AS TEXT) OR sr.table_id = ('T-' || t.table_number) OR (vt.table_number IS NOT NULL AND vt.table_number = t.table_number)
    LEFT JOIN v3_users u ON sr.assigned_waiter_id = u.id
    WHERE sr.status IN ('PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS')
    ORDER BY sr.priority DESC, sr.created_at ASC
  `;
  const tasks = await allQuery(sql);
  return tasks.map(t => ({
    ...t,
    table_display: t.table_custom_name ? `#${t.table_number} (${t.table_custom_name})` : `طاولة #${t.table_number}`
  }));
}

/**
 * Acknowledge an assistance task by a staff member
 */
async function acknowledgeTask(taskId, waiterId = null) {
  return runTransaction(async (tx) => {
    const task = await tx.get(`SELECT * FROM service_requests WHERE id = ?`, [taskId]);
    if (!task) throw new Error('مهمة المساعدة المطلوبة غير موجودة');

    if (task.status !== 'PENDING') {
      return { success: true, task_id: taskId, status: task.status, message: 'المهمة قيد المتابعة بالفعل' };
    }

    let audit = [];
    try {
      audit = JSON.parse(task.audit_trail_json || '[]');
    } catch (e) {}
    audit.push({ action: 'ACKNOWLEDGED', waiter_id: waiterId, timestamp: new Date().toISOString() });

    await tx.run(
      `UPDATE service_requests 
       SET status = 'ACKNOWLEDGED', 
           assigned_waiter_id = ?, 
           acknowledged_at = datetime('now', 'localtime'),
           audit_trail_json = ?
       WHERE id = ?`,
      [waiterId, JSON.stringify(audit), taskId]
    );

    return {
      success: true,
      task_id: taskId,
      status: 'ACKNOWLEDGED',
      assigned_waiter_id: waiterId
    };
  });
}

/**
 * Complete an assistance task
 */
async function completeTask(taskId, waiterId = null, resolutionNotes = null) {
  return runTransaction(async (tx) => {
    const task = await tx.get(`SELECT * FROM service_requests WHERE id = ?`, [taskId]);
    if (!task) throw new Error('مهمة المساعدة المطلوبة غير موجودة');

    let audit = [];
    try {
      audit = JSON.parse(task.audit_trail_json || '[]');
    } catch (e) {}
    audit.push({ action: 'COMPLETED', waiter_id: waiterId, notes: resolutionNotes, timestamp: new Date().toISOString() });

    await tx.run(
      `UPDATE service_requests 
       SET status = 'COMPLETED', 
           completed_at = datetime('now', 'localtime'),
           context_notes = COALESCE(?, context_notes),
           audit_trail_json = ?
       WHERE id = ?`,
      [resolutionNotes ? `${task.context_notes || ''} [ملاحظات الإنجاز: ${resolutionNotes}]` : task.context_notes, JSON.stringify(audit), taskId]
    );

    return {
      success: true,
      task_id: taskId,
      status: 'COMPLETED'
    };
  });
}

/**
 * Cancel an assistance task
 */
async function cancelTask(taskId, reason = 'DISMISSED') {
  return runTransaction(async (tx) => {
    const task = await tx.get(`SELECT * FROM service_requests WHERE id = ?`, [taskId]);
    if (!task) throw new Error('مهمة المساعدة المطلوبة غير موجودة');

    let audit = [];
    try {
      audit = JSON.parse(task.audit_trail_json || '[]');
    } catch (e) {}
    audit.push({ action: 'CANCELLED', reason, timestamp: new Date().toISOString() });

    await tx.run(
      `UPDATE service_requests 
       SET status = 'CANCELLED', 
           cancelled_at = datetime('now', 'localtime'),
           audit_trail_json = ?
       WHERE id = ?`,
      [JSON.stringify(audit), taskId]
    );

    return { success: true, task_id: taskId, status: 'CANCELLED' };
  });
}

module.exports = {
  scanIdleTablesAndGenerateTasks,
  getActiveAssistanceTasks,
  acknowledgeTask,
  completeTask,
  cancelTask
};
