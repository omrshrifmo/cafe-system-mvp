/**
 * Super-Admin Emergency Access (Break-Glass) Service
 * Provides step-up authenticated, time-limited, ticket-bound, auditable emergency access
 * with automatic owner alerting and failure isolation.
 */
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const { recordAuditEvent } = require('../audit/auditLedgerService');
const { verifyReauthentication } = require('../auth/service');
const { dispatchAlertNotification } = require('../audit/notificationDispatcher');
const logger = require('../../observability/logger');

const ALLOWED_EMERGENCY_SCOPES = ['SYSTEM_RECOVERY', 'READ_ONLY_AUDIT', 'EMERGENCY_OVERRIDE'];
const MAX_EMERGENCY_MINUTES = 120; // 2 hours hard cap
const MIN_EMERGENCY_MINUTES = 5;

/**
 * Request emergency break-glass access
 */
async function requestEmergencyAccess(actorUser, payload = {}, ip = null) {
  if (!actorUser || actorUser.role !== 'SUPER_ADMIN') {
    throw new Error('FORBIDDEN: الوصول في حالات الطوارئ (Break-Glass) متاح فقط لحسابات Super Admin.');
  }

  const { ticket_ref, reason, scope = 'SYSTEM_RECOVERY', duration_minutes = 60, pin } = payload;

  if (!ticket_ref || typeof ticket_ref !== 'string' || ticket_ref.trim().length < 3) {
    throw new Error('VALIDATION_ERROR: يلزم تحديد رقم التذكرة أو مرجع الطوارئ (Ticket / Incident Reference).');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    throw new Error('VALIDATION_ERROR: يلزم كتابة سبب تفصيلي لطلب الوصول الطارئ (10 أحرف على الأقل).');
  }

  if (!ALLOWED_EMERGENCY_SCOPES.includes(scope)) {
    throw new Error(`VALIDATION_ERROR: نطاق الطوارئ غير صالح. النطاقات المسموحة: ${ALLOWED_EMERGENCY_SCOPES.join(', ')}`);
  }

  if (!pin) {
    throw new Error('PIN_REQUIRED: يلزم إدخال الرمز السري للتحقق من هوية مسؤول النظام.');
  }

  const isPinValid = await verifyReauthentication(actorUser.id, pin);
  if (!isPinValid) {
    throw new Error('INVALID_PIN: الرمز السري لمسؤول النظام غير صحيح.');
  }

  const duration = Math.min(MAX_EMERGENCY_MINUTES, Math.max(MIN_EMERGENCY_MINUTES, parseInt(duration_minutes, 10) || 60));
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + duration * 60 * 1000).toISOString();
  const emergencyId = `EMG_${now}_${Math.random().toString(36).substring(2, 6)}`;
  const venueId = actorUser.venueId || 'V_DEFAULT';

  // Insert emergency session record
  await runQuery(
    `INSERT INTO v3_emergency_access_sessions (
      id, venue_id, user_id, ticket_ref, reason, scope, started_at, expires_at, ip_address, session_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [emergencyId, venueId, actorUser.id, ticket_ref.trim(), reason.trim(), scope, startedAt, expiresAt, ip, actorUser.sessionId || null]
  );

  // If user has an active session ID, mark it as emergency session
  if (actorUser.sessionId) {
    await runQuery(
      `UPDATE v3_user_sessions SET is_emergency = 1, emergency_session_id = ? WHERE id = ?`,
      [emergencyId, actorUser.sessionId]
    );
  }

  // Record append-only audit event
  await recordAuditEvent({
    venue_id: venueId,
    actor_user_id: actorUser.id,
    event_type: 'EMERGENCY_ACCESS_GRANTED',
    entity_type: 'EMERGENCY_SESSION',
    entity_id: emergencyId,
    details: {
      ticket_ref: ticket_ref.trim(),
      reason: reason.trim(),
      scope,
      duration_minutes: duration,
      expires_at: expiresAt,
      ip_address: ip
    },
    outcome: 'SUCCESS'
  });

  // Create High-Priority Security Alert & In-App Notification to Owners
  try {
    const alertId = `ALT_EMG_${now}`;
    await runQuery(
      `INSERT INTO v3_security_alerts (
        id, venue_id, severity, alert_type, actor_user_id, title_ar, description_ar, 
        recommended_action_ar, dedup_key, created_at
       ) VALUES (?, ?, 'CRITICAL', 'EMERGENCY_ACCESS_ACTIVATED', ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [
        alertId,
        venueId,
        actorUser.id,
        'تنبيه أمني فائق: تفعيل وصول طوارئ (Break-Glass)',
        `قام مسؤول النظام (${actorUser.name || actorUser.id}) بتفعيل وضع الطوارئ بالمرجع [${ticket_ref.trim()}]. السبب: ${reason.trim()}`,
        'مراجعة سجلات النشاط والأحداث والتأكد من انتهاء وضع الطوارئ فور إنجاز الصيانة.',
        `EMG_ACT_${emergencyId}`
      ]
    );

    // Queue notification to venue owners/managers
    await dispatchAlertNotification({
      id: alertId,
      venue_id: venueId,
      title_ar: '🚨 تنبيه: تفعيل وصول طوارئ من قبل Super Admin',
      description_ar: `تم تفعيل وصول طوارئ للمستخدم [${actorUser.id}] بالمرجع [${ticket_ref.trim()}]. السبب: ${reason.trim()}`,
      severity: 'CRITICAL'
    });
  } catch (err) {
    logger.warn('Failed to emit emergency notification to owners', { error: err.message });
  }

  logger.warn('SUPER ADMIN EMERGENCY ACCESS GRANTED', {
    emergencyId,
    userId: actorUser.id,
    ticket_ref,
    scope,
    duration,
    expiresAt
  });

  return {
    success: true,
    emergencyId,
    ticketRef: ticket_ref.trim(),
    scope,
    durationMinutes: duration,
    startedAt,
    expiresAt,
    message: 'تم تفعيل وضع الوصول الطارئ بنجاح وتم إخطار المالك وتسجيل العملية في سجل الرقابة المشفر.'
  };
}

/**
 * Get active emergency access sessions
 */
async function getActiveEmergencySessions(venueId = 'V_DEFAULT') {
  const rows = await allQuery(
    `SELECT 
      e.*,
      u.name as user_name,
      u.role_id
     FROM v3_emergency_access_sessions e
     JOIN v3_users u ON e.user_id = u.id
     WHERE (e.venue_id = ? OR e.venue_id IS NULL)
       AND e.terminated_at IS NULL
     ORDER BY e.started_at DESC`,
    [venueId]
  );

  const now = Date.now();
  return rows
    .map(r => {
      const expireTime = new Date(r.expires_at).getTime();
      const remainingSeconds = Math.max(0, Math.floor((expireTime - now) / 1000));
      return {
        id: r.id,
        venueId: r.venue_id,
        userId: r.user_id,
        userName: r.user_name,
        role: r.role_id,
        ticketRef: r.ticket_ref,
        reason: r.reason,
        scope: r.scope,
        startedAt: r.started_at,
        expiresAt: r.expires_at,
        remainingSeconds,
        ipAddress: r.ip_address,
        isActive: remainingSeconds > 0
      };
    })
    .filter(r => r.isActive);
}

/**
 * Terminate emergency access early
 */
async function terminateEmergencyAccess(emergencyId, actorUser, reason = 'TERMINATED_BY_USER') {
  if (!actorUser || !['SUPER_ADMIN', 'OWNER'].includes(actorUser.role)) {
    throw new Error('FORBIDDEN: يلزم صلاحية Super Admin أو المالك لإنهاء جلسة الطوارئ.');
  }

  const emg = await getQuery(`SELECT * FROM v3_emergency_access_sessions WHERE id = ?`, [emergencyId]);
  if (!emg) {
    throw new Error('EMERGENCY_SESSION_NOT_FOUND: جلسة الطوارئ المحددة غير موجودة.');
  }

  await runQuery(
    `UPDATE v3_emergency_access_sessions SET 
      terminated_at = datetime('now', 'localtime'),
      terminated_by = ?
     WHERE id = ?`,
    [actorUser.id, emergencyId]
  );

  // Clear emergency flag from linked sessions
  await runQuery(
    `UPDATE v3_user_sessions SET is_emergency = 0 WHERE emergency_session_id = ?`,
    [emergencyId]
  );

  await recordAuditEvent({
    venue_id: emg.venue_id,
    actor_user_id: actorUser.id,
    event_type: 'EMERGENCY_ACCESS_TERMINATED',
    entity_type: 'EMERGENCY_SESSION',
    entity_id: emergencyId,
    details: { reason, terminated_by: actorUser.id, ticket_ref: emg.ticket_ref },
    outcome: 'SUCCESS'
  });

  logger.info('Emergency access session terminated', { emergencyId, terminatedBy: actorUser.id, reason });
  return { success: true, emergencyId, message: 'تم إنهاء وضع الوصول الطارئ بنجاح.' };
}

/**
 * Validate if an emergency session is active
 */
async function isEmergencyAccessActive(userId, venueId = 'V_DEFAULT') {
  const row = await getQuery(
    `SELECT id FROM v3_emergency_access_sessions 
     WHERE user_id = ? AND (venue_id = ? OR venue_id IS NULL)
       AND terminated_at IS NULL
       AND expires_at > datetime('now', 'localtime')
     LIMIT 1`,
    [userId, venueId]
  );
  return !!row;
}

module.exports = {
  requestEmergencyAccess,
  getActiveEmergencySessions,
  terminateEmergencyAccess,
  isEmergencyAccessActive,
  MAX_EMERGENCY_MINUTES,
  MIN_EMERGENCY_MINUTES,
  ALLOWED_EMERGENCY_SCOPES
};
