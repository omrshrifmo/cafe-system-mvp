/**
 * System Update & Versioned Package Administration Routes
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const updateService = require('../../domain/system/updatePackageService');
const logger = require('../../observability/logger');

/**
 * GET /api/admin/updates/current
 * Returns active version, schema status, and last update details
 */
router.get('/current', requireAuth, async (req, res, next) => {
  try {
    const versionInfo = await updateService.getCurrentVersionInfo();
    res.json({
      success: true,
      ...versionInfo
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/updates/catalog
 * Lists vetted and approved release packages available for 1-click update
 */
router.get('/catalog', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const catalog = updateService.getApprovedCatalog();
    res.json({
      success: true,
      packages: catalog
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/updates/history
 * Lists all previous package updates and rollback audits
 */
router.get('/history', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const history = await updateService.listUpdateHistory();
    res.json({
      success: true,
      history
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/updates/inspect
 * Validates cryptographic signature and returns pre-update dry-run impact report
 */
router.post('/inspect', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const pkg = req.body.package || req.body;
    const impact = await updateService.inspectPackage(pkg);
    res.json({
      success: true,
      impact
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
      code: err.message.split(':')[0] || 'INSPECTION_FAILED'
    });
  }
});

/**
 * POST /api/admin/updates/apply
 * Applies a verified package with automated hot backup, transactional migrations,
 * and post-migration health check
 */
router.post('/apply', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const { package: pkg, pin, confirmation } = req.body;
    if (!pkg) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR: حزمة التحديث مطلوبة' });
    }

    const actorId = req.user.id || req.user.userId;
    const result = await updateService.applyUpdatePackage(pkg, actorId, pin, confirmation);

    res.json(result);
  } catch (err) {
    logger.error('Update apply error:', { error: err.message });
    res.status(400).json({
      success: false,
      error: err.message,
      code: err.message.split(':')[0] || 'UPDATE_APPLICATION_FAILED'
    });
  }
});

/**
 * POST /api/admin/updates/:id/rollback
 * Restores pre-update verified backup snapshot
 */
router.post('/:id/rollback', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const { pin } = req.body;
    const packageId = req.params.id;
    const actorId = req.user.id || req.user.userId;

    const result = await updateService.rollbackUpdate(packageId, actorId, pin);
    res.json(result);
  } catch (err) {
    logger.error('Update rollback error:', { error: err.message });
    res.status(400).json({
      success: false,
      error: err.message,
      code: err.message.split(':')[0] || 'ROLLBACK_FAILED'
    });
  }
});

module.exports = router;
