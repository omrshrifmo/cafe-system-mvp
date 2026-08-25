const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

/**
 * Validates and records clock-in for staff.
 * Rejects overlapping sessions, suspended users, and impossible future timestamps.
 */
async function clockIn(userId, venueId = 'V_DEFAULT', shiftId = null, clockInTime = new Date().toISOString(), notes = null) {
  return runTransaction(async (tx) => {
    // 1. Validate future dates
    const clockInDate = new Date(clockInTime);
    if (isNaN(clockInDate.getTime())) {
      throw new Error('تاريخ تسجيل الحضور غير صالح (Invalid clock_in time).');
    }
    const maxAllowedTime = Date.now() + 60 * 1000; // 1 min clock skew allowance
    if (clockInDate.getTime() > maxAllowedTime) {
      throw new Error('لا يمكن تسجيل الحضور في تاريخ أو وقت مستقبلي (Cannot clock in with a future timestamp).');
    }

    // 2. Check if user is currently clocked in anywhere
    const activeSession = await getQuery(
      `SELECT * FROM hr_attendance WHERE user_id = ? AND clock_out IS NULL`,
      [userId]
    );

    if (activeSession) {
      throw new Error(`الموظف مسجل حضور بالفعل ومستمر بالعمل (Session ID: ${activeSession.id}). يجب تسجيل الانصراف أولاً.`);
    }

    // 3. Check employment status
    const profile = await getQuery(`SELECT employment_status FROM hr_staff_profiles WHERE user_id = ?`, [userId]);
    if (profile && profile.employment_status !== 'ACTIVE') {
      throw new Error(`لا يمكن تسجيل الحضور لموظف حالته: ${profile.employment_status}`);
    }

    const attendanceId = `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await tx.run(
      `INSERT INTO hr_attendance (id, user_id, venue_id, shift_id, clock_in, status, notes)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [attendanceId, userId, venueId, shiftId, clockInTime, notes]
    );

    return { status: 'SUCCESS', attendance_id: attendanceId };
  });
}

/**
 * Records clock-out, calculating break deductions and total raw duration.
 */
async function clockOut(userId, attendanceId, clockOutTime = new Date().toISOString(), breakMinutes = 0) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ?`, [attendanceId]);
    if (!session) throw new Error('سجل الحضور غير موجود (Attendance session not found).');
    if (userId && session.user_id !== userId) throw new Error('سجل الحضور لا يخص هذا الموظف.');
    if (session.clock_out !== null) throw new Error('تم تسجيل الانصراف لهذه الوردية بالفعل.');

    const inTime = new Date(session.clock_in).getTime();
    const outTime = new Date(clockOutTime).getTime();

    if (isNaN(outTime) || outTime < inTime) {
      throw new Error('وقت الانصراف لا يمكن أن يكون أقدم من وقت الحضور.');
    }

    const totalDurationMinutes = Math.floor((outTime - inTime) / (60 * 1000));
    if (breakMinutes < 0 || breakMinutes > totalDurationMinutes) {
      throw new Error('دقائق الاستراحة غير منطقية وتتجاوز إجمالي مدة الوردية.');
    }

    await tx.run(
      `UPDATE hr_attendance SET clock_out = ?, break_minutes = ? WHERE id = ?`,
      [clockOutTime, breakMinutes, attendanceId]
    );

    return { status: 'SUCCESS', attendance_id: attendanceId, total_minutes: totalDurationMinutes - breakMinutes };
  });
}

/**
 * Manager approval for productive hours.
 */
async function approveAttendance(attendanceId, managerId, productiveMinutes = null, notes = null) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ?`, [attendanceId]);
    if (!session) throw new Error('سجل الحضور غير موجود.');
    if (session.clock_out === null) throw new Error('لا يمكن اعتماد وردية حضور لم يتم تسجيل الانصراف منها.');

    let mins = productiveMinutes;
    if (mins === null || mins === undefined) {
      const inTime = new Date(session.clock_in).getTime();
      const outTime = new Date(session.clock_out).getTime();
      const rawMins = Math.max(0, Math.floor((outTime - inTime) / (60 * 1000)) - (session.break_minutes || 0));
      mins = rawMins;
    }

    if (mins < 0) throw new Error('الدقائق الإنتاجية المعتمدة لا يمكن أن تكون سالبة.');

    await tx.run(
      `UPDATE hr_attendance 
       SET status = 'APPROVED', approved_productive_minutes = ?, approved_by = ?, approved_at = datetime('now', 'localtime'), notes = COALESCE(?, notes) 
       WHERE id = ?`,
      [mins, managerId, notes, attendanceId]
    );

    return { status: 'SUCCESS', attendance_id: attendanceId, approved_productive_minutes: mins };
  });
}

async function rejectAttendance(attendanceId, managerId, reason = 'REJECTED_BY_MANAGER') {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ?`, [attendanceId]);
    if (!session) throw new Error('سجل الحضور غير موجود.');

    await tx.run(
      `UPDATE hr_attendance 
       SET status = 'REJECTED', approved_productive_minutes = 0, approved_by = ?, approved_at = datetime('now', 'localtime'), notes = ? 
       WHERE id = ?`,
      [managerId, reason, attendanceId]
    );

    return { status: 'SUCCESS', attendance_id: attendanceId };
  });
}

async function getAttendanceList(filter = {}) {
  let query = `
    SELECT a.*, u.name as user_name, u.role as user_role, m.name as approved_by_name
    FROM hr_attendance a
    JOIN v3_users u ON a.user_id = u.id
    LEFT JOIN v3_users m ON a.approved_by = m.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.venueId) {
    query += ` AND a.venue_id = ?`;
    params.push(filter.venueId);
  }
  if (filter.userId) {
    query += ` AND a.user_id = ?`;
    params.push(filter.userId);
  }
  if (filter.status) {
    query += ` AND a.status = ?`;
    params.push(filter.status);
  }
  if (filter.startDate) {
    query += ` AND date(a.clock_in) >= ?`;
    params.push(filter.startDate);
  }
  if (filter.endDate) {
    query += ` AND date(a.clock_in) <= ?`;
    params.push(filter.endDate);
  }

  query += ` ORDER BY a.clock_in DESC LIMIT 200`;
  return allQuery(query, params);
}

module.exports = {
  clockIn,
  clockOut,
  approveAttendance,
  rejectAttendance,
  getAttendanceList
};
