/**
 * Device Trust, Hardware Registry & Kiosk Management Routes
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const deviceTrustService = require('../../domain/admin/deviceTrustService');

// Public or Authenticated Device Self-Enrollment
router.post('/register', async (req, res, next) => {
  try {
    const venueId = (req.user && req.user.venueId) || req.body.venue_id || 'V_DEFAULT';
    const branchId = req.body.branch_id || 'BR_DEFAULT';
    const actorId = req.user ? req.user.id : null;
    
    const device = await deviceTrustService.registerDevice(venueId, branchId, req.body, actorId);
    res.json({ success: true, device, message: 'تم تسجيل الجهاز بنجاح في سجل الأجهزة.' });
  } catch (err) {
    next(err);
  }
});

// List all devices
router.get('/', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const devices = await deviceTrustService.listDevices(venueId);
    res.json({ success: true, devices });
  } catch (err) {
    next(err);
  }
});

// Get device details
router.get('/:id', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const device = await deviceTrustService.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, error: 'الجهاز غير موجود' });
    }
    res.json({ success: true, device });
  } catch (err) {
    next(err);
  }
});

// Grant device trust (Requires Owner/Manager + Step-Up PIN)
router.post('/:id/trust', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const { duration_hours, station_id, pin, manager_pin } = req.body;
    const effectivePin = pin || manager_pin;
    const venueId = req.user.venueId || 'V_DEFAULT';

    const device = await deviceTrustService.grantDeviceTrust(
      venueId,
      req.params.id,
      req.user,
      duration_hours,
      station_id,
      effectivePin
    );

    res.json({ success: true, device, message: 'تم منح الثقة للجهاز بنجاح وتحديد الصلاحية.' });
  } catch (err) {
    if (err.message.includes('FORBIDDEN') || err.message.includes('PIN_REQUIRED') || err.message.includes('INVALID_PIN')) {
      return res.status(403).json({ success: false, error: err.message, code: 'TRUST_GRANT_DENIED' });
    }
    next(err);
  }
});

// Revoke device trust
router.post('/:id/revoke', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const reason = req.body.reason || 'إبطال الجهاز من قبل الإدارة';

    const result = await deviceTrustService.revokeDeviceTrust(
      venueId,
      req.params.id,
      req.user.id,
      reason
    );

    res.json({ success: true, ...result, message: 'تم إبطال الجهاز وقطع كافة الجلسات المرتبطة به فوراً.' });
  } catch (err) {
    next(err);
  }
});

// Untrust device alias
router.post('/:id/untrust', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const reason = req.body.reason || 'إلغاء ثقة الجهاز';

    const result = await deviceTrustService.revokeDeviceTrust(
      venueId,
      req.params.id,
      req.user.id,
      reason
    );

    res.json({ success: true, ...result, message: 'تم إلغاء ثقة الجهاز بنجاح.' });
  } catch (err) {
    next(err);
  }
});

// Configure Kiosk Mode
router.post('/:id/kiosk', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const { is_kiosk, allowed_route, pin, manager_pin } = req.body;
    const effectivePin = pin || manager_pin;

    const device = await deviceTrustService.configureKioskMode(
      venueId,
      req.params.id,
      req.user,
      is_kiosk,
      allowed_route,
      effectivePin
    );

    res.json({ success: true, device, message: 'تم تحديث إعدادات وضع الكشك (Kiosk Mode) بنجاح.' });
  } catch (err) {
    if (err.message.includes('FORBIDDEN') || err.message.includes('INVALID_PIN')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    next(err);
  }
});

module.exports = router;
