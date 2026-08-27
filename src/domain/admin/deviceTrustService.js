/**
 * Device Trust, Station Assignment & Kiosk Management Service
 * Enforces explicit, scoped, expiring hardware trust and restricted kiosk operation.
 */
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const { recordAuditEvent } = require('../audit/auditLedgerService');
const { verifyReauthentication } = require('../auth/service');
const logger = require('../../observability/logger');

const ALLOWED_DEVICE_CLASSES = ['POS', 'KDS', 'KIOSK', 'WAITER_HANDHELD', 'MANAGER_TABLET', 'BACKOFFICE'];
const ALLOWED_KIOSK_ROUTES = ['/kds.html', '/kitchen.html', '/shisha.html', '/pos.html', '/tables.html', '/runner.html', '/qr-menu.html'];
const TRUST_GRANT_ROLES = ['OWNER', 'SUPER_ADMIN', 'OP_MANAGER', 'ADMIN'];

/**
 * Register or update device hardware metadata
 */
async function registerDevice(venueId = 'V_DEFAULT', branchId = 'B_DEFAULT', payload = {}, actorUserId = null) {
  const resolvedBranchId = (!branchId || branchId === 'BR_DEFAULT' || branchId === 'B_DEFAULT') ? 'B_DEFAULT' : branchId;
  const deviceId = payload.device_id || payload.id || `DEV_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const friendlyName = payload.friendly_name || payload.name || `جهاز ${deviceId}`;
  const deviceClass = ALLOWED_DEVICE_CLASSES.includes(payload.device_class) ? payload.device_class : (payload.device_type || 'POS');
  const browserVersion = payload.browser_version || payload.userAgent || 'Unknown Browser';
  const osInfo = payload.os_info || payload.platform || 'Unknown OS';
  
  let validStationId = payload.station_id || null;
  if (validStationId) {
    const st = await getQuery(`SELECT id FROM stations WHERE id = ?`, [validStationId]);
    if (!st) validStationId = null;
  }

  const isKiosk = payload.is_kiosk ? 1 : 0;
  const kioskAllowedRoute = payload.kiosk_allowed_route || (isKiosk ? '/pos.html' : null);

  const existing = await getQuery(`SELECT id, is_trusted, status FROM devices WHERE id = ?`, [deviceId]);

  if (existing) {
    await runQuery(
      `UPDATE devices SET 
        friendly_name = ?,
        device_class = ?,
        browser_version = ?,
        os_info = ?,
        station_id = COALESCE(?, station_id),
        last_seen_at = datetime('now', 'localtime'),
        heartbeat_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [friendlyName, deviceClass, browserVersion, osInfo, validStationId, deviceId]
    );
  } else {
    await runQuery(
      `INSERT INTO devices (
        id, branch_id, venue_id, name, friendly_name, device_type, device_class, 
        browser_version, os_info, station_id, is_trusted, is_kiosk, kiosk_allowed_route,
        status, first_seen_at, last_seen_at, enrolled_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'ACTIVE', datetime('now', 'localtime'), datetime('now', 'localtime'), ?)`,
      [deviceId, resolvedBranchId, venueId, friendlyName, friendlyName, deviceClass, deviceClass, browserVersion, osInfo, validStationId, isKiosk, kioskAllowedRoute, actorUserId]
    );

    if (actorUserId) {
      await recordAuditEvent({
        venue_id: venueId,
        actor_user_id: actorUserId,
        event_type: 'DEVICE_REGISTERED',
        entity_type: 'DEVICE',
        entity_id: deviceId,
        details: { friendlyName, deviceClass, browserVersion, osInfo, stationId: validStationId, isKiosk },
        outcome: 'SUCCESS'
      });
    }
  }

  return await getDeviceById(deviceId);
}

/**
 * Explicitly grant device trust with expiration and step-up manager PIN verification
 */
async function grantDeviceTrust(venueId, deviceId, actorUser, durationHours = 720, stationId = null, managerPin = null) {
  if (!actorUser || !TRUST_GRANT_ROLES.includes(actorUser.role)) {
    throw new Error('FORBIDDEN: لا تملك الصلاحية لمنح الثقة للأجهزة. يتطلب صلاحية المالك أو مدير العمليات.');
  }

  if (!managerPin) {
    throw new Error('PIN_REQUIRED: يلزم إدخال الرمز السري للمدير لمنح الثقة للأجهزة.');
  }

  // Step-up verification
  const isPinValid = await verifyReauthentication(actorUser.id, managerPin);
  if (!isPinValid) {
    throw new Error('INVALID_PIN: الرمز السري للمدير غير صحيح.');
  }

  const device = await getQuery(`SELECT * FROM devices WHERE id = ?`, [deviceId]);
  if (!device) {
    throw new Error('DEVICE_NOT_FOUND: الجهاز المحدد غير مسجل بالنظام.');
  }

  let validStationId = stationId;
  if (validStationId) {
    const st = await getQuery(`SELECT id FROM stations WHERE id = ?`, [validStationId]);
    if (!st) validStationId = null;
  }

  const hours = parseInt(durationHours, 10) || 720; // Default 30 days
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  await runQuery(
    `UPDATE devices SET 
      is_trusted = 1,
      trust_expires_at = ?,
      trusted_by = ?,
      trusted_at = datetime('now', 'localtime'),
      status = 'ACTIVE',
      revoked_at = NULL,
      risk_state = 'LOW',
      risk_reason = NULL,
      station_id = COALESCE(?, station_id)
     WHERE id = ?`,
    [expiresAt, actorUser.id, validStationId, deviceId]
  );

  await recordAuditEvent({
    venue_id: venueId || actorUser.venueId || 'V_DEFAULT',
    actor_user_id: actorUser.id,
    event_type: 'DEVICE_TRUST_GRANTED',
    entity_type: 'DEVICE',
    entity_id: deviceId,
    details: { durationHours: hours, expiresAt, stationId, trusted_by: actorUser.id },
    outcome: 'SUCCESS'
  });

  logger.info('Device trust granted', { deviceId, trustedBy: actorUser.id, expiresAt });
  return await getDeviceById(deviceId);
}

/**
 * Revoke device trust and sever all connected sessions
 */
async function revokeDeviceTrust(venueId, deviceId, actorUserId, reason = 'REVOKED_BY_ADMIN') {
  const device = await getQuery(`SELECT * FROM devices WHERE id = ?`, [deviceId]);
  if (!device) {
    throw new Error('DEVICE_NOT_FOUND: الجهاز المحدد غير مسجل بالنظام.');
  }

  await runQuery(
    `UPDATE devices SET 
      is_trusted = 0,
      status = 'REVOKED',
      revoked_at = datetime('now', 'localtime'),
      risk_state = 'BLOCKED',
      risk_reason = ?
     WHERE id = ?`,
    [reason, deviceId]
  );

  // Lazy require to avoid circular dependency
  const { revokeSessionsByDevice } = require('./sessionAdminService');
  const revokedSessionsCount = await revokeSessionsByDevice(deviceId, actorUserId, reason);

  await recordAuditEvent({
    venue_id: venueId || 'V_DEFAULT',
    actor_user_id: actorUserId,
    event_type: 'DEVICE_REVOKED',
    entity_type: 'DEVICE',
    entity_id: deviceId,
    details: { reason, revokedSessionsCount },
    outcome: 'SUCCESS'
  });

  logger.warn('Device revoked', { deviceId, actorUserId, reason, revokedSessionsCount });
  return { success: true, deviceId, revokedSessionsCount, status: 'REVOKED' };
}

/**
 * Configure Kiosk Mode & Station Route Lockdown
 */
async function configureKioskMode(venueId, deviceId, actorUser, isKiosk, allowedRoute = null, managerPin = null) {
  if (!actorUser || !TRUST_GRANT_ROLES.includes(actorUser.role)) {
    throw new Error('FORBIDDEN: لا تملك الصلاحية لضبط وضع الكشك (Kiosk).');
  }

  if (managerPin) {
    const isPinValid = await verifyReauthentication(actorUser.id, managerPin);
    if (!isPinValid) {
      throw new Error('INVALID_PIN: الرمز السري للمدير غير صحيح.');
    }
  }

  const kioskFlag = isKiosk ? 1 : 0;
  let cleanRoute = allowedRoute;
  if (kioskFlag && (!cleanRoute || !ALLOWED_KIOSK_ROUTES.includes(cleanRoute))) {
    cleanRoute = '/pos.html';
  }

  await runQuery(
    `UPDATE devices SET 
      is_kiosk = ?,
      kiosk_allowed_route = ?
     WHERE id = ?`,
    [kioskFlag, cleanRoute, deviceId]
  );

  await recordAuditEvent({
    venue_id: venueId || actorUser.venueId || 'V_DEFAULT',
    actor_user_id: actorUser.id,
    event_type: 'DEVICE_KIOSK_CONFIGURED',
    entity_type: 'DEVICE',
    entity_id: deviceId,
    details: { isKiosk: kioskFlag, allowedRoute: cleanRoute },
    outcome: 'SUCCESS'
  });

  return await getDeviceById(deviceId);
}

/**
 * Get device by ID with live trust evaluation
 */
async function getDeviceById(deviceId) {
  const device = await getQuery(`SELECT * FROM devices WHERE id = ?`, [deviceId]);
  if (!device) return null;

  const now = Date.now();
  const isTrustExpired = device.trust_expires_at ? new Date(device.trust_expires_at).getTime() < now : false;
  const isTrustActive = device.is_trusted === 1 && !isTrustExpired && device.status !== 'REVOKED';

  return {
    ...device,
    is_trusted: device.is_trusted === 1,
    is_kiosk: device.is_kiosk === 1,
    is_trust_active: isTrustActive,
    is_trust_expired: isTrustExpired
  };
}

/**
 * List all devices with live computed trust state
 */
async function listDevices(venueId = 'V_DEFAULT') {
  const devices = await allQuery(
    `SELECT * FROM devices WHERE venue_id = ? OR venue_id IS NULL ORDER BY last_seen_at DESC, name ASC`,
    [venueId]
  );

  const now = Date.now();
  return devices.map(d => {
    const isTrustExpired = d.trust_expires_at ? new Date(d.trust_expires_at).getTime() < now : false;
    const isTrustActive = d.is_trusted === 1 && !isTrustExpired && d.status !== 'REVOKED';
    return {
      ...d,
      is_trusted: d.is_trusted === 1,
      is_kiosk: d.is_kiosk === 1,
      is_trust_active: isTrustActive,
      is_trust_expired: isTrustExpired
    };
  });
}

/**
 * Validate device eligibility for operation and route access
 */
async function validateDeviceForOperation(deviceId, requestedRoute = null) {
  if (!deviceId) return { allowed: true };

  const device = await getDeviceById(deviceId);
  if (!device) return { allowed: true };

  if (device.status === 'REVOKED') {
    throw new Error('DEVICE_REVOKED: تم إبطال صلاحية هذا الجهاز من قبل الإدارة.');
  }

  if (device.is_kiosk && requestedRoute && device.kiosk_allowed_route) {
    if (requestedRoute !== device.kiosk_allowed_route && !requestedRoute.startsWith('/api/')) {
      throw new Error(`KIOSK_ROUTE_FORBIDDEN: هذا الجهاز مقفل على مسار (${device.kiosk_allowed_route}) فقط.`);
    }
  }

  return { allowed: true, device };
}

module.exports = {
  registerDevice,
  grantDeviceTrust,
  revokeDeviceTrust,
  configureKioskMode,
  getDeviceById,
  listDevices,
  validateDeviceForOperation,
  ALLOWED_DEVICE_CLASSES,
  ALLOWED_KIOSK_ROUTES,
  TRUST_GRANT_ROLES
};
