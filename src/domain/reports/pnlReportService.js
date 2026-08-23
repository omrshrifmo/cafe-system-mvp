const { getQuery } = require('../../db/connection');
const { generateSalesSummary } = require('./salesReportService');

async function generateProfitAndLoss(scope) {
    const sales = await generateSalesSummary(scope);

    // Date filters for ledgers
    let dateFilter = `date(created_at) >= ? AND date(created_at) <= ?`;
    let params = [scope.venueId, scope.startDate, scope.endDate];

    if (scope.shiftId) {
        dateFilter = `created_at >= ? AND (created_at <= ? OR ? IS NULL)`;
        params = [scope.venueId, scope.shift.opened_at, scope.shift.closed_at, scope.shift.closed_at];
    }

    // 1. COGS (Inventory consumed via sales or waste)
    // Note: Cost must be retrieved at time of ledger entry in a full system. Assuming cost_per_unit here is static for MVP simplicity.
    const cogsQuery = await getQuery(`
        SELECT COALESCE(SUM(ABS(il.change_microunits) * (ii.cost_per_unit_minor * 1.0 / 1000000)), 0) as total_cogs
        FROM inventory_ledger il
        JOIN v3_inventory_items ii ON il.inventory_item_id = ii.id
        WHERE ii.venue_id = ? AND il.reference_type IN ('SALE', 'WASTE')
        AND ${dateFilter.replace(/created_at/g, 'il.created_at')}
    `, params);

    const cogs = Math.floor(cogsQuery.total_cogs);

    // 2. Payroll 
    // Payroll is bound to payroll_periods. We match periods that fall entirely within the scope, 
    // or we could prorate. For this implementation, we sum payroll lines where the period end date is within scope.
    let payrollDateFilter = `end_date >= ? AND end_date <= ?`;
    let payrollParams = [scope.venueId, scope.startDate, scope.endDate];
    if (scope.shiftId) {
        // Typically, payroll is not calculated per shift, but if required, we fall back to the shift date bounds
        payrollDateFilter = `end_date >= ? AND end_date <= ?`;
        payrollParams = [scope.venueId, scope.shift.business_date, scope.shift.business_date];
    }

    const payrollQuery = await getQuery(`
        SELECT COALESCE(SUM(pl.net_pay_minor + pl.tax_liability_minor_placeholder), 0) as total_payroll -- assuming net pay for now
        FROM payroll_lines pl
        JOIN payroll_periods pp ON pl.payroll_period_id = pp.id
        WHERE pp.venue_id = ? AND pp.status IN ('LOCKED', 'PAID')
        AND ${payrollDateFilter}
    `, payrollParams);

    const payroll = Math.floor(payrollQuery.total_payroll || 0); // Simplified

    // 3. Operating Expenses (from cash_operations)
    const opexQuery = await getQuery(`
        SELECT COALESCE(SUM(amount_minor), 0) as total_opex
        FROM cash_operations
        WHERE venue_id = ? AND type = 'EXPENSE'
        AND ${dateFilter}
    `, params);

    const opex = opexQuery.total_opex;

    const netSales = sales.financials.net_sales_minor;
    const grossProfit = netSales - cogs;
    const totalExpenses = payroll + opex;
    const netIncome = grossProfit - totalExpenses;

    return {
        revenue: { net_sales: netSales },
        cogs: { total_cogs: cogs },
        gross_profit: grossProfit,
        expenses: {
            payroll: payroll,
            opex: opex,
            total_expenses: totalExpenses
        },
        net_income: netIncome
    };
}

module.exports = { generateProfitAndLoss };
