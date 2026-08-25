const { 
  buildReportScope, 
  calculateSalesSummary, 
  calculateDepartmentBreakdown 
} = require('./reportDefinitionService');

async function generateSalesSummary(scopeParams) {
    const scope = scopeParams.date_range ? scopeParams : await buildReportScope({
        venueId: scopeParams.venueId,
        startDate: scopeParams.startDate,
        endDate: scopeParams.endDate,
        shiftId: scopeParams.shiftId,
        timezone: scopeParams.timezone,
        requestId: scopeParams.requestId
    });

    const sales = await calculateSalesSummary(scope);

    return {
        scope_details: {
            venue_id: scope.venue_id,
            start_date: scope.date_range.start_date,
            end_date: scope.date_range.end_date,
            shift_id: scope.shift_id || null,
            last_updated: scope.last_updated,
            request_id: scope.request_id
        },
        financials: {
            gross_sales_minor: sales.gross_sales_minor,
            discounts_minor: sales.discounts_minor,
            net_sales_minor: sales.net_sales_minor,
            tax_liability_minor: sales.vat_tax_liability_minor,
            service_charge_minor: sales.service_charge_minor,
            tips_minor: sales.tips_minor
        }
    };
}

async function generateDepartmentBreakdown(scopeParams) {
    const scope = scopeParams.date_range ? scopeParams : await buildReportScope({
        venueId: scopeParams.venueId,
        startDate: scopeParams.startDate,
        endDate: scopeParams.endDate,
        shiftId: scopeParams.shiftId,
        timezone: scopeParams.timezone,
        requestId: scopeParams.requestId
    });

    const sales = await calculateSalesSummary(scope);
    const result = await calculateDepartmentBreakdown(scope, sales);

    const breakdown = {};
    for (const [dept, data] of Object.entries(result.departments)) {
        breakdown[dept] = data.revenue_minor;
    }

    return {
        departments: breakdown,
        total_department_revenue: result.total_department_revenue_minor,
        reconciliation_target: result.reconciliation_target_minor,
        invariant_pass: result.invariant_pass
    };
}

module.exports = { generateSalesSummary, generateDepartmentBreakdown };
