/**
 * Tables & Seating Management HTTP Routes
 */
const express = require('express');
const router = express.Router();
const {
  getAllTables,
  getTableSessionDetails,
  upsertTable,
  updateTableLifecycle,
  seatTable,
  requestTableCheck,
  vacateTable,
  moveTable
} = require('../../domain/tables/service');
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
        code: 'INVALID_TABLE'
      });
    }
    res.json({
      success: true,
      table
    });
  } catch (err) {
    next(err);
  }
});

// Authenticated tables list
router.get('/tables', requireAuth, async (req, res, next) => {
  try {
    const tables = await getAllTables();
    res.json({
      success: true,
      tables
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
      ...details
    });
  } catch (err) {
    next(err);
  }
});

// Upsert / Create custom table
router.post('/tables', requireAuth, requirePermission('tables:write'), async (req, res, next) => {
  try {
    const result = await upsertTable(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Update table lifecycle status
router.put('/tables/:number/lifecycle', requireAuth, async (req, res, next) => {
  try {
    const { status, waiter_id } = req.body;
    const result = await updateTableLifecycle(req.params.number, status, req.user ? req.user.id : null, waiter_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tables/seat', requireAuth, requirePermission('tables:seat'), async (req, res, next) => {
  try {
    const { table_number, custom_name, customer_name, customer_phone, guest_count } = req.body;
    const result = await seatTable(table_number, custom_name, customer_name, customer_phone, guest_count, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tables/request-check', requireAuth, async (req, res, next) => {
  try {
    const { table_number } = req.body;
    const result = await requestTableCheck(table_number);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tables/vacate', requireAuth, requirePermission('tables:vacate'), async (req, res, next) => {
  try {
    const { table_number } = req.body;
    const result = await vacateTable(table_number);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tables/move', requireAuth, requirePermission('tables:move'), async (req, res, next) => {
  try {
    const { from_table, to_table } = req.body;
    const result = await moveTable(from_table, to_table, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
