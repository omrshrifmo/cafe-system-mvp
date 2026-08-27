const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const auditLedgerService = require('../../domain/audit/auditLedgerService');
const securityAnomalyService = require('../../domain/audit/securityAnomalyService');
const notificationDispatcher = require('../../domain/audit/notificationDispatcher');

/**
 * GET /api/audit/events - Role-scoped audit ledger query
 */
router.get('/events', requireAuth, async (req, res, next) => {
  try {
    const result = await auditLedgerService.queryAuditLedger(req.query, req.user);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Legacy alias for GET /api/audit - Return recent logs for backward compatibility
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await auditLedgerService.queryAuditLedger(req.query, req.user);
    res.json({
      success: true,
      logs: result.logs,
      total: result.total
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/export - Export audit events with tamper evidence header
 */
router.get('/export', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const format = req.query.format || 'JSON';
    const exportResult = await auditLedgerService.exportAuditLedger(req.query, format, req.user);
    
    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    res.setHeader('X-Audit-Tamper-Verified', exportResult.metadata.chain_verified ? 'TRUE' : 'FALSE');
    res.setHeader('X-Audit-Latest-Hash', exportResult.metadata.chain_latest_hash || 'NONE');
    
    res.send(exportResult.data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/verify-chain - Cryptographic hash chain validation
 */
router.get('/verify-chain', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const venueId = req.user.venueId || 'V_DEFAULT';
    const verification = await auditLedgerService.verifyAuditChainIntegrity(venueId);
    res.json({
      success: true,
      verification
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/staff-summary - Staff activity and performance analytics
 */
router.get('/staff-summary', requireAuth, async (req, res, next) => {
  try {
    const targetUserId = req.query.user_id || req.user.id;
    const isManagerOrAdmin = ['OWNER', 'SUPER_ADMIN', 'OP_MANAGER', 'ADMIN'].includes(String(req.user.role).toUpperCase());
    
    if (!isManagerOrAdmin && targetUserId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: لا يمكنك استعراض ملخص نشاط موظف آخر'
      });
    }

    const summary = await auditLedgerService.getStaffActivitySummary(
      targetUserId,
      req.user.venueId || 'V_DEFAULT',
      req.query.start_date,
      req.query.end_date
    );

    res.json({
      success: true,
      summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/alerts - Fetch security anomaly alerts
 */
router.get('/alerts', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const alerts = await securityAnomalyService.getSecurityAlerts({
      ...req.query,
      venue_id: req.user.venueId || 'V_DEFAULT'
    });
    res.json({
      success: true,
      alerts
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/alerts/:id/acknowledge - Acknowledge security alert
 */
router.post('/alerts/:id/acknowledge', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const result = await securityAnomalyService.acknowledgeAlert(req.params.id, req.user, req.body.note);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/alerts/:id/resolve - Resolve security alert
 */
router.post('/alerts/:id/resolve', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const result = await securityAnomalyService.resolveAlert(req.params.id, req.user, req.body.note);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/notifications - In-app notifications for authenticated user
 */
router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const result = await notificationDispatcher.getUserNotifications(
      req.user.id,
      req.user.venueId || 'V_DEFAULT',
      Number(req.query.limit) || 50,
      Number(req.query.offset) || 0
    );
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/notifications/:id/read - Mark notification as read
 */
router.post('/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    const result = await notificationDispatcher.markNotificationAsRead(req.params.id, req.user.id);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/channels/config - Outbound notification channels
 */
router.get('/channels/config', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const configs = await notificationDispatcher.getChannelConfigs(req.user.venueId || 'V_DEFAULT');
    res.json({
      success: true,
      configs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/channels/config - Update channel configuration
 */
router.post('/channels/config', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const result = await notificationDispatcher.updateChannelConfig({
      ...req.body,
      venue_id: req.user.venueId || 'V_DEFAULT'
    });
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
