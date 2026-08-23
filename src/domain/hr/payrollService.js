const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { bindAdjustmentsToPeriod } = require('./adjustmentService');

async function generateDraftPayroll(venueId, periodStartDate, periodEndDate) {
  return runTransaction(async (tx) => {
    // 1. Check if period already exists
    let period = await getQuery(`SELECT * FROM payroll_periods WHERE venue_id = ? AND start_date = ? AND end_date = ?`, [venueId, periodStartDate, periodEndDate]);
    
    if (period) {
      if (period.status === 'LOCKED' || period.status === 'PAID') {
        throw new Error('Cannot regenerate a locked or paid payroll period.');
      }
      // Delete old draft lines
      await tx.run(`DELETE FROM payroll_lines WHERE payroll_period_id = ?`, [period.id]);
    } else {
      const periodId = `PAY-${Date.now()}`;
      await tx.run(
        `INSERT INTO payroll_periods (id, venue_id, start_date, end_date, status) VALUES (?, ?, ?, ?, 'DRAFT')`,
        [periodId, venueId, periodStartDate, periodEndDate]
      );
      period = { id: periodId };
    }

    // 2. Fetch all active users for this venue
    const users = await allQuery(`SELECT id FROM v3_users WHERE venue_id = ?`, [venueId]);

    for (let u of users) {
      // 3. Bind open adjustments
      await bindAdjustmentsToPeriod(tx, u.id, periodStartDate, periodEndDate, period.id);

      // 4. Calculate total productive minutes (approved)
      const attendance = await allQuery(`
        SELECT SUM(approved_productive_minutes) as mins
        FROM hr_attendance
        WHERE user_id = ? AND status = 'APPROVED' 
        AND date(clock_in) >= ? AND date(clock_in) <= ?
      `, [u.id, periodStartDate, periodEndDate]);
      
      const totalMins = attendance[0].mins || 0;
      const totalHours = totalMins / 60;

      // Simplistic rate calculation: in a real system we'd iterate over effective dates.
      // Here we grab the most recent rate effective within the period
      const rateRow = await getQuery(`
        SELECT hourly_rate_minor, overtime_multiplier FROM hr_rate_history 
        WHERE user_id = ? AND effective_from <= ? 
        ORDER BY effective_from DESC LIMIT 1
      `, [u.id, periodEndDate]);

      let basePayMinor = 0;
      let overtimePayMinor = 0;

      if (rateRow) {
          const rate = rateRow.hourly_rate_minor;
          // Simple policy: > 40 hours is overtime (assuming this is a weekly period)
          if (totalHours > 40) {
              basePayMinor = Math.floor(40 * rate);
              overtimePayMinor = Math.floor((totalHours - 40) * rate * rateRow.overtime_multiplier);
          } else {
              basePayMinor = Math.floor(totalHours * rate);
          }
      }

      // 5. Aggregate Adjustments
      const adj = await allQuery(`
        SELECT type, SUM(amount_minor) as total
        FROM hr_adjustments WHERE payroll_period_id = ? AND user_id = ?
        GROUP BY type
      `, [period.id, u.id]);

      let bonuses = 0, penalties = 0, advances = 0, commissions = 0;
      for (let r of adj) {
          if (r.type === 'BONUS') bonuses = r.total;
          if (r.type === 'PENALTY') penalties = r.total;
          if (r.type === 'ADVANCE') advances = r.total;
          if (r.type === 'COMMISSION') commissions = r.total;
      }

      // 6. Net Pay Calculation
      let netPay = basePayMinor + overtimePayMinor + bonuses + commissions - penalties - advances;
      let recoverableAdvance = 0;

      if (netPay < 0) {
          // If a penalty or advance causes negative net pay, cap net pay at 0
          // The remaining negative balance becomes a recoverable advance for next period
          recoverableAdvance = Math.abs(netPay);
          netPay = 0;
      }

      const trace = {
          total_hours: totalHours,
          rate_used: rateRow ? rateRow.hourly_rate_minor : 0,
          overtime_multiplier: rateRow ? rateRow.overtime_multiplier : 0,
          bonuses, penalties, advances, commissions,
          recoverable_advance_generated: recoverableAdvance
      };

      await tx.run(`
        INSERT INTO payroll_lines (id, payroll_period_id, user_id, base_pay_minor, overtime_pay_minor, bonuses_minor, penalties_minor, deductions_minor, net_pay_minor, recoverable_advance_minor, calculation_trace_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
          `PL-${Date.now()}-${u.id}`, period.id, u.id, basePayMinor, overtimePayMinor, bonuses, penalties, advances, netPay, recoverableAdvance, JSON.stringify(trace)
      ]);
    }

    return { status: 'SUCCESS', payroll_period_id: period.id };
  });
}

async function lockPayrollPeriod(periodId, approverId) {
    return runTransaction(async (tx) => {
        const period = await getQuery(`SELECT status FROM payroll_periods WHERE id = ?`, [periodId]);
        if (!period) throw new Error('Payroll period not found');
        if (period.status === 'LOCKED' || period.status === 'PAID') throw new Error('Period is already locked or paid');

        await tx.run(`UPDATE payroll_periods SET status = 'LOCKED', locked_by = ?, locked_at = datetime('now', 'localtime') WHERE id = ?`, [approverId, periodId]);
        
        // Any negative recoverable advances generated here should ideally be inserted as ADVANCE adjustments into the NEXT period,
        // or handled externally.

        return { status: 'SUCCESS' };
    });
}

module.exports = { generateDraftPayroll, lockPayrollPeriod };
