const { getQuery, allQuery } = require('../../db/connection');

async function generateSalesSummary(scope) {
    let dateFilter = `date(created_at) >= ? AND date(created_at) <= ?`;
    let params = [scope.venueId, scope.startDate, scope.endDate];

    if (scope.shiftId) {
        // If locked to a shift, we use the shift's exact open/close bounds instead of pure date
        dateFilter = `created_at >= ? AND (created_at <= ? OR ? IS NULL)`;
        params = [scope.venueId, scope.shift.opened_at, scope.shift.closed_at, scope.shift.closed_at];
    }

    const orderStats = await getQuery(`
        SELECT 
            COALESCE(SUM(total_minor + discount_minor), 0) as gross_sales,
            COALESCE(SUM(discount_minor), 0) as total_discounts,
            COALESCE(SUM(total_minor), 0) as net_sales,
            COALESCE(SUM(tax_minor), 0) as tax_liability,
            COALESCE(SUM(service_minor), 0) as service_charge
        FROM v3_order_sessions
        WHERE branch_id IN (SELECT id FROM branches WHERE venue_id = ?)
        AND status IN ('PAID', 'CLOSED')
        AND ${dateFilter}
    `, params);

    // Tips from Payments
    const tipStats = await getQuery(`
        SELECT COALESCE(SUM(tip_minor), 0) as total_tips
        FROM v3_payments
        WHERE order_session_id IN (
            SELECT id FROM v3_order_sessions 
            WHERE branch_id IN (SELECT id FROM branches WHERE venue_id = ?) 
            AND status IN ('PAID', 'CLOSED') AND ${dateFilter}
        )
    `, params);

    return {
        scope_details: {
            venue_id: scope.venueId,
            start_date: scope.startDate,
            end_date: scope.endDate,
            shift_id: scope.shiftId || null,
            last_updated: scope.timestamp,
            request_id: scope.requestId
        },
        financials: {
            gross_sales_minor: orderStats.gross_sales,
            discounts_minor: orderStats.total_discounts,
            net_sales_minor: orderStats.net_sales,
            tax_liability_minor: orderStats.tax_liability,
            service_charge_minor: orderStats.service_charge,
            tips_minor: tipStats.total_tips
        }
    };
}

async function generateDepartmentBreakdown(scope) {
    let dateFilter = `date(os.created_at) >= ? AND date(os.created_at) <= ?`;
    let params = [scope.venueId, scope.startDate, scope.endDate];

    if (scope.shiftId) {
        dateFilter = `os.created_at >= ? AND (os.created_at <= ? OR ? IS NULL)`;
        params = [scope.venueId, scope.shift.opened_at, scope.shift.closed_at, scope.shift.closed_at];
    }

    // Join order lines with menu items to group by department
    const departments = await allQuery(`
        SELECT 
            mi.department,
            COALESCE(SUM(ol.total_minor), 0) as department_total
        FROM v3_order_lines ol
        JOIN v3_order_sessions os ON ol.order_session_id = os.id
        JOIN v3_menu_items mi ON ol.menu_item_id = mi.id
        WHERE os.branch_id IN (SELECT id FROM branches WHERE venue_id = ?)
        AND os.status IN ('PAID', 'CLOSED')
        AND ol.status != 'CANCELLED'
        AND ${dateFilter}
        GROUP BY mi.department
    `, params);

    const breakdown = {};
    let sumDepartments = 0;
    for (let row of departments) {
        breakdown[row.department] = row.department_total;
        sumDepartments += row.department_total;
    }

    const summary = await generateSalesSummary(scope);
    const targetRevenue = summary.financials.net_sales_minor - summary.financials.tax_liability_minor - summary.financials.service_charge_minor;

    if (sumDepartments > targetRevenue) {
        const err = new Error(`Invariant Violation: Department sum (${sumDepartments}) exceeds total target revenue (${targetRevenue})`);
        err.requestId = scope.requestId;
        throw err;
    }

    return {
        departments: breakdown,
        total_department_revenue: sumDepartments,
        reconciliation_target: targetRevenue,
        invariant_pass: sumDepartments <= targetRevenue
    };
}

module.exports = { generateSalesSummary, generateDepartmentBreakdown };
