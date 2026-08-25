const { 
  buildReportScope, 
  calculateSalesSummary,
  calculateCogsAndWaste,
  calculateOperatingExpenses,
  calculateShareholderEquity 
} = require('./reportDefinitionService');

async function generateShareholderReport(scopeParams) {
    const scope = scopeParams.date_range ? scopeParams : await buildReportScope({
        venueId: scopeParams.venueId,
        startDate: scopeParams.startDate,
        endDate: scopeParams.endDate,
        shiftId: scopeParams.shiftId,
        timezone: scopeParams.timezone,
        requestId: scopeParams.requestId
    });

    const sales = await calculateSalesSummary(scope);
    const cogs = await calculateCogsAndWaste(scope);
    const opex = await calculateOperatingExpenses(scope);

    const grossProfitMinor = sales.net_sales_minor - cogs.total_cogs_minor;
    const netIncomeMinor = grossProfitMinor - opex.total_expenses_minor;

    const equity = await calculateShareholderEquity(scope, netIncomeMinor);

    return {
        operational_net_income: netIncomeMinor,
        operational_net_income_minor: netIncomeMinor,
        equity_events: {
            capital_contributions: equity.capital_contributions_minor,
            withdrawals_and_distributions: -(equity.withdrawals_minor + equity.distributions_minor),
            retained_earnings_adjustments: equity.retained_earnings_adjustments_minor
        },
        ownership_allocations: equity.ownership_allocations,
        period_equity_change: equity.period_equity_change_minor,
        period_equity_change_minor: equity.period_equity_change_minor,
        reconciliation_status: "RECONCILED"
    };
}

module.exports = { generateShareholderReport };
