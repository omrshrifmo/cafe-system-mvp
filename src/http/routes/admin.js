const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const settingsService = require('../../domain/admin/settingsService');
const hardwareService = require('../../domain/admin/hardwareService');

// ==========================================
// Venue Configuration
// ==========================================

router.get('/venue', requireAuth, async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const venue = await settingsService.getVenueSettings(venueId);
    if (venue && venue.operating_hours) {
      try { venue.operating_hours = JSON.parse(venue.operating_hours); } catch (e) {}
    }
    res.json({ success: true, venue });
  } catch (err) {
    next(err);
  }
});

router.put('/venue', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const updatedVenue = await settingsService.updateVenueSettings(venueId, req.body, req.user.id);
    res.json({ success: true, venue: updatedVenue, message: 'Venue settings updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Effective-Dated Policies
// ==========================================

router.get('/policies/active', requireAuth, async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const policy = await settingsService.getActivePolicy(venueId);
    if (policy && policy.payload) {
      try { policy.payload = JSON.parse(policy.payload); } catch(e){}
    }
    res.json({ success: true, policy });
  } catch (err) {
    next(err);
  }
});

router.post('/policies', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const { pin, payload } = req.body;
    
    if (!pin) {
      return res.status(401).json({ success: false, error: 'PIN required for sensitive policy changes' });
    }

    const newPolicy = await settingsService.publishNewPolicy(venueId, payload, req.user.id, pin);
    res.json({ success: true, policy: newPolicy, message: 'New configuration policy published successfully.' });
  } catch (err) {
    if (err.message.includes('UNAUTHORIZED') || err.message.includes('VALIDATION_ERROR') || err.message.includes('INVALID_PIN') || err.message.includes('ACCOUNT_LOCKED')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// ==========================================
// Device & Station Administration
// ==========================================

router.get('/devices', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const branchId = req.query.branchId || 'B_DEFAULT';
    const devices = await settingsService.listDevices(branchId);
    res.json({ success: true, devices });
  } catch (err) {
    next(err);
  }
});

router.post('/devices', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const branchId = req.body.branchId || 'B_DEFAULT';
    const device = await settingsService.registerDevice(branchId, req.body);
    res.json({ success: true, device, message: 'Device registered successfully.' });
  } catch (err) {
    next(err);
  }
});

router.post('/devices/:id/revoke', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    await settingsService.revokeDevice(req.params.id, req.user.id, venueId);
    res.json({ success: true, message: 'Device access revoked immediately.' });
  } catch (err) {
    next(err);
  }
});

router.post('/devices/:id/heartbeat', requireAuth, async (req, res, next) => {
  try {
    await settingsService.recordDeviceHeartbeat(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// Hardware Administration (Printers, Drawers)
// ==========================================

router.post('/hardware/printer-test', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const result = await hardwareService.testPrinter(venueId, req.body.deviceId, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/hardware/drawer-kick', requireAuth, requirePermission('payments:settle'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const result = await hardwareService.testDrawerKick(venueId, req.body.deviceId, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// System Audit Trail Logs
// ==========================================

router.get('/audit', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const { allQuery } = require('../../db/connection');
    const logs = await allQuery(
      `SELECT a.id, a.user_id, a.action, a.target_table, a.record_id, a.previous_value, a.new_value, a.created_at, u.name as user_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    res.json({
      success: true,
      logs
    });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/logs', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  req.url = '/audit';
  return router.handle(req, res, next);
});

module.exports = router;
