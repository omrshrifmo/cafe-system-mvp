const { getQuery, allQuery } = require('../../db/connection');

/**
 * Calculates staff performance metrics completely isolated from compensation calculations.
 * Relies on operational immutable events (Order lines served, voids, etc.)
 */
async function calculateStaffMetrics(userId, venueId, periodStartDate, periodEndDate) {
    // 1. Attendance stats
    const attendance = await getQuery(`
        SELECT COUNT(*) as shifts_worked, SUM(approved_productive_minutes) as total_productive_mins
        FROM hr_attendance
        WHERE user_id = ? AND venue_id = ? AND status = 'APPROVED'
        AND date(clock_in) >= ? AND date(clock_in) <= ?
    `, [userId, venueId, periodStartDate, periodEndDate]);

    // 2. Orders handled (Assuming the user created the order sessions)
    const orderStats = await getQuery(`
        SELECT COUNT(id) as total_orders, COALESCE(SUM(total_minor), 0) as total_sales_minor
        FROM v3_order_sessions
        WHERE created_by = ? AND branch_id IN (SELECT id FROM branches WHERE venue_id = ?)
        AND date(created_at) >= ? AND date(created_at) <= ?
        AND status IN ('PAID', 'CLOSED')
    `, [userId, venueId, periodStartDate, periodEndDate]);

    // 3. Voids / Mistakes
    // In a real system, we look at audit_logs or reversals tied to this user
    const errorStats = await getQuery(`
        SELECT COUNT(id) as void_count
        FROM audit_logs
        WHERE actor_id = ? AND action = 'VOID_ORDER_LINE' AND venue_id = ?
        AND date(created_at) >= ? AND date(created_at) <= ?
    `, [userId, venueId, periodStartDate, periodEndDate]);

    return {
        user_id: userId,
        period: { start: periodStartDate, end: periodEndDate },
        shifts_worked: attendance ? attendance.shifts_worked : 0,
        productive_hours: attendance && attendance.total_productive_mins ? (attendance.total_productive_mins / 60).toFixed(2) : 0,
        orders_handled: orderStats ? orderStats.total_orders : 0,
        total_sales_minor: orderStats ? orderStats.total_sales_minor : 0,
        voids_and_errors: errorStats ? errorStats.void_count : 0,
        caveat: "Metrics derived from raw system logs. Does not account for missing KDS allocations or manual assistance."
    };
}

module.exports = { calculateStaffMetrics };
