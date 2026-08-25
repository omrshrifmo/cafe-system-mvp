const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

// ==========================================
// 1. Staff Profiles & Effective Rates
// ==========================================

async function upsertStaffProfile(userId, { role = 'WAITER', venueId = 'V_DEFAULT', employmentStatus = 'ACTIVE', hireDate = null } = {}) {
  return runTransaction(async (tx) => {
    const user = await getQuery(`SELECT id FROM v3_users WHERE id = ?`, [userId]);
    if (!user) throw new Error('المستخدم غير موجود بالنظام (User not found).');

    const existing = await getQuery(`SELECT * FROM hr_staff_profiles WHERE user_id = ?`, [userId]);
    if (existing) {
      await tx.run(
        `UPDATE hr_staff_profiles SET role = ?, venue_id = ?, employment_status = ?, hire_date = COALESCE(?, hire_date) WHERE user_id = ?`,
        [role, venueId, employmentStatus, hireDate, userId]
      );
    } else {
      await tx.run(
        `INSERT INTO hr_staff_profiles (user_id, venue_id, role, employment_status, hire_date) VALUES (?, ?, ?, ?, COALESCE(?, date('now', 'localtime')))`,
        [userId, venueId, role, employmentStatus, hireDate]
      );
    }
    return { status: 'SUCCESS', user_id: userId };
  });
}

async function recordEffectiveRate(userId, hourlyRateMinor, overtimeMultiplier = 1.5, effectiveFrom = null, effectiveTo = null) {
  return runTransaction(async (tx) => {
    if (hourlyRateMinor < 0) throw new Error('الأجر الساعاتي لا يمكن أن يكون سالباً.');
    if (overtimeMultiplier < 1.0) throw new Error('معامل الوقت الإضافي يجب أن يكون 1.0 أو أكثر.');

    const fromDate = effectiveFrom || new Date().toISOString().split('T')[0];
    const rateId = `RATE-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Close any previous open-ended rate
    await tx.run(
      `UPDATE hr_rate_history SET effective_to = ? WHERE user_id = ? AND effective_to IS NULL AND effective_from < ?`,
      [fromDate, userId, fromDate]
    );

    await tx.run(
      `INSERT INTO hr_rate_history (id, user_id, hourly_rate_minor, overtime_multiplier, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rateId, userId, hourlyRateMinor, overtimeMultiplier, fromDate, effectiveTo]
    );

    return { status: 'SUCCESS', rate_id: rateId };
  });
}

async function getStaffRoster(venueId = 'V_DEFAULT') {
  const staff = await allQuery(`
    SELECT u.id, u.name, u.role_id as system_role, u.is_active,
           COALESCE(p.role, u.role_id) as hr_role,
           COALESCE(p.employment_status, CASE WHEN u.is_active = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END) as employment_status,
           COALESCE(p.venue_id, u.venue_id, 'V_DEFAULT') as venue_id,
           p.hire_date,
           (SELECT hourly_rate_minor FROM hr_rate_history WHERE user_id = u.id AND (effective_to IS NULL OR effective_to >= date('now', 'localtime')) ORDER BY effective_from DESC LIMIT 1) as active_hourly_rate_minor,
           (SELECT overtime_multiplier FROM hr_rate_history WHERE user_id = u.id AND (effective_to IS NULL OR effective_to >= date('now', 'localtime')) ORDER BY effective_from DESC LIMIT 1) as active_overtime_multiplier
    FROM v3_users u
    LEFT JOIN hr_staff_profiles p ON u.id = p.user_id
    WHERE u.venue_id = ? OR p.venue_id = ?
    ORDER BY u.name ASC
  `, [venueId, venueId]);
  return staff;
}

// ==========================================
// 2. Adjustments (Penalties, Bonuses, etc.)
// ==========================================

const VALID_ADJUSTMENT_TYPES = ['BONUS', 'PENALTY', 'ADVANCE', 'REWARD', 'COMPETITION', 'DEDUCTION'];

async function recordAdjustment(userId, type, amountMinor, reason, effectiveDate, actorId, approvalActorId = null, metadata = {}) {
  return runTransaction(async (tx) => {
    if (!VALID_ADJUSTMENT_TYPES.includes(type)) {
      throw new Error(`نوع التعديل غير معتمد: ${type}. الأنواع المعتمدة: ${VALID_ADJUSTMENT_TYPES.join(', ')}`);
    }
    if (!amountMinor || amountMinor <= 0) {
      throw new Error('مبلغ التعديل يجب أن يكون أكبر من الصفر.');
    }
    if (!reason || reason.trim() === '') {
      throw new Error('سبب الخصم / المكافأة إلزامي للتوثيق والرقابة.');
    }
    if (!effectiveDate) {
      throw new Error('تاريخ سريان التعديل إلزامي.');
    }

    // Check if effective date falls into a locked or paid payroll period
    const lockedPeriod = await getQuery(`
      SELECT pp.id, pp.status FROM payroll_periods pp
      WHERE pp.start_date <= ? AND pp.end_date >= ? AND pp.status IN ('LOCKED', 'PAID')
      AND pp.venue_id = (SELECT COALESCE(venue_id, 'V_DEFAULT') FROM v3_users WHERE id = ?)
    `, [effectiveDate, effectiveDate, userId]);

    if (lockedPeriod) {
      throw new Error(`تاريخ السريان (${effectiveDate}) يقع ضمن مسير رواتب مقفل أو مدفوع (#${lockedPeriod.id}). يجب تسجيل هذا القيد كاستحقاق ترحيلي في مسير الرواتب المفتوح الحالي.`);
    }

    const adjustmentId = `ADJ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const auditTrace = JSON.stringify({
      created_by: actorId,
      approved_by: approvalActorId || actorId,
      created_at: new Date().toISOString(),
      metadata
    });

    await tx.run(
      `INSERT INTO hr_adjustments (id, user_id, type, amount_minor, reason, effective_date, actor_id, approval_actor_id, audit_trace_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adjustmentId, userId, type, amountMinor, reason.trim(), effectiveDate, actorId, approvalActorId || actorId, auditTrace]
    );

    return { status: 'SUCCESS', adjustment_id: adjustmentId };
  });
}

async function getAdjustments(filter = {}) {
  let query = `
    SELECT a.*, u.name as user_name, u.role as user_role, act.name as actor_name, app.name as approval_actor_name
    FROM hr_adjustments a
    JOIN v3_users u ON a.user_id = u.id
    LEFT JOIN v3_users act ON a.actor_id = act.id
    LEFT JOIN v3_users app ON a.approval_actor_id = app.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.userId) {
    query += ` AND a.user_id = ?`;
    params.push(filter.userId);
  }
  if (filter.type) {
    query += ` AND a.type = ?`;
    params.push(filter.type);
  }
  if (filter.payrollPeriodId) {
    query += ` AND a.payroll_period_id = ?`;
    params.push(filter.payrollPeriodId);
  }
  if (filter.startDate) {
    query += ` AND a.effective_date >= ?`;
    params.push(filter.startDate);
  }
  if (filter.endDate) {
    query += ` AND a.effective_date <= ?`;
    params.push(filter.endDate);
  }

  query += ` ORDER BY a.effective_date DESC, a.created_at DESC LIMIT 200`;
  return allQuery(query, params);
}

// Internal function to bind adjustments to a period during calculation
async function bindAdjustmentsToPeriod(tx, userId, periodStartDate, periodEndDate, periodId) {
  await tx.run(`
    UPDATE hr_adjustments 
    SET payroll_period_id = ?
    WHERE user_id = ? AND effective_date >= ? AND effective_date <= ? AND (payroll_period_id IS NULL OR payroll_period_id = ?)
  `, [periodId, userId, periodStartDate, periodEndDate, periodId]);
}

// ==========================================
// 3. Tip Pools Management & Distribution
// ==========================================

async function createTipPool({ venueId = 'V_DEFAULT', shiftId = null, poolDate = null, source = 'CASH_TIPS', totalAmountMinor = 0, allocationMethod = 'HOURS_WORKED', eligibleUserIds = [] }) {
  return runTransaction(async (tx) => {
    if (totalAmountMinor < 0) throw new Error('مبلغ البقشيش لا يمكن أن يكون سالباً.');

    const dateStr = poolDate || new Date().toISOString().split('T')[0];
    const poolId = `TIP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Calculate allocation
    let allocations = [];
    if (totalAmountMinor > 0 && eligibleUserIds && eligibleUserIds.length > 0) {
      if (allocationMethod === 'EQUAL') {
        const perUser = Math.floor(totalAmountMinor / eligibleUserIds.length);
        let remainder = totalAmountMinor - (perUser * eligibleUserIds.length);
        allocations = eligibleUserIds.map((uid, idx) => ({
          user_id: uid,
          amount_minor: perUser + (idx < remainder ? 1 : 0),
          method: 'EQUAL'
        }));
      } else {
        // HOURS_WORKED based on approved attendance for that date/shift
        const attendanceRows = await allQuery(`
          SELECT user_id, COALESCE(SUM(approved_productive_minutes), 0) as mins
          FROM hr_attendance
          WHERE venue_id = ? AND date(clock_in) = ? AND status = 'APPROVED' AND user_id IN (${eligibleUserIds.map(() => '?').join(',')})
          GROUP BY user_id
        `, [venueId, dateStr, ...eligibleUserIds]);

        const totalMins = attendanceRows.reduce((sum, r) => sum + (r.mins || 0), 0);
        if (totalMins > 0) {
          let allocatedSum = 0;
          allocations = attendanceRows.map((r) => {
            const share = Math.floor((r.mins / totalMins) * totalAmountMinor);
            allocatedSum += share;
            return {
              user_id: r.user_id,
              worked_minutes: r.mins,
              amount_minor: share,
              method: 'HOURS_WORKED'
            };
          });
          // Distribute minor round-off remainder to the top worked user
          const remainder = totalAmountMinor - allocatedSum;
          if (remainder > 0 && allocations.length > 0) {
            allocations[0].amount_minor += remainder;
          }
        } else {
          // Fallback to equal split if no recorded minutes
          const perUser = Math.floor(totalAmountMinor / eligibleUserIds.length);
          let remainder = totalAmountMinor - (perUser * eligibleUserIds.length);
          allocations = eligibleUserIds.map((uid, idx) => ({
            user_id: uid,
            amount_minor: perUser + (idx < remainder ? 1 : 0),
            method: 'EQUAL_FALLBACK'
          }));
        }
      }
    }

    await tx.run(
      `INSERT INTO tip_pools (id, venue_id, shift_id, pool_date, source, total_amount_minor, allocation_method, status, allocation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CALCULATED', ?)`,
      [poolId, venueId, shiftId, dateStr, source, totalAmountMinor, allocationMethod, JSON.stringify(allocations)]
    );

    return { status: 'SUCCESS', tip_pool_id: poolId, total_amount_minor: totalAmountMinor, allocations };
  });
}

async function approveTipPool(poolId, managerId) {
  return runTransaction(async (tx) => {
    const pool = await getQuery(`SELECT * FROM tip_pools WHERE id = ?`, [poolId]);
    if (!pool) throw new Error('صندوق البقشيش غير موجود.');

    await tx.run(
      `UPDATE tip_pools SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now', 'localtime') WHERE id = ?`,
      [managerId, poolId]
    );

    return { status: 'SUCCESS', tip_pool_id: poolId };
  });
}

async function getTipPools(venueId = 'V_DEFAULT') {
  return allQuery(`SELECT * FROM tip_pools WHERE venue_id = ? ORDER BY pool_date DESC, created_at DESC LIMIT 100`, [venueId]);
}

module.exports = {
  upsertStaffProfile,
  recordEffectiveRate,
  getStaffRoster,
  recordAdjustment,
  getAdjustments,
  bindAdjustmentsToPeriod,
  createTipPool,
  approveTipPool,
  getTipPools
};
