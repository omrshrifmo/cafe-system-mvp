const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function clockIn(userId, venueId, shiftId, clockInTime = new Date().toISOString()) {
  return runTransaction(async (tx) => {
    // Check if user is already clocked in anywhere (clock_out IS NULL)
    const activeSession = await getQuery(
      `SELECT * FROM hr_attendance WHERE user_id = ? AND clock_out IS NULL`,
      [userId]
    );

    if (activeSession) {
      if (activeSession.venue_id !== venueId) {
        throw new Error(`Cannot clock in at venue ${venueId}. User is currently clocked in at venue ${activeSession.venue_id}.`);
      }
      throw new Error(`User is already clocked in.`);
    }

    // Check if employment is ACTIVE
    const profile = await getQuery(`SELECT employment_status FROM hr_staff_profiles WHERE user_id = ?`, [userId]);
    if (profile && profile.employment_status !== 'ACTIVE') {
      throw new Error(`Cannot clock in. Employment status is ${profile.employment_status}.`);
    }

    const attendanceId = `ATT-${Date.now()}`;
    await tx.run(
      `INSERT INTO hr_attendance (id, user_id, venue_id, shift_id, clock_in)
       VALUES (?, ?, ?, ?, ?)`,
      [attendanceId, userId, venueId, shiftId, clockInTime]
    );

    return { status: 'SUCCESS', attendance_id: attendanceId };
  });
}

async function clockOut(userId, attendanceId, clockOutTime = new Date().toISOString(), breakMinutes = 0) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ? AND user_id = ?`, [attendanceId, userId]);
    if (!session) throw new Error('Attendance session not found.');
    if (session.clock_out !== null) throw new Error('Already clocked out.');

    await tx.run(
      `UPDATE hr_attendance SET clock_out = ?, break_minutes = ? WHERE id = ?`,
      [clockOutTime, breakMinutes, attendanceId]
    );

    return { status: 'SUCCESS' };
  });
}

async function approveAttendance(attendanceId, managerId, productiveMinutes) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT * FROM hr_attendance WHERE id = ?`, [attendanceId]);
    if (!session) throw new Error('Attendance session not found.');
    if (session.clock_out === null) throw new Error('Cannot approve an open attendance session.');

    await tx.run(
      `UPDATE hr_attendance SET status = 'APPROVED', approved_productive_minutes = ?, approved_by = ? WHERE id = ?`,
      [productiveMinutes, managerId, attendanceId]
    );

    return { status: 'SUCCESS' };
  });
}

module.exports = { clockIn, clockOut, approveAttendance };
