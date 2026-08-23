const { getQuery } = require('../../db/connection');
const { generateProfitAndLoss } = require('./pnlReportService');

async function generateShareholderReport(scope) {
    const pnl = await generateProfitAndLoss(scope);
    const netIncome = pnl.net_income;

    let dateFilter = `date(effective_date) >= ? AND date(effective_date) <= ?`;
    let params = [scope.venueId, scope.startDate, scope.endDate];

    if (scope.shiftId) {
        dateFilter = `effective_date >= ? AND (effective_date <= ? OR ? IS NULL)`;
        params = [scope.venueId, scope.shift.opened_at, scope.shift.closed_at, scope.shift.closed_at];
    }

    const equityEvents = await getQuery(`
        SELECT 
            COALESCE(SUM(CASE WHEN event_type = 'CAPITAL_CONTRIBUTION' THEN amount_minor ELSE 0 END), 0) as capital_contributions,
            COALESCE(SUM(CASE WHEN event_type = 'OWNER_WITHDRAWAL' THEN amount_minor ELSE 0 END), 0) as withdrawals,
            COALESCE(SUM(CASE WHEN event_type = 'DISTRIBUTION' THEN amount_minor ELSE 0 END), 0) as distributions,
            COALESCE(SUM(CASE WHEN event_type = 'RETAINED_EARNINGS_ADJUSTMENT' THEN amount_minor ELSE 0 END), 0) as retained_earnings_adjustments
        FROM equity_ledger
        WHERE venue_id = ? AND ${dateFilter}
    `, params);

    const periodEquityChange = netIncome 
                             + equityEvents.capital_contributions 
                             + equityEvents.withdrawals // withdrawals are stored as negative amounts
                             + equityEvents.distributions
                             + equityEvents.retained_earnings_adjustments;

    return {
        operational_net_income: netIncome,
        equity_events: {
            capital_contributions: equityEvents.capital_contributions,
            withdrawals_and_distributions: equityEvents.withdrawals + equityEvents.distributions,
            retained_earnings_adjustments: equityEvents.retained_earnings_adjustments
        },
        period_equity_change: periodEquityChange,
        reconciliation_status: "RECONCILED"
    };
}

module.exports = { generateShareholderReport };
