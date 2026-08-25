/**
 * Business Intelligence, End-of-Day (EOD), Cash Reconciliation, Shareholder, Payroll & BOM Variance Reports
 * Powered by the Authoritative Master Report-Definition Service
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { 
  REPORT_TYPES, 
  generateReport 
} = require('../../domain/reports/reportDefinitionService');

// 1. EOD & Financial Performance Report - strictly requires 'reports:financial'
router.get('/reports/eod', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.EOD_FINANCIAL, {
      ...req.query,
      shiftId: req.query.shift !== 'ALL' ? req.query.shift : undefined,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 2. Business Intelligence (BI) Analytics Report - strictly requires 'reports:financial'
router.get('/reports/bi', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.BI_ANALYTICS, {
      ...req.query,
      range: req.query.range || 'today',
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 3. Portal Overview Live Report
router.get('/reports/portal', requireAuth, requirePermission('reports:operational'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.PORTAL_OVERVIEW, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 4. Shareholder Equity & Statement Report (both /reports/shareholders and /shareholders)
router.get(['/reports/shareholders', '/shareholders'], requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.SHAREHOLDER_EQUITY, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post('/shareholders/transactions', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const { partner_name, transaction_type, amount, description } = req.body;
    if (!partner_name || !transaction_type || !amount) {
      return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
    }
    const result = await runQuery(
      `INSERT INTO shareholder_ledger (partner_name, type, amount, description)
       VALUES (?, ?, ?, ?)`,
      [partner_name, transaction_type, Number(amount) || 0, description || null]
    );

    const venueId = 'V_DEFAULT';
    let eventType = 'CAPITAL_CONTRIBUTION';
    if (transaction_type === 'WITHDRAWAL') eventType = 'OWNER_WITHDRAWAL';
    if (transaction_type === 'DISTRIBUTION') eventType = 'DISTRIBUTION';

    const amtMinor = Math.round(Number(amount) * 100);
    const equityId = `EQ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const actorId = req.user ? String(req.user.id) : '102';
    const effectiveDate = new Date().toISOString().split('T')[0];

    await runQuery(
      `INSERT INTO equity_ledger (id, venue_id, event_type, amount_minor, effective_date, actor_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [equityId, venueId, eventType, amtMinor, effectiveDate, actorId, description || `${transaction_type} by ${partner_name}`]
    );

    res.json({ success: true, transaction_id: result.lastID, equity_id: equityId, message: 'تم تسجيل المعاملة بنجاح' });
  } catch (err) {
    next(err);
  }
});

// 5. Payroll Labor & Effort-to-Value Report
router.get('/reports/payroll', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.PAYROLL_LABOR, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 6. Profitability & Multi-Dimensional Margins Report
router.get('/reports/profitability', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.PROFITABILITY_LOSSABILITY, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 7. Structured Exports Data (JSON / CSV with Formula Injection Sanitization)
router.get('/reports/export', requireAuth, requirePermission('reports:export'), async (req, res, next) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const report = await generateReport(REPORT_TYPES.EXPORTS_DATA, {
      ...req.query,
      format,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      return res.send(report.csv_content);
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 8. Cash Reconciliation for Shift Declaration
router.get('/reports/cash-reconciliation', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
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

// 9. BOM Variance & Consumption Report
router.get('/reports/bom-reconciliation', requireAuth, requirePermission('reports:inventory'), async (req, res, next) => {
  try {
    const report = await generateReport(REPORT_TYPES.INVENTORY_BOM_VARIANCE, {
      ...req.query,
      venueId: req.query.venue_id || 'V_DEFAULT'
    });

    if (!report.success) {
      return res.status(report.code === 'VALIDATION_ERROR' ? 400 : 500).json(report);
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// Structured Expenses & Indirect Cost Allocations
const { getExpenses, recordExpense, allocateIndirectCosts } = require('../../domain/accounting/expenseService');

router.get('/expenses', requireAuth, async (req, res, next) => {
  try {
    const expenses = await getExpenses(req.query);
    res.json({
      success: true,
      expenses
    });
  } catch (err) {
    next(err);
  }
});

router.post('/expenses', requireAuth, async (req, res, next) => {
  try {
    const result = await recordExpense(req.body, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/expenses/:id/allocate', requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const { basis, ratios } = req.body;
    const result = await allocateIndirectCosts(req.params.id, basis, ratios, req.user ? req.user.id : null);
    res.json(result);
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

// Get total tips for today
router.get('/tips/total', requireAuth, requirePermission('reports:read'), async (req, res, next) => {
  try {
    const tipRow = await getQuery(
      `SELECT COALESCE(SUM(tip_minor), 0) / 100.0 as total_tips 
       FROM payments 
       WHERE status = 'COMPLETED' 
       AND date(created_at) = date('now', 'localtime')`
    );
    res.json({ success: true, total: tipRow ? tipRow.total_tips : 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
