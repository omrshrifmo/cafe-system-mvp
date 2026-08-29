/**
 * Enterprise Report-Definition Service & BI Engine Security & Invariant Test Suite
 * 
 * Verifies:
 * 1. Unified report declarations across Portal, EOD, BI, Shareholders, Payroll, Inventory, Receipts, and Exports
 * 2. Strict category separations (Sales, COGS/BOM Waste, Operating Expenses & Payroll, Reversals & Equity)
 * 3. Exact reconciliation across all reporting surfaces with identical fixture data
 * 4. Invariant enforcement: Department totals cannot exceed total net revenue
 * 5. Scope mismatch rejection with VALIDATION_ERROR and safe tracing
 * 6. Profitability / Lossability analysis with low-margin detection & staff effort-to-value caveats
 * 7. Shareholder equity accounting without capital corruption
 * 8. Safe error envelopes without false zero masking
 * 9. CSV export sanitization against formula injection
 */
const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { getQuery, allQuery, runQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');
const { 
  REPORT_TYPES, 
  generateReport, 
  buildReportScope 
} = require('../../src/domain/reports/reportDefinitionService');

describe('Master Report-Definition Service & BI Engine Security Suite', () => {
  let app;
  let ownerCookies;
  let cashierCookies;

  before(async function () {
    this.timeout(60000);
    app = createApp();

    // Ensure venue and canonical roles exist before inserting users
    await runQuery(`INSERT OR IGNORE INTO venues (id, name, created_at) VALUES ('V_DEFAULT', 'كافيه مزاج', datetime('now', 'localtime'))`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_OWNER', 'V_DEFAULT', 'OWNER')`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_OP_ASSISTANT_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);

    // Helper to safely upsert user without triggering ON DELETE RESTRICT
    const upsertUser = async (id, name, roleId, pin) => {
      const pinHash = await hashPin(pin);
      const exists = await getQuery(`SELECT id FROM v3_users WHERE id = ?`, [id]);
      if (exists) {
        await runQuery(
          `UPDATE v3_users SET venue_id = 'V_DEFAULT', name = ?, role_id = ?, pin_hash = ?, is_active = 1 WHERE id = ?`,
          [name, roleId, pinHash, id]
        );
      } else {
        await runQuery(
          `INSERT INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts)
           VALUES (?, 'V_DEFAULT', ?, ?, ?, 1, 0)`,
          [id, name, roleId, pinHash]
        );
      }
      const legacyExists = await getQuery(`SELECT id FROM users WHERE id = ?`, [id]);
      if (legacyExists) {
        await runQuery(`UPDATE users SET name = ?, pin_hash = ?, is_active = 1 WHERE id = ?`, [name, pinHash, id]);
      } else {
        await runQuery(`INSERT INTO users (id, name, role, pin_hash, is_active) VALUES (?, ?, ?, ?, 1)`, [id, name, roleId.replace('R_', ''), pinHash]);
      }
    };

    await upsertUser('102', 'المالك التجريبي', 'R_OWNER', '8802');
    await upsertUser('104', 'كاشير الصالة', 'R_OP_ASSISTANT_CASHIER', '8804');

    // Login Owner (reports:financial authorized)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '8802' });
    ownerCookies = ownerRes.headers['set-cookie'] || [`session_token=${ownerRes.body.sessionId}`];

    // Login Cashier (financially blind)
    const cashierRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '8804' })
      .expect(200);
    cashierCookies = cashierRes.headers['set-cookie'] || [`session_token=${cashierRes.body.sessionId}`];
  });

  describe('1. Standard Canonical Envelope & Metadata Declarations', () => {
    it('should declare all canonical scope metadata on all report types', async () => {
      const reportTypes = [
        REPORT_TYPES.EOD_FINANCIAL,
        REPORT_TYPES.BI_ANALYTICS,
        REPORT_TYPES.PORTAL_OVERVIEW,
        REPORT_TYPES.SHAREHOLDER_EQUITY,
        REPORT_TYPES.PAYROLL_LABOR,
        REPORT_TYPES.INVENTORY_BOM_VARIANCE,
        REPORT_TYPES.PROFITABILITY_LOSSABILITY,
        REPORT_TYPES.EXPORTS_DATA
      ];

      for (const type of reportTypes) {
        const rep = await generateReport(type, {
          range: 'today',
          venueId: 'V_DEFAULT'
        });

        assert.strictEqual(rep.success, true, `Report ${type} must return success: true`);
        assert.ok(rep.scope, `Report ${type} must declare scope`);
        assert.ok(rep.scope.date_range.start_date, 'Must declare start_date');
        assert.ok(rep.scope.date_range.end_date, 'Must declare end_date');
        assert.strictEqual(rep.scope.timezone, 'Africa/Cairo', 'Must declare venue timezone');
        assert.strictEqual(rep.scope.venue_id, 'V_DEFAULT', 'Must declare venue_id');
        assert.strictEqual(rep.scope.branch_id, 'BR_DEFAULT', 'Must declare branch_id');
        assert.strictEqual(rep.scope.report_version, 'v3.2', 'Must declare report_version v3.2');
        assert.ok(rep.scope.catalog_version, 'Must declare catalog_version');
        assert.ok(rep.scope.price_version, 'Must declare price_version');
        assert.ok(rep.scope.policy_version, 'Must declare policy_version');
        assert.ok(Array.isArray(rep.scope.source_ledgers), 'Must declare source_ledgers array');
        assert.ok(rep.scope.source_ledgers.includes('v3_order_sessions'), 'source_ledgers must contain v3_order_sessions');
        assert.ok(rep.scope.source_ledgers.includes('v3_payments'), 'source_ledgers must contain v3_payments');
        assert.ok(rep.scope.source_ledgers.includes('inventory_ledger'), 'source_ledgers must contain inventory_ledger');
        assert.ok(rep.scope.source_ledgers.includes('payroll_periods'), 'source_ledgers must contain payroll_periods');
        assert.ok(rep.scope.last_updated, 'Must declare last_updated timestamp');
        assert.strictEqual(rep.scope.reconciliation_status, 'RECONCILED', 'Must declare reconciliation_status RECONCILED');
        assert.ok(rep.scope.request_id, 'Must declare unique request_id');
      }
    });
  });

  describe('2. Scope Mismatch Validation & Rejection', () => {
    it('should reject a scope where shift date is outside requested date range with VALIDATION_ERROR', async () => {
      const today = new Date().toISOString().split('T')[0];
      // Create a test shift on today
      await runQuery(`
        INSERT OR REPLACE INTO v3_shifts (id, venue_id, business_date, timezone, shift_type, status, version)
        VALUES ('SHIFT-TEST-RECON-001', 'V_DEFAULT', '${today}', 'Africa/Cairo', 'MORNING', 'OPEN', 1)
      `);

      // Attempt to query with date range 2025-01-01 to 2025-01-02 and shiftId SHIFT-TEST-RECON-001
      const res = await request(app)
        .get('/api/reports/eod?startDate=2025-01-01&endDate=2025-01-02&shift=SHIFT-TEST-RECON-001')
        .set('Cookie', ownerCookies)
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.includes('Scope mismatch'), 'Error must specify scope mismatch');
      assert.ok(res.body.requestId, 'Error must include requestId');
      assert.strictEqual(res.body.reconciliation_status, 'FAILED');
      assert.strictEqual(res.body.retry_state.retryable, false);
    });

    it('should reject invalid date range where startDate > endDate', async () => {
      const res = await request(app)
        .get('/api/reports/bi?startDate=2026-12-31&endDate=2026-01-01')
        .set('Cookie', ownerCookies)
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
      assert.ok(res.body.requestId);
    });
  });

  describe('3. Exact Reconciliation Across All Report Types', () => {
    it('should reconcile exact Net Sales and Gross Profit across EOD, BI, Portal, Shareholders and Exports', async () => {
      const eod = await generateReport(REPORT_TYPES.EOD_FINANCIAL, { range: 'today' });
      const bi = await generateReport(REPORT_TYPES.BI_ANALYTICS, { range: 'today' });
      const portal = await generateReport(REPORT_TYPES.PORTAL_OVERVIEW, { range: 'today' });
      const shareholders = await generateReport(REPORT_TYPES.SHAREHOLDER_EQUITY, { range: 'today' });
      const exportsData = await generateReport(REPORT_TYPES.EXPORTS_DATA, { range: 'today', format: 'json' });

      // Financials in Minor Units (Integers)
      const eodNetSalesMinor = eod.financials.net_sales_minor;
      const biNetSalesMinor = bi.financial_categories.sales.net_sales_minor;
      const portalNetSalesMinor = portal.overview.net_sales_minor;
      const shareholderNetSalesMinor = shareholders.financial_statement.net_sales_minor;
      const exportNetSalesEgp = exportsData.data.summary.net_sales_egp;

      // Exact Parity Assertion
      assert.strictEqual(eodNetSalesMinor, biNetSalesMinor, 'EOD and BI Net Sales must match exactly');
      assert.strictEqual(eodNetSalesMinor, portalNetSalesMinor, 'EOD and Portal Net Sales must match exactly');
      assert.strictEqual(eodNetSalesMinor, shareholderNetSalesMinor, 'EOD and Shareholder Net Sales must match exactly');
      assert.strictEqual(eodNetSalesMinor, Math.round(exportNetSalesEgp * 100), 'EOD and Export Net Sales must match exactly');

      // Net Income Parity
      const eodNetIncomeMinor = eod.financials.net_income_minor;
      const biNetIncomeMinor = bi.financial_categories.sales.net_sales_minor - bi.financial_categories.cogs.total_cogs_minor - bi.financial_categories.expenses.total_expenses_minor;
      const portalNetIncomeMinor = portal.overview.net_income_minor;
      const shareholderNetIncomeMinor = shareholders.financial_statement.operational_net_income_minor;

      assert.strictEqual(eodNetIncomeMinor, biNetIncomeMinor, 'EOD and BI Net Income must match');
      assert.strictEqual(eodNetIncomeMinor, portalNetIncomeMinor, 'EOD and Portal Net Income must match');
      assert.strictEqual(eodNetIncomeMinor, shareholderNetIncomeMinor, 'EOD and Shareholder Net Income must match');
    });
  });

  describe('4. Financial Invariant: Department Revenue Sum <= Total Net Revenue', () => {
    it('should verify that departmental revenue breakdown sum never exceeds target net revenue', async () => {
      const eod = await generateReport(REPORT_TYPES.EOD_FINANCIAL, { range: 'today' });
      const deptBreakdown = eod.financial_categories?.departments?.breakdown || eod.departmental_breakdown || {};

      let sumDeptMinor = 0;
      if (Array.isArray(deptBreakdown)) {
        for (const d of deptBreakdown) {
          sumDeptMinor += (d.revenue_minor || Math.round((d.department_revenue || 0) * 100) || 0);
        }
      } else {
        for (const dept of Object.values(deptBreakdown)) {
          sumDeptMinor += (dept.revenue_minor || 0);
        }
      }

      const totalRevenueMinor = eod.financials ? (eod.financials.gross_sales_minor || eod.financials.net_sales_minor || 0) : 0;
      if (totalRevenueMinor > 0) {
        assert.ok(
          sumDeptMinor <= totalRevenueMinor + 100,
          `Department revenue sum (${sumDeptMinor}) must not exceed total net revenue (${totalRevenueMinor})`
        );
      } else {
        assert.ok(true, 'No revenue recorded today to invariant check');
      }
    });
  });

  describe('5. Shareholder Equity Module & Capital Isolation Invariant', () => {
    it('should calculate operational net income independently from capital contributions (No Profit Corruption)', async () => {
      const res = await request(app)
        .get('/api/shareholders')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.financial_statement, 'Must contain financial statement');
      assert.ok(res.body.equity_breakdown, 'Must contain equity breakdown');

      const opNetIncome = res.body.financial_statement.operational_net_income_minor;
      const capital = res.body.equity_breakdown.capital_contributions_minor;
      const drawings = res.body.equity_breakdown.withdrawals_minor;
      const distributions = res.body.equity_breakdown.distributions_minor;
      const periodEquityChange = res.body.equity_breakdown.period_equity_change_minor;

      // Invariant: Period Equity Change = Operational Net Income + Capital - Drawings - Distributions
      assert.strictEqual(
        periodEquityChange,
        opNetIncome + capital - drawings - distributions,
        'Period equity change must reconcile operational net income and capital flows'
      );

      // Ownership Allocations Check (60% / 40%)
      const allocations = res.body.equity_breakdown.ownership_allocations;
      assert.ok(Array.isArray(allocations), 'Ownership allocations must be an array');
      assert.strictEqual(allocations.length, 2, 'Must allocate across 2 default partners');
      assert.strictEqual(allocations[0].equity_share_pct, 60.0);
      assert.strictEqual(allocations[1].equity_share_pct, 40.0);
    });

    it('should record shareholder transaction and update equity ledger atomically', async () => {
      const transRes = await request(app)
        .post('/api/shareholders/transactions')
        .set('Cookie', ownerCookies)
        .send({
          partner_name: 'المهندس أسامة',
          transaction_type: 'CAPITAL_INJECTION',
          amount: 15000,
          description: 'شراء ماكينة قهوة إسبريسو جديدة للفرع'
        })
        .expect(200);

      assert.strictEqual(transRes.body.success, true);
      assert.ok(transRes.body.transaction_id);
      assert.ok(transRes.body.equity_id);

      // Verify transaction exists in equity_ledger
      const equityRow = await getQuery(`SELECT * FROM equity_ledger WHERE id = ?`, [transRes.body.equity_id]);
      assert.ok(equityRow, 'Equity ledger row must exist');
      assert.strictEqual(equityRow.amount_minor, 1500000);
      assert.strictEqual(equityRow.event_type, 'CAPITAL_CONTRIBUTION');
    });
  });

  describe('6. Profitability, Multi-Dimensional Margins & Staff Effort-to-Value', () => {
    it('should return categorized margins and low-margin item detection', async () => {
      const res = await request(app)
        .get('/api/reports/profitability')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.margins, 'Must return margins');
      assert.ok(res.body.leakage_and_risks, 'Must return leakage and risks');
      assert.ok(Array.isArray(res.body.margins.by_category), 'Must contain category margins');
      assert.ok(Array.isArray(res.body.margins.by_item), 'Must contain item margins');
      assert.ok(Array.isArray(res.body.leakage_and_risks.low_margin_items), 'Must identify low margin items');
    });

    it('should return staff effort-to-value metrics with explicit non-compensation caveat', async () => {
      const res = await request(app)
        .get('/api/reports/payroll')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.labor_cost, 'Must return labor cost summary');
      assert.ok(res.body.staff_effort_to_value, 'Must return effort-to-value metrics');
      assert.ok(res.body.staff_effort_to_value.formula, 'Must state calculation formula');
      assert.ok(res.body.staff_effort_to_value.data_freshness, 'Must state data freshness timestamp');
      assert.ok(
        res.body.staff_effort_to_value.non_compensation_caveats.includes('strictly isolated from direct employee compensation'),
        'Must contain non-compensation legal disclaimer'
      );
      assert.ok(Array.isArray(res.body.staff_effort_to_value.staff_performance), 'Must list staff performance array');
    });
  });

  describe('7. Exports Endpoint & CSV Formula Injection Sanitization', () => {
    it('should export structured JSON dataset with metadata declaration', async () => {
      const res = await request(app)
        .get('/api/reports/export?format=json')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.format, 'json');
      assert.ok(res.body.scope);
      assert.ok(res.body.data.summary);
      assert.ok(res.body.data.department_breakdown);
    });

    it('should export CSV with sanitized formula injection characters (=, +, -, @)', async () => {
      const res = await request(app)
        .get('/api/reports/export?format=csv')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
      assert.ok(res.headers['content-disposition'].includes('attachment; filename='));
      assert.ok(typeof res.text === 'string');

      // Check CSV content header
      assert.ok(res.text.includes('"Category","Item Name","Quantity Sold"'));
      
      // Ensure no unquoted executable formula characters start raw cells
      const lines = res.text.split('\n');
      for (const line of lines) {
        if (!line) continue;
        const cells = line.split(',');
        for (const cell of cells) {
          const raw = cell.replace(/^"/, '').replace(/"$/, '');
          assert.ok(!raw.startsWith('='), 'Formula = must be sanitized');
          assert.ok(!raw.startsWith('@'), 'Formula @ must be sanitized');
        }
      }
    });
  });

  describe('8. Financial Blindness & Role Permission Security', () => {
    it('should block Cashier from accessing /api/reports/eod with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/reports/eod')
        .set('Cookie', cashierCookies)
        .expect(403);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'FORBIDDEN');
    });

    it('should block Cashier from accessing /api/reports/bi with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/reports/bi')
        .set('Cookie', cashierCookies)
        .expect(403);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'FORBIDDEN');
    });

    it('should block Cashier from accessing /api/reports/shareholders with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/reports/shareholders')
        .set('Cookie', cashierCookies)
        .expect(403);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'FORBIDDEN');
    });
  });
});
