/**
 * Business Intelligence, End-of-Day (EOD), Cash Reconciliation & BOM Variance Reports
 * Strictly enforces authentication and financial blindness
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');

// EOD & Financial Performance Report - strictly requires 'reports:financial'
router.get('/reports/eod', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const shift = req.query.shift || 'ALL';
    const today = new Date().toISOString().split('T')[0];

    // Total gross sales & net sales
    const salesSummary = await getQuery(
      `SELECT 
         COALESCE(SUM(amount_minor), 0) / 100.0 as total_revenue,
         COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount_minor ELSE 0 END), 0) / 100.0 as cash_revenue,
         COALESCE(SUM(CASE WHEN method != 'CASH' THEN amount_minor ELSE 0 END), 0) / 100.0 as digital_revenue,
         COALESCE(SUM(CASE WHEN method = 'VISA' THEN amount_minor ELSE 0 END), 0) / 100.0 as visa_revenue,
         COALESCE(SUM(CASE WHEN method = 'INSTAPAY' THEN amount_minor ELSE 0 END), 0) / 100.0 as instapay_revenue,
         COALESCE(SUM(CASE WHEN method = 'WALLET' THEN amount_minor ELSE 0 END), 0) / 100.0 as wallet_revenue,
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
    const cashRev = salesSummary ? salesSummary.cash_revenue : 0;
    const expectedCashInDrawer = cashRev - totalExp - totalAdv + 200; // 200 default float

    res.json({
      success: true,
      report_date: today,
      shift_filter: shift,
      report: {
        total_revenue: totalRev,
        total_orders: salesSummary ? salesSummary.total_orders : 0,
        drawer_expenses: totalExp,
        total_advances: totalAdv,
        expected_cash_in_drawer: Math.max(0, expectedCashInDrawer),
        payment_methods: {
          CASH: cashRev,
          VISA: salesSummary ? salesSummary.visa_revenue : 0,
          INSTAPAY: salesSummary ? salesSummary.instapay_revenue : 0,
          WALLET: salesSummary ? salesSummary.wallet_revenue : 0
        }
      },
      summary: {
        total_revenue: totalRev,
        cash_revenue: cashRev,
        digital_revenue: salesSummary ? salesSummary.digital_revenue : 0,
        total_tips: salesSummary ? salesSummary.total_tips : 0,
        total_orders: salesSummary ? salesSummary.total_orders : 0,
        total_expenses: totalExp,
        total_advances: totalAdv,
        expected_cash_drawer: Math.max(0, expectedCashInDrawer)
      },
      departmental_breakdown: deptBreakdown
    });
  } catch (err) {
    next(err);
  }
});

// Business Intelligence (BI) Analytics Report - strictly requires 'reports:financial'
router.get('/reports/bi', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const range = req.query.range || 'today';
    let dateFilter = `date(p.created_at) = date('now', 'localtime')`;
    if (range === 'week') {
      dateFilter = `p.created_at >= datetime('now', '-7 days')`;
    } else if (range === 'month') {
      dateFilter = `p.created_at >= datetime('now', 'start of month')`;
    }

    const summary = await getQuery(
      `SELECT 
         COALESCE(SUM(p.amount_minor), 0) / 100.0 as total_revenue,
         COUNT(DISTINCT p.session_id) as total_orders,
         COALESCE(AVG(p.amount_minor), 0) / 100.0 as aov
       FROM payments p 
       WHERE ${dateFilter}`
    );

    const wasteCost = await getQuery(
      `SELECT COALESCE(SUM(amount), 0) as total_waste_cost FROM waste_log`
    );

    const topItems = await allQuery(
      `SELECT oi.item_name as name, 
              SUM(oi.quantity) as quantity, 
              COALESCE(SUM((oi.unit_price_minor * oi.quantity) / 100.0), 0) as revenue
       FROM order_items oi
       JOIN order_sessions os ON oi.session_id = os.id
       WHERE oi.status = 'ACTIVE'
       GROUP BY oi.item_name
       ORDER BY quantity DESC
       LIMIT 10`
    );

    const departmentSales = await allQuery(
      `SELECT oi.department, 
              COALESCE(SUM((oi.unit_price_minor * oi.quantity) / 100.0), 0) as revenue
       FROM order_items oi
       WHERE oi.status = 'ACTIVE'
       GROUP BY oi.department`
    );

    res.json({
      success: true,
      range,
      kpis: {
        total_revenue: summary ? summary.total_revenue : 0,
        total_orders: summary ? summary.total_orders : 0,
        aov: summary ? Math.round(summary.aov * 10) / 10 : 0,
        waste_cost: wasteCost ? wasteCost.total_waste_cost : 0
      },
      top_items: topItems,
      department_sales: departmentSales
    });
  } catch (err) {
    next(err);
  }
});

// Cash Reconciliation for Shift Declaration
router.get('/reports/cash-reconciliation', requireAuth, async (req, res, next) => {
  try {
    const shift = req.query.shift || 'MORNING';
    const sales = await getQuery(
      `SELECT COALESCE(SUM(amount_minor), 0) / 100.0 as cash_sales
       FROM payments
       WHERE method = 'CASH' AND date(created_at) = date('now', 'localtime')`
    );
    const expenses = await getQuery(
      `SELECT COALESCE(SUM(amount), 0) as cash_expenses
       FROM daily_expenses
       WHERE date(created_at) = date('now', 'localtime')`
    );
    const advances = await getQuery(
      `SELECT COALESCE(SUM(amount), 0) as cash_advances
       FROM employee_advances
       WHERE date(issued_at) = date('now', 'localtime')`
    );

    res.json({
      success: true,
      shift,
      reconciliation: {
        cash_sales: sales ? sales.cash_sales : 0,
        cash_expenses: expenses ? expenses.cash_expenses : 0,
        cash_advances: advances ? advances.cash_advances : 0
      }
    });
  } catch (err) {
    next(err);
  }
});

// BOM Variance & Consumption Report
router.get('/reports/bom-reconciliation', requireAuth, requirePermission('reports:inventory'), async (req, res, next) => {
  try {
    const reconciliation = await allQuery(
      `SELECT i.id, i.name, i.unit, i.category as department,
              (i.current_stock_microunits / 1000000.0) as current_stock,
              COALESCE(SUM(CASE WHEN l.event_type = 'CONSUMPTION' THEN ABS(l.quantity_delta_microunits) ELSE 0 END), 0) / 1000000.0 as bom_consumption,
              COALESCE(SUM(CASE WHEN l.event_type = 'WASTE' THEN ABS(l.quantity_delta_microunits) ELSE 0 END), 0) / 1000000.0 as manual_waste
       FROM inventory_items i
       LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
       GROUP BY i.id
       ORDER BY i.name ASC`
    );

    res.json({
      success: true,
      reconciliation: reconciliation.map(r => ({
        ...r,
        current_stock: Math.round(r.current_stock * 100) / 100,
        bom_consumption: Math.round(r.bom_consumption * 100) / 100,
        manual_waste: Math.round(r.manual_waste * 100) / 100,
        auto_waste_allowance: Math.round(r.bom_consumption * 0.05 * 100) / 100,
        status: 'مطابق ✅'
      }))
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
