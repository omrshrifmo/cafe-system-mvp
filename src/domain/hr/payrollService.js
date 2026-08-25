const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { bindAdjustmentsToPeriod, recordAdjustment } = require('./adjustmentService');

/**
 * Deterministic Payroll Calculation Engine.
 * Calculates payroll lines for a given period based on approved attendance,
 * effective-dated hourly rates, approved tip pools, and approved adjustments.
 */
async function calculatePayrollPeriod(venueId, periodStartDate, periodEndDate, periodType = 'MONTHLY') {
  return runTransaction(async (tx) => {
    // 1. Check if period already exists
    let period = await getQuery(
      `SELECT * FROM payroll_periods WHERE venue_id = ? AND start_date = ? AND end_date = ?`,
      [venueId, periodStartDate, periodEndDate]
    );

    if (period) {
      if (period.status === 'LOCKED' || period.status === 'PAID') {
        throw new Error(`لا يمكن إعادة احتساب مسير رواتب مقفل أو مدفوع (#${period.id} - ${period.status}).`);
      }
      // Clean previous calculated lines
      await tx.run(`DELETE FROM payroll_lines WHERE payroll_period_id = ?`, [period.id]);
    } else {
      const periodId = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      await tx.run(
        `INSERT INTO payroll_periods (id, venue_id, period_type, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, 'DRAFT')`,
        [periodId, venueId, periodType, periodStartDate, periodEndDate]
      );
      period = { id: periodId, venue_id: venueId, start_date: periodStartDate, end_date: periodEndDate, status: 'DRAFT' };
    }

    // 2. Fetch all staff members associated with this venue
    const users = await allQuery(`
      SELECT DISTINCT u.id, u.name, u.role_id as role, p.role as hr_role, p.employment_status
      FROM v3_users u
      LEFT JOIN hr_staff_profiles p ON u.id = p.user_id
      WHERE (u.venue_id = ? OR p.venue_id = ? OR p.venue_id IS NULL)
      AND (p.employment_status IS NULL OR p.employment_status != 'TERMINATED')
    `, [venueId, venueId]);

    let totalPeriodNetPay = 0;

    for (let u of users) {
      // 3. Bind open adjustments for this period
      await bindAdjustmentsToPeriod(tx, u.id, periodStartDate, periodEndDate, period.id);

      // 4. Aggregate Approved Attendance in Period
      const attendanceSessions = await allQuery(`
        SELECT id, clock_in, clock_out, approved_productive_minutes
        FROM hr_attendance
        WHERE user_id = ? AND status = 'APPROVED'
        AND date(clock_in) >= ? AND date(clock_in) <= ?
      `, [u.id, periodStartDate, periodEndDate]);

      const totalMins = attendanceSessions.reduce((acc, s) => acc + (s.approved_productive_minutes || 0), 0);
      const totalHours = Number((totalMins / 60).toFixed(2));

      // 5. Effective-Dated Rate Calculation
      const rateRow = await getQuery(`
        SELECT hourly_rate_minor, overtime_multiplier, effective_from 
        FROM hr_rate_history 
        WHERE user_id = ? AND effective_from <= ? 
        ORDER BY effective_from DESC LIMIT 1
      `, [u.id, periodEndDate]);

      const hourlyRateMinor = rateRow ? rateRow.hourly_rate_minor : 0;
      const overtimeMultiplier = rateRow ? rateRow.overtime_multiplier : 1.5;

      let regularHours = totalHours;
      let overtimeHours = 0;

      // Standard policy: Overtime calculated for hours > 40 per week or standard threshold (e.g. 176 hrs/month)
      const standardMonthlyThreshold = periodType === 'WEEKLY' ? 40 : 176;
      if (totalHours > standardMonthlyThreshold) {
        regularHours = standardMonthlyThreshold;
        overtimeHours = Number((totalHours - standardMonthlyThreshold).toFixed(2));
      }

      const basePayMinor = Math.round(regularHours * hourlyRateMinor);
      const overtimePayMinor = Math.round(overtimeHours * hourlyRateMinor * overtimeMultiplier);

      // 6. Tip Pool Distribution from Approved Tip Pools
      const tipPools = await allQuery(`
        SELECT allocation_json FROM tip_pools
        WHERE venue_id = ? AND status = 'APPROVED'
        AND pool_date >= ? AND pool_date <= ?
      `, [venueId, periodStartDate, periodEndDate]);

      let tipsMinor = 0;
      for (const tp of tipPools) {
        try {
          const allocations = JSON.parse(tp.allocation_json || '[]');
          const userAlloc = allocations.find(a => a.user_id === u.id);
          if (userAlloc) tipsMinor += (userAlloc.amount_minor || 0);
        } catch (e) {}
      }

      // 7. Adjustments Aggregation
      const adjustments = await allQuery(`
        SELECT type, COALESCE(SUM(amount_minor), 0) as total
        FROM hr_adjustments 
        WHERE payroll_period_id = ? AND user_id = ?
        GROUP BY type
      `, [period.id, u.id]);

      let bonusesMinor = 0;
      let rewardsMinor = 0;
      let competitionsMinor = 0;
      let penaltiesMinor = 0;
      let advancesMinor = 0;
      let deductionsMinor = 0;

      for (const adj of adjustments) {
        if (adj.type === 'BONUS') bonusesMinor = adj.total;
        else if (adj.type === 'REWARD') rewardsMinor = adj.total;
        else if (adj.type === 'COMPETITION') competitionsMinor = adj.total;
        else if (adj.type === 'PENALTY') penaltiesMinor = adj.total;
        else if (adj.type === 'ADVANCE') advancesMinor = adj.total;
        else if (adj.type === 'DEDUCTION') deductionsMinor = adj.total;
      }

      // 8. Net Pay & Negative Deficit Calculation
      const grossEarnings = basePayMinor + overtimePayMinor + tipsMinor + bonusesMinor + rewardsMinor + competitionsMinor;
      const totalDeductions = penaltiesMinor + advancesMinor + deductionsMinor;
      const rawNetPay = grossEarnings - totalDeductions;

      let netPayMinor = rawNetPay;
      let recoverableAdvanceMinor = 0;

      if (rawNetPay < 0) {
        // Capped at 0: No unexplained negative net pay
        recoverableAdvanceMinor = Math.abs(rawNetPay);
        netPayMinor = 0;
      }

      totalPeriodNetPay += netPayMinor;

      const trace = {
        employee_name: u.name,
        employee_role: u.hr_role || u.role,
        approved_attendance_sessions_count: attendanceSessions.length,
        total_hours: totalHours,
        regular_hours: regularHours,
        overtime_hours: overtimeHours,
        hourly_rate_minor: hourlyRateMinor,
        overtime_multiplier: overtimeMultiplier,
        base_pay_minor: basePayMinor,
        overtime_pay_minor: overtimePayMinor,
        tips_minor: tipsMinor,
        bonuses_minor: bonusesMinor,
        rewards_minor: rewardsMinor,
        competitions_minor: competitionsMinor,
        penalties_minor: penaltiesMinor,
        advances_minor: advancesMinor,
        deductions_minor: deductionsMinor,
        gross_earnings_minor: grossEarnings,
        total_deductions_minor: totalDeductions,
        raw_net_pay_minor: rawNetPay,
        net_pay_minor: netPayMinor,
        recoverable_advance_minor: recoverableAdvanceMinor,
        rate_warning: (totalHours > 0 && hourlyRateMinor === 0) ? 'ZERO_RATE_ATTENDANCE_WARNING' : null,
        calculated_at: new Date().toISOString()
      };

      const lineId = `PL-${period.id}-${u.id}`;
      await tx.run(`
        INSERT INTO payroll_lines (
          id, payroll_period_id, user_id, hours_worked, overtime_hours, hourly_rate_minor,
          base_pay_minor, overtime_pay_minor, tips_minor, bonuses_minor, rewards_minor, competitions_minor,
          penalties_minor, advances_minor, deductions_minor, net_pay_minor, recoverable_advance_minor,
          calculation_trace_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CALCULATED')
      `, [
        lineId, period.id, u.id, regularHours, overtimeHours, hourlyRateMinor,
        basePayMinor, overtimePayMinor, tipsMinor, bonusesMinor, rewardsMinor, competitionsMinor,
        penaltiesMinor, advancesMinor, deductionsMinor, netPayMinor, recoverableAdvanceMinor,
        JSON.stringify(trace)
      ]);
    }

    // Update period status to CALCULATED
    await tx.run(`
      UPDATE payroll_periods
      SET status = 'CALCULATED', calculated_at = datetime('now', 'localtime'), total_net_pay_minor = ?
      WHERE id = ?
    `, [totalPeriodNetPay, period.id]);

    return {
      status: 'SUCCESS',
      payroll_period_id: period.id,
      period_status: 'CALCULATED',
      total_employees: users.length,
      total_net_pay_minor: totalPeriodNetPay
    };
  });
}

/**
 * Transitions payroll from CALCULATED -> REVIEWED
 */
async function reviewPayrollPeriod(periodId, reviewerId) {
  return runTransaction(async (tx) => {
    const period = await getQuery(`SELECT * FROM payroll_periods WHERE id = ?`, [periodId]);
    if (!period) throw new Error('مسير الرواتب غير موجود.');
    if (period.status !== 'CALCULATED') {
      throw new Error(`لا يمكن مراجعة مسير الرواتب في حالته الحالية (${period.status}). يجب أن يكون محسوباً (CALCULATED).`);
    }

    await tx.run(`
      UPDATE payroll_periods
      SET status = 'REVIEWED', reviewed_by = ?, reviewed_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [reviewerId, periodId]);

    return { status: 'SUCCESS', payroll_period_id: periodId, period_status: 'REVIEWED' };
  });
}

/**
 * Transitions payroll from REVIEWED / CALCULATED -> APPROVED
 */
async function approvePayrollPeriod(periodId, approverId) {
  return runTransaction(async (tx) => {
    const period = await getQuery(`SELECT * FROM payroll_periods WHERE id = ?`, [periodId]);
    if (!period) throw new Error('مسير الرواتب غير موجود.');
    if (period.status !== 'REVIEWED' && period.status !== 'CALCULATED') {
      throw new Error(`لا يمكن اعتماد مسير الرواتب وهو بالحالة: ${period.status}.`);
    }

    await tx.run(`
      UPDATE payroll_periods
      SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [approverId, periodId]);

    await tx.run(`UPDATE payroll_lines SET status = 'APPROVED' WHERE payroll_period_id = ?`, [periodId]);

    return { status: 'SUCCESS', payroll_period_id: periodId, period_status: 'APPROVED' };
  });
}

/**
 * Transitions payroll from APPROVED -> LOCKED
 * Locks all bound records and rolls over any recoverable advances.
 */
async function lockPayrollPeriod(periodId, approverId) {
  return runTransaction(async (tx) => {
    const period = await getQuery(`SELECT * FROM payroll_periods WHERE id = ?`, [periodId]);
    if (!period) throw new Error('مسير الرواتب غير موجود.');
    if (period.status !== 'APPROVED') {
      throw new Error(`يجب اعتماد مسير الرواتب أولاً قبل إقفاله (Current status: ${period.status}).`);
    }

    await tx.run(`
      UPDATE payroll_periods
      SET status = 'LOCKED', locked_by = ?, locked_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [approverId, periodId]);

    // Handle recoverable advances rollover
    const deficitLines = await allQuery(`
      SELECT user_id, recoverable_advance_minor FROM payroll_lines
      WHERE payroll_period_id = ? AND recoverable_advance_minor > 0
    `, [periodId]);

    for (const dl of deficitLines) {
      // Create append-only advance adjustment for next period with trace
      const nextEffectiveDate = new Date(new Date(period.end_date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await tx.run(`
        INSERT INTO hr_adjustments (id, user_id, type, amount_minor, reason, effective_date, actor_id, approval_actor_id, audit_trace_json)
        VALUES (?, ?, 'ADVANCE', ?, ?, ?, ?, ?, ?)
      `, [
        `ADJ-ROLLOVER-${Date.now()}-${dl.user_id}`,
        dl.user_id,
        dl.recoverable_advance_minor,
        `ترحيل عجز سلفة غير مستردة من مسير الرواتب المقفل #${periodId}`,
        nextEffectiveDate,
        approverId,
        approverId,
        JSON.stringify({ source_period_id: periodId, deficit_amount_minor: dl.recoverable_advance_minor })
      ]);
    }

    return { status: 'SUCCESS', payroll_period_id: periodId, period_status: 'LOCKED', rollover_advances_created: deficitLines.length };
  });
}

/**
 * Transitions payroll from LOCKED -> PAID
 */
async function recordPayrollPayment(periodId, payerId, paymentMethod = 'CASH') {
  return runTransaction(async (tx) => {
    const period = await getQuery(`SELECT * FROM payroll_periods WHERE id = ?`, [periodId]);
    if (!period) throw new Error('مسير الرواتب غير موجود.');
    if (period.status !== 'LOCKED') {
      throw new Error(`لا يمكن صرف مسير الرواتب قبل إقفاله واعتماده رسمياً (Current status: ${period.status}).`);
    }

    await tx.run(`
      UPDATE payroll_periods
      SET status = 'PAID', paid_by = ?, paid_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [payerId, periodId]);

    await tx.run(`UPDATE payroll_lines SET status = 'PAID' WHERE payroll_period_id = ?`, [periodId]);

    return { status: 'SUCCESS', payroll_period_id: periodId, period_status: 'PAID' };
  });
}

/**
 * Returns period details and lines.
 */
async function getPayrollPeriodDetails(periodId) {
  const period = await getQuery(`
    SELECT pp.*, app.name as approved_by_name, rev.name as reviewed_by_name, loc.name as locked_by_name, pd.name as paid_by_name
    FROM payroll_periods pp
    LEFT JOIN v3_users app ON pp.approved_by = app.id
    LEFT JOIN v3_users rev ON pp.reviewed_by = rev.id
    LEFT JOIN v3_users loc ON pp.locked_by = loc.id
    LEFT JOIN v3_users pd ON pp.paid_by = pd.id
    WHERE pp.id = ?
  `, [periodId]);

  if (!period) return null;

  const lines = await allQuery(`
    SELECT pl.*, u.name as user_name, u.role_id as user_role, p.role as hr_role
    FROM payroll_lines pl
    JOIN v3_users u ON pl.user_id = u.id
    LEFT JOIN hr_staff_profiles p ON u.id = p.user_id
    WHERE pl.payroll_period_id = ?
    ORDER BY u.name ASC
  `, [periodId]);

  return {
    ...period,
    lines: lines.map(l => ({
      ...l,
      calculation_trace: JSON.parse(l.calculation_trace_json || '{}')
    }))
  };
}

async function getPayrollPeriods(venueId = 'V_DEFAULT') {
  return allQuery(`SELECT * FROM payroll_periods WHERE venue_id = ? ORDER BY start_date DESC LIMIT 50`, [venueId]);
}

/**
 * Exports itemized employee payslips.
 */
async function getPayslips(periodId) {
  const details = await getPayrollPeriodDetails(periodId);
  if (!details) throw new Error('مسير الرواتب غير موجود.');

  return {
    period_id: details.id,
    venue_id: details.venue_id,
    start_date: details.start_date,
    end_date: details.end_date,
    status: details.status,
    total_net_pay_minor: details.total_net_pay_minor,
    payslips: details.lines.map(line => ({
      payslip_id: `SLIP-${details.id}-${line.user_id}`,
      user_id: line.user_id,
      user_name: line.user_name,
      role: line.hr_role || line.user_role,
      hours_worked: line.hours_worked,
      overtime_hours: line.overtime_hours,
      hourly_rate_minor: line.hourly_rate_minor,
      earnings: {
        base_pay_minor: line.base_pay_minor,
        overtime_pay_minor: line.overtime_pay_minor,
        tips_minor: line.tips_minor,
        bonuses_minor: line.bonuses_minor,
        rewards_minor: line.rewards_minor,
        competitions_minor: line.competitions_minor,
        gross_earnings_minor: line.base_pay_minor + line.overtime_pay_minor + line.tips_minor + line.bonuses_minor + line.rewards_minor + line.competitions_minor
      },
      deductions: {
        penalties_minor: line.penalties_minor,
        advances_minor: line.advances_minor,
        deductions_minor: line.deductions_minor,
        total_deductions_minor: line.penalties_minor + line.advances_minor + line.deductions_minor
      },
      net_pay_minor: line.net_pay_minor,
      recoverable_advance_minor: line.recoverable_advance_minor,
      calculation_trace: line.calculation_trace
    }))
  };
}

module.exports = {
  calculatePayrollPeriod,
  reviewPayrollPeriod,
  approvePayrollPeriod,
  lockPayrollPeriod,
  recordPayrollPayment,
  getPayrollPeriodDetails,
  getPayrollPeriods,
  getPayslips
};
