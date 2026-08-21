/**
 * Tables & Seating Management HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { getAllTables, seatTable, requestTableCheck, vacateTable, moveTable } = require('../../domain/tables/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

router.get('/tables', async (req, res, next) => {
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
