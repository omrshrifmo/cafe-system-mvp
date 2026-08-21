/**
 * Business Intelligence, End-of-Day (EOD) & BOM Variance Reports
 * Strictly enforces financial blindness for OP_ASSISTANT_CASHIER and CASHIER
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery } = require('../../db/connection');

// EOD & Financial Performance Report
router.get('/reports/eod', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Total gross sales & net sales
    const salesSummary = await getQuery(
      `SELECT 
         COALESCE(SUM(amount_minor), 0) / 100.0 as total_revenue,
         COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount_minor ELSE 0 END), 0) / 100.0 as cash_revenue,
         COALESCE(SUM(CASE WHEN method != 'CASH' THEN amount_minor ELSE 0 END), 0) / 100.0 as digital_revenue,
         COALESCE(SUM(tip_minor), 0) / 100.0 as total_tips,
         COUNT(DISTINCT session_id) as total_orders
       FROM payments 
       WHERE date(created_at) = date('now', 'localtime')`
    );

    // Total expenses today
    const expSummary = await getQuery(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses 
       FROM daily_expenses 
       WHERE date(expense_date) = date('now', 'localtime') OR date(created_at) = date('now', 'localtime')`
    );

    // Total staff advances today
    const advSummary = await getQuery(
      `SELECT COALESCE(SUM(amount), 0) as total_advances 
       FROM employee_advances 
       WHERE date(issued_at) = date('now', 'localtime')`
    );

    // Departmental breakdown
    const deptBreakdown = await allQuery(
      `SELECT oi.department, 
              COUNT(oi.id) as item_count, 
              COALESCE(SUM((oi.unit_price_minor * oi.quantity) / 100.0), 0) as department_revenue
       FROM order_items oi
       JOIN order_sessions os ON oi.session_id = os.id
       WHERE oi.status = 'ACTIVE' AND date(oi.created_at) = date('now', 'localtime')
       GROUP BY oi.department`
    );

    const totalRev = salesSummary ? salesSummary.total_revenue : 0;
    const totalExp = expSummary ? expSummary.total_expenses : 0;
    const totalAdv = advSummary ? advSummary.total_advances : 0;
    const netCashInDrawer = (salesSummary ? salesSummary.cash_revenue : 0) - totalExp - totalAdv + 500; // 500 opening float

    res.json({
      success: true,
      report_date: today,
      summary: {
        total_revenue: totalRev,
        cash_revenue: salesSummary ? salesSummary.cash_revenue : 0,
        digital_revenue: salesSummary ? salesSummary.digital_revenue : 0,
        total_tips: salesSummary ? salesSummary.total_tips : 0,
        total_orders: salesSummary ? salesSummary.total_orders : 0,
        total_expenses: totalExp,
        total_advances: totalAdv,
        net_profit_estimate: totalRev - totalExp,
        expected_cash_drawer: netCashInDrawer
      },
      departmental_breakdown: deptBreakdown
    });
  } catch (err) {
    next(err);
  }
});

// BOM Variance & Consumption Report
router.get('/reports/bom-variance', requireAuth, requirePermission('reports:inventory'), async (req, res, next) => {
  try {
    const varianceData = await allQuery(
      `SELECT i.id, i.name as inventory_item_name, i.unit,
              i.current_stock_microunits / 1000000.0 as current_stock,
              COALESCE(SUM(CASE WHEN l.event_type = 'CONSUMPTION' THEN ABS(l.quantity_delta_microunits) ELSE 0 END), 0) / 1000000.0 as total_consumed,
              COALESCE(SUM(CASE WHEN l.event_type = 'WASTE' THEN ABS(l.quantity_delta_microunits) ELSE 0 END), 0) / 1000000.0 as total_wasted,
              COALESCE(SUM(CASE WHEN l.event_type = 'PURCHASE' THEN l.quantity_delta_microunits ELSE 0 END), 0) / 1000000.0 as total_purchased
       FROM inventory_items i
       LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
       GROUP BY i.id
       ORDER BY i.name ASC`
    );

    res.json({
      success: true,
      variance_report: varianceData
    });
  } catch (err) {
    next(err);
  }
});

// Daily expenses management
router.get('/expenses', requireAuth, async (req, res, next) => {
  try {
    const expenses = await allQuery(`SELECT * FROM daily_expenses ORDER BY created_at DESC LIMIT 50`);
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

router.post('/expenses', requireAuth, async (req, res, next) => {
  try {
    const { description, amount, payment_source = 'DRAWER' } = req.body;
    const { runQuery } = require('../../db/connection');
    const result = await runQuery(
      `INSERT INTO daily_expenses (description, amount, payment_source, created_by, expense_date)
       VALUES (?, ?, ?, ?, date('now', 'localtime'))`,
      [description, amount, payment_source, req.user.id]
    );
    res.json({ success: true, expense_id: result.lastID });
  } catch (err) {
    next(err);
  }
});

// Employee advances
router.get('/advances', requireAuth, async (req, res, next) => {
  try {
    const advances = await allQuery(`SELECT * FROM employee_advances ORDER BY created_at DESC LIMIT 50`);
    res.json(advances);
  } catch (err) {
    next(err);
  }
});

router.post('/advances', requireAuth, async (req, res, next) => {
  try {
    const { employee_name, amount, reason } = req.body;
    const { runQuery } = require('../../db/connection');
    const result = await runQuery(
      `INSERT INTO employee_advances (employee_name, amount, reason) VALUES (?, ?, ?)`,
      [employee_name, amount, reason]
    );
    res.json({ success: true, advance_id: result.lastID });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
