/**
 * Security Anomaly Detection & Alert Lifecycle Service
 * Analyzes audit events in real-time, generates deduplicated Arabic security alerts,
 * and integrates with notification dispatchers.
 */
const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

/**
 * Evaluates an audit event against security anomaly detection rules
 */
async function evaluateSecurityAnomaly(event) {
  const {
    event_type,
    actor_user_id,
    device_id,
    venue_id = 'V_DEFAULT',
    outcome,
    reason,
    id: audit_event_id
  } = event;

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // 1. Repeated Failed PINs / Login Failures (Threshold: >= 3 within 5 minutes)
  if ((event_type === 'PIN_ATTEMPT' || event_type === 'LOGIN_FAILED' || event_type === 'RATE_LIMIT_LOCKED') && outcome === 'FAILURE') {
    let filterClause = '';
    const params = [venue_id];

    if (actor_user_id && device_id) {
      filterClause = ' AND (actor_user_id = ? OR device_id = ?)';
      params.push(actor_user_id, device_id);
    } else if (actor_user_id) {
      filterClause = ' AND actor_user_id = ?';
      params.push(actor_user_id);
    } else if (device_id) {
      filterClause = ' AND device_id = ?';
      params.push(device_id);
    }

    params.push(fiveMinutesAgo);

    const failedCount = await getQuery(
      `SELECT COUNT(*) as count FROM v3_audit_ledger 
       WHERE venue_id = ? AND (event_type = 'PIN_ATTEMPT' OR event_type = 'LOGIN_FAILED' OR event_type = 'RATE_LIMIT_LOCKED')
         AND outcome = 'FAILURE'
         ${filterClause}
         AND server_timestamp >= ?`,
      params
    );

    if (failedCount && failedCount.count >= 3) {
      await triggerSecurityAlert({
        venue_id,
        alert_type: 'FAILED_PIN_BURST',
        severity: 'HIGH',
        actor_user_id,
        device_id,
        audit_event_id,
        title_ar: 'تنبيه أمني: محاولات دخول متكررة فاشلة برمز PIN',
        description_ar: `تم رصد ${failedCount.count} محاولات دخول فاشلة متتالية خلال 5 دقائق للمستخدم أو الجهاز.`,
        recommended_action_ar: 'التحقق من هوية المشغل على الفور أو قفل الجلسة مؤقتاً ومراجعة كاميرات الصالة.',
        dedup_window_minutes: 10
      });
    }
  }

  // 2. Revoked Credential / Session / Device Usage Attempt
  if (event_type === 'SESSION_REVOKED' || event_type === 'DEVICE_REVOKED' || (reason && String(reason).includes('REVOKED'))) {
    await triggerSecurityAlert({
      venue_id,
      alert_type: 'REVOKED_ACCESS_ATTEMPT',
      severity: 'CRITICAL',
      actor_user_id,
      device_id,
      audit_event_id,
      title_ar: 'تنبيه حرج: محاولة استخدام جلسة أو جهاز ملغي الصلاحية',
      description_ar: 'تم رصد محاولة وصول باستخدام بيانات اعتماد أو جهاز تم إبطاله وإلغاء صلاحيته مسبقاً.',
      recommended_action_ar: 'حظر عنوان IP فوراً، إعادة تعيين رمز PIN، والتحقق من سلامة الأجهزة المعتمدة.',
      dedup_window_minutes: 5
    });
  }

  // 3. Rapid High-Privilege Role Change
  if (event_type === 'ROLE_CHANGED' || event_type === 'PERMISSION_CHANGED') {
    await triggerSecurityAlert({
      venue_id,
      alert_type: 'RAPID_ROLE_CHANGE',
      severity: 'HIGH',
      actor_user_id,
      device_id,
      audit_event_id,
      title_ar: 'تنبيه أمني: تعديل صلاحيات أو دور وظيفي للمستخدم',
      description_ar: 'تم رصد ترقية أو تغيير في الصلاحيات الإدارية أو المالية للمستخدم.',
      recommended_action_ar: 'مراجعة طلب الترقية من قبل المدير العام أو مالك المنشأة للتأكد من نظامية التعديل.',
      dedup_window_minutes: 1
    });
  }

  // 4. Abnormal Void or Refund Surge (Threshold: >= 5 voids/refunds in 15 mins)
  if (event_type.includes('VOID') || event_type.includes('REFUND')) {
    const surgeCount = await getQuery(
      `SELECT COUNT(*) as count FROM v3_audit_ledger 
       WHERE venue_id = ? AND (event_type LIKE '%VOID%' OR event_type LIKE '%REFUND%')
         AND actor_user_id = ?
         AND server_timestamp >= ?`,
      [venue_id, actor_user_id, fifteenMinutesAgo]
    );

    if (surgeCount && surgeCount.count >= 5) {
      await triggerSecurityAlert({
        venue_id,
        alert_type: 'ABNORMAL_VOID_SURGE',
        severity: 'HIGH',
        actor_user_id,
        device_id,
        audit_event_id,
        title_ar: 'تنبيه تدقيق: ارتفاع غير معتاد في عمليات الإلغاء أو الاسترجاع',
        description_ar: `تم تسجيل ${surgeCount.count} عمليات إلغاء/استرجاع بواسطة نفس المشغل خلال 15 دقيقة.`,
        recommended_action_ar: 'مراجعة فواتير الإلغاء مع مدير الصالة فوراً والتأكد من عدم وجود تلاعب في الفواتير المسددة.',
        dedup_window_minutes: 15
      });
    }
  }

  // 5. Unknown Payment Captures Burst (Threshold: >= 3 unknown payments in 30 mins)
  if (event_type === 'PAYMENT_UNKNOWN_RESOLVED' || event_type === 'UNKNOWN_PAYMENT_DETECTED') {
    const unknownCount = await getQuery(
      `SELECT COUNT(*) as count FROM v3_audit_ledger 
       WHERE venue_id = ? AND event_type LIKE '%UNKNOWN%PAYMENT%'
         AND server_timestamp >= ?`,
      [venue_id, thirtyMinutesAgo]
    );

    if (unknownCount && unknownCount.count >= 3) {
      await triggerSecurityAlert({
        venue_id,
        alert_type: 'UNKNOWN_PAYMENT_BURST',
        severity: 'HIGH',
        actor_user_id,
        device_id,
        audit_event_id,
        title_ar: 'تنبيه عمليات: تكرار مدفوعات معلقة وغير مؤكدة',
        description_ar: `تم رصد ${unknownCount.count} عمليات دفع بحالة غير مؤكدة تتطلب تسوية يدوية.`,
        recommended_action_ar: 'فحص اتصال بوابة الدفع وشبكة نقاط البيع ومطابقة إيصالات الشبكة الورقية مع النظام.',
        dedup_window_minutes: 20
      });
    }
  }

  // 6. Offline Queue Mismatch Anomaly
  if (outcome === 'CONFLICT' && event.reason === 'IDEMPOTENCY_MISMATCH') {
    await triggerSecurityAlert({
      venue_id,
      alert_type: 'OFFLINE_ANOMALY',
      severity: 'MEDIUM',
      actor_user_id,
      device_id,
      audit_event_id,
      title_ar: 'تنبيه تزامن: محاولة إعادة إرسال أمر أوفلاين بحمولة متغيرة',
      description_ar: 'تم رصد تعارض في مفتاح المزامنة مع بيانات مختلفة، مما يشير إلى محاولة تكرار أو تعديل في طابور الأوفلاين.',
      recommended_action_ar: 'فحص سجل طابور الأوفلاين للجهاز ومطابقة نسخة الكتالوج والطلب.',
      dedup_window_minutes: 5
    });
  }
}

/**
 * Triggers and records a deduplicated security alert
 */
async function triggerSecurityAlert(params) {
  const {
    venue_id = 'V_DEFAULT',
    alert_type,
    severity = 'MEDIUM',
    actor_user_id = null,
    device_id = null,
    ip_address = null,
    audit_event_id = null,
    title_ar,
    description_ar,
    recommended_action_ar = 'مراجعة سجلات النظام والتحقق من المشغل',
    dedup_window_minutes = 10,
    metadata = {}
  } = params;

  // Deduplication window key
  const timeWindowBucket = Math.floor(Date.now() / (dedup_window_minutes * 60 * 1000));
  const targetIdentifier = actor_user_id || device_id || 'SYSTEM';
  const dedupKey = `${alert_type}_${targetIdentifier}_${timeWindowBucket}`;

  // Check if active alert already exists with same dedup_key
  const existing = await getQuery(
    `SELECT id, status FROM v3_security_alerts WHERE dedup_key = ?`,
    [dedupKey]
  );

  if (existing) {
    // Already alerted in this window
    return existing;
  }

  const alertId = crypto.randomUUID();
  const now = new Date().toISOString();

  await runQuery(
    `INSERT INTO v3_security_alerts (
      id, venue_id, alert_type, severity, actor_user_id, device_id, ip_address,
      title_ar, description_ar, recommended_action_ar, status, audit_event_id,
      dedup_key, metadata_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 'TRIGGERED', ?,
      ?, ?, ?, ?
    )`,
    [
      alertId, venue_id, alert_type, severity, actor_user_id, device_id, ip_address,
      title_ar, description_ar, recommended_action_ar, audit_event_id,
      dedupKey, JSON.stringify(metadata), now, now
    ]
  );

  const alertRecord = {
    id: alertId,
    venue_id,
    alert_type,
    severity,
    actor_user_id,
    device_id,
    title_ar,
    description_ar,
    recommended_action_ar,
    status: 'TRIGGERED',
    created_at: now
  };

  logger.warn(`🚨 SECURITY ALERT TRIGGERED [${severity}]: ${title_ar}`, alertRecord);

  // Dispatch multi-channel notification asynchronously
  try {
    const { dispatchAlertNotification } = require('./notificationDispatcher');
    dispatchAlertNotification(alertRecord).catch(err => {
      logger.error('Failed to dispatch alert notifications:', err);
    });
  } catch (e) {}

  return alertRecord;
}

/**
 * Fetch security anomaly alerts
 */
async function getSecurityAlerts(filters = {}) {
  const venueId = filters.venue_id || 'V_DEFAULT';
  let sql = `SELECT a.*, u.name as actor_name, u.role_id as actor_role_id
             FROM v3_security_alerts a
             LEFT JOIN v3_users u ON a.actor_user_id = u.id
             WHERE a.venue_id = ?`;
  const params = [venueId];

  if (filters.status) {
    sql += ` AND a.status = ?`;
    params.push(filters.status);
  }
  if (filters.severity) {
    sql += ` AND a.severity = ?`;
    params.push(filters.severity);
  }
  if (filters.alert_type) {
    sql += ` AND a.alert_type = ?`;
    params.push(filters.alert_type);
  }

  sql += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(filters.limit) || 50, Number(filters.offset) || 0);

  const rows = await allQuery(sql, params);
  return (rows || []).map(r => ({
    ...r,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {}
  }));
}

/**
 * Acknowledge an alert with audit tracking
 */
async function acknowledgeAlert(alertId, actor, note = null) {
  const now = new Date().toISOString();
  await runQuery(
    `UPDATE v3_security_alerts 
     SET status = 'ACKNOWLEDGED', acknowledged_by = ?, acknowledged_at = ?, resolution_note = COALESCE(?, resolution_note), updated_at = ?
     WHERE id = ?`,
    [actor ? actor.id : 'SYSTEM', now, note, now, alertId]
  );

  const { recordAuditEvent } = require('./auditLedgerService');
  await recordAuditEvent({
    event_type: 'SECURITY_ALERT_ACKNOWLEDGED',
    actor_user_id: actor ? actor.id : null,
    actor_name: actor ? actor.name : null,
    actor_role: actor ? actor.role : null,
    target_entity_type: 'SECURITY_ALERT',
    target_entity_id: alertId,
    details: { note }
  });

  return { success: true, alertId, status: 'ACKNOWLEDGED' };
}

/**
 * Resolve an alert with audit tracking
 */
async function resolveAlert(alertId, actor, note = null) {
  const now = new Date().toISOString();
  await runQuery(
    `UPDATE v3_security_alerts 
     SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, resolution_note = ?, updated_at = ?
     WHERE id = ?`,
    [actor ? actor.id : 'SYSTEM', now, note, now, alertId]
  );

  const { recordAuditEvent } = require('./auditLedgerService');
  await recordAuditEvent({
    event_type: 'SECURITY_ALERT_RESOLVED',
    actor_user_id: actor ? actor.id : null,
    actor_name: actor ? actor.name : null,
    actor_role: actor ? actor.role : null,
    target_entity_type: 'SECURITY_ALERT',
    target_entity_id: alertId,
    details: { note }
  });

  return { success: true, alertId, status: 'RESOLVED' };
}

module.exports = {
  evaluateSecurityAnomaly,
  triggerSecurityAlert,
  getSecurityAlerts,
  acknowledgeAlert,
  resolveAlert
};
