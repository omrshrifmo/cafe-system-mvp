const { 
  buildReportScope, 
  calculateSalesSummary, 
  calculateCogsAndWaste, 
  calculateOperatingExpenses 
} = require('./reportDefinitionService');

async function generateProfitAndLoss(scopeParams) {
    const scope = scopeParams.date_range ? scopeParams : await buildReportScope({
        venueId: scopeParams.venueId,
        startDate: scopeParams.startDate,
        endDate: scopeParams.endDate,
        shiftId: scopeParams.shiftId,
        timezone: scopeParams.timezone,
        requestId: scopeParams.requestId
    });

    const sales = await calculateSalesSummary(scope);
    const cogsSummary = await calculateCogsAndWaste(scope);
    const opexSummary = await calculateOperatingExpenses(scope);

    const netSales = sales.net_sales_minor;
    const cogs = cogsSummary.cogs_bom_consumption_minor;
    const grossProfit = netSales - cogs;
    const payroll = opexSummary.payroll_minor;
    const opex = opexSummary.total_operating_expenses_minor;
    const totalExpenses = payroll + opex;
    const netIncome = grossProfit - totalExpenses;

    return {
        revenue: { net_sales: netSales, net_sales_minor: netSales },
        cogs: { total_cogs: cogs, total_cogs_minor: cogs },
        gross_profit: grossProfit,
        gross_profit_minor: grossProfit,
        expenses: {
            payroll: payroll,
            payroll_minor: payroll,
            opex: opex,
            opex_minor: opex,
            total_expenses: totalExpenses,
            total_expenses_minor: totalExpenses
        },
        net_income: netIncome,
        net_income_minor: netIncome
    };
}

module.exports = { generateProfitAndLoss };
