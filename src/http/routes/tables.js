/**
 * Tables & Seating Management HTTP Routes
 * Enforces canonical states, optimistic locking, and waiter assistance endpoints.
 */
const express = require('express');
const router = express.Router();
const {
  getAllTables,
  getTableSessionDetails,
  upsertTable,
  updateTableState,
  openTable,
  revertTableOpen,
  seatTable,
  requestTableCheck,
  vacateTable,
  moveTable
} = require('../../domain/tables/service');
const {
  scanIdleTablesAndGenerateTasks,
  getActiveAssistanceTasks,
  acknowledgeTask,
  completeTask,
  cancelTask
} = require('../../domain/hospitality/waiterAssistService');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getQuery } = require('../../db/connection');

// Public table validation for QR guests
router.get('/public/tables/:number', async (req, res, next) => {
  try {
    const tableNum = req.params.number;
    const table = await getQuery(`SELECT id, table_number, zone, capacity, status FROM tables WHERE table_number = ?`, [tableNum]);
    if (!table) {
      return res.status(404).json({
        success: false,
        error: `طاولة رقم (${tableNum}) غير صالحة أو غير مسجلة بنظام الصالة`,
        code: 'INVALID_TABLE',
        requestId: req.id
      });
    }
    res.json({
      success: true,
      data: { table },
      table,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Authenticated tables list with consolidated stats & card data
router.get('/tables', requireAuth, async (req, res, next) => {
  try {
    const { tables, stats } = await getAllTables();
    res.json({
      success: true,
      data: { tables, stats },
      tables,
      stats,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Get table session details and active orders
router.get('/tables/:number/session', requireAuth, async (req, res, next) => {
  try {
    const details = await getTableSessionDetails(req.params.number);
    res.json({
      success: true,
      data: details,
      ...details,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Open Table Session with Full Metadata and Optimistic Lock
router.post('/tables/open', requireAuth, requirePermission('tables:seat'), async (req, res, next) => {
  try {
    const { table_number, guest_count, custom_name, customer_name, customer_phone, venue_id, device_id, shift_id, expected_version } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await openTable({
      table_number,
      guest_count,
      custom_name,
      customer_name,
      customer_phone,
      venue_id,
      device_id,
      shift_id,
      actor_id: actorId,
      expected_version
    });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Revert Opened Table without orphan records
router.post('/tables/:number/revert', requireAuth, requirePermission('tables:vacate'), async (req, res, next) => {
  try {
    const actorId = req.user ? req.user.id : 1;
    const result = await revertTableOpen(req.params.number, actorId, req.body.reason);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// State Lifecycle Update with Optimistic Lock
router.put('/tables/:number/state', requireAuth, async (req, res, next) => {
  try {
    const { status, expected_version, notes } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await updateTableState(req.params.number, status, expected_version, actorId, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Legacy lifecycle update endpoint compatibility
router.put('/tables/:number/lifecycle', requireAuth, async (req, res, next) => {
  try {
    const { status, expected_version, notes } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await updateTableState(req.params.number, status, expected_version, actorId, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Waiter Assistance: Scan & Get Tasks
router.get('/tables/assistance', requireAuth, async (req, res, next) => {
  try {
    const threshold = req.query.threshold ? parseInt(req.query.threshold, 10) : 30;
    // Scan idle tables first
    await scanIdleTablesAndGenerateTasks({ idleThresholdMinutes: threshold });
    const tasks = await getActiveAssistanceTasks();
    res.json({
      success: true,
      data: { tasks },
      tasks,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Waiter Assistance: Acknowledge Task
router.post('/tables/assistance/:id/acknowledge', requireAuth, async (req, res, next) => {
  try {
    const waiterId = req.user ? req.user.id : 1;
    const result = await acknowledgeTask(req.params.id, waiterId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Waiter Assistance: Complete Task
router.post('/tables/assistance/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const waiterId = req.user ? req.user.id : 1;
    const result = await completeTask(req.params.id, waiterId, req.body.notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Upsert / Create custom table
router.post('/tables', requireAuth, requirePermission('tables:write'), async (req, res, next) => {
  try {
    const result = await upsertTable(req.body);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Legacy convenience endpoints
router.post('/tables/seat', requireAuth, requirePermission('tables:seat'), async (req, res, next) => {
  try {
    const { table_number, custom_name, customer_name, customer_phone, guest_count, expected_version } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await openTable({
      table_number,
      custom_name,
      customer_name,
      customer_phone,
      guest_count,
      actor_id: actorId,
      expected_version
    });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tables/request-check', requireAuth, async (req, res, next) => {
  try {
    const { table_number, expected_version } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await updateTableState(table_number, 'REQUESTED_CHECK', expected_version, actorId, 'طلب الشيك');
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tables/vacate', requireAuth, requirePermission('tables:vacate'), async (req, res, next) => {
  try {
    const { table_number, expected_version } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await updateTableState(table_number, 'AVAILABLE', expected_version, actorId, 'تفريغ الطاولة');
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tables/move', requireAuth, requirePermission('tables:move'), async (req, res, next) => {
  try {
    const { from_table, to_table } = req.body;
    const actorId = req.user ? req.user.id : 1;
    const result = await moveTable(from_table, to_table, actorId);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
