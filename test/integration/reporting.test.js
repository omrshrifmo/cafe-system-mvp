const assert = require('assert');
const { buildReportScope } = require('../../src/domain/reports/reportDefinitionService');
const { generateDepartmentBreakdown } = require('../../src/domain/reports/salesReportService');
const { generateShareholderReport } = require('../../src/domain/reports/equityReportService');
const { runQuery } = require('../../src/db/connection');

describe('Reporting & Drill-Down Integration', () => {

  describe('Scope Validation', () => {
    it('should reject a request that mixes conflicting shift and date scopes', async () => {
      const today = new Date().toISOString().split('T')[0];
      await runQuery(`
        INSERT OR REPLACE INTO v3_shifts (id, venue_id, business_date, timezone, shift_type, status, version)
        VALUES ('SHIFT-INTEG-001', 'V_DEFAULT', '${today}', 'Africa/Cairo', 'MORNING', 'OPEN', 1)
      `);

      try {
        await buildReportScope({
          venueId: 'V_DEFAULT',
          startDate: '2025-01-01',
          endDate: '2025-01-02',
          shiftId: 'SHIFT-INTEG-001'
        });
        assert.fail('Should have thrown scope mismatch');
      } catch (err) {
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /Scope mismatch/);
      }
    });

    it('should assign a request ID to the scope for error tracking', async () => {
      const scope = await buildReportScope({
        venueId: 'V_DEFAULT',
        startDate: '2026-08-01',
        endDate: '2026-08-31'
      });
      assert.ok(scope.request_id);
    });
  });

  describe('Financial Invariants', () => {
    it('should ensure department breakdown sum does not exceed target revenue', async () => {
      const report = await generateDepartmentBreakdown({
        venueId: 'V_DEFAULT',
        startDate: '2026-08-01',
        endDate: '2026-08-31'
      });
      assert.ok(report.invariant_pass === true);
    });

    it('should compute exact shareholder equity independently from net income', async () => {
      const report = await generateShareholderReport({
        venueId: 'V_DEFAULT',
        startDate: '2026-08-01',
        endDate: '2026-08-31'
      });
      assert.strictEqual(
        report.period_equity_change_minor,
        report.operational_net_income_minor +
        report.equity_events.capital_contributions +
        report.equity_events.withdrawals_and_distributions +
        report.equity_events.retained_earnings_adjustments
      );
    });
  });

});
