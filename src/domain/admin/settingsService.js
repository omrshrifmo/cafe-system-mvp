const { getQuery, runQuery, allQuery } = require('../../db/connection');
const { verifyReauthentication, logAudit } = require('../auth/service');

async function getVenueSettings(venueId) {
  return await getQuery('SELECT * FROM venues WHERE id = ?', [venueId]);
}

async function updateVenueSettings(venueId, payload, userId) {
  // Add some basic validation
  if (payload.tax_registration_number && payload.tax_registration_number.length > 50) {
    throw new Error('VALIDATION_ERROR: tax_registration_number too long');
  }

  const oldVenue = await getVenueSettings(venueId);
  if (!oldVenue) throw new Error('NOT_FOUND: Venue not found');

  const {
    legal_name, name_ar, name_en, logo_url, contact_phone, contact_email, address,
    locale, fiscal_policy, tax_registration_number, receipt_footer, privacy_policy, operating_hours
  } = payload;

  await runQuery(`
    UPDATE venues SET 
      legal_name = COALESCE(?, legal_name),
      name_ar = COALESCE(?, name_ar),
      name_en = COALESCE(?, name_en),
      logo_url = COALESCE(?, logo_url),
      contact_phone = COALESCE(?, contact_phone),
      contact_email = COALESCE(?, contact_email),
      address = COALESCE(?, address),
      locale = COALESCE(?, locale),
      fiscal_policy = COALESCE(?, fiscal_policy),
      tax_registration_number = COALESCE(?, tax_registration_number),
      receipt_footer = COALESCE(?, receipt_footer),
      privacy_policy = COALESCE(?, privacy_policy),
      operating_hours = COALESCE(?, operating_hours),
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `, [
    legal_name, name_ar, name_en, logo_url, contact_phone, contact_email, address,
    locale, fiscal_policy, tax_registration_number, receipt_footer, privacy_policy, 
    operating_hours ? JSON.stringify(operating_hours) : null,
    venueId
  ]);

  const newVenue = await getVenueSettings(venueId);
  
  await logAudit(venueId, userId, 'UPDATE', 'VENUE', venueId, { before: oldVenue, after: newVenue }, null);

  return newVenue;
}

async function getActivePolicy(venueId) {
  return await getQuery('SELECT * FROM v3_policies WHERE venue_id = ? ORDER BY version DESC LIMIT 1', [venueId]);
}

async function publishNewPolicy(venueId, policyPayload, userId, pin) {
  // Require recent reauthentication
  const isAuth = await verifyReauthentication(userId, pin);
  if (!isAuth) {
    throw new Error('UNAUTHORIZED: Invalid PIN for sensitive action');
  }

  // Validate some common configurations
  if (policyPayload.tax_percent !== undefined && (policyPayload.tax_percent < 0 || policyPayload.tax_percent > 100)) {
    throw new Error('VALIDATION_ERROR: Invalid tax percent');
  }

  const currentPolicy = await getActivePolicy(venueId);
  const nextVersion = currentPolicy ? currentPolicy.version + 1 : 1;
  const policyId = `POL_${Date.now()}`;

  await runQuery(`
    INSERT INTO v3_policies (id, venue_id, version, effective_from, payload, created_by)
    VALUES (?, ?, ?, datetime('now', 'localtime'), ?, ?)
  `, [policyId, venueId, nextVersion, JSON.stringify(policyPayload), userId]);

  await logAudit(venueId, userId, 'CREATE', 'POLICY', policyId, { version: nextVersion, payload: policyPayload }, null);

  return { id: policyId, version: nextVersion };
}

// Device Management
async function listDevices(branchId) {
  return await allQuery('SELECT * FROM devices WHERE branch_id = ? ORDER BY name ASC', [branchId]);
}

async function registerDevice(branchId, payload) {
  const deviceId = `DEV_${Date.now()}`;
  await runQuery(`
    INSERT INTO devices (id, branch_id, name, device_type, station_id, capabilities)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [deviceId, branchId, payload.name, payload.device_type, payload.station_id || null, payload.capabilities ? JSON.stringify(payload.capabilities) : null]);
  
  return { id: deviceId };
}

async function recordDeviceHeartbeat(deviceId) {
  await runQuery(`UPDATE devices SET heartbeat_at = datetime('now', 'localtime'), last_seen_at = datetime('now', 'localtime') WHERE id = ?`, [deviceId]);
}

async function revokeDevice(deviceId, userId, venueId) {
  await runQuery(`UPDATE devices SET revoked_at = datetime('now', 'localtime'), status = 'REVOKED' WHERE id = ?`, [deviceId]);
  
  // Also sever any active sessions associated with this device
  await runQuery(`UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE device_id = ? AND revoked_at IS NULL`, [deviceId]);

  await logAudit(venueId, userId, 'REVOKE', 'DEVICE', deviceId, {}, null);
}

module.exports = {
  getVenueSettings,
  updateVenueSettings,
  getActivePolicy,
  publishNewPolicy,
  listDevices,
  registerDevice,
  recordDeviceHeartbeat,
  revokeDevice
};
