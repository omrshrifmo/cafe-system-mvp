/**
 * Canonical Reservation Domain Service
 * Handles conflict detection, area/table allocation, party sizing, and complete lifecycle.
 */
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

const RESERVATION_STATES = [
  'PENDING',
  'CONFIRMED',
  'WAITLIST',
  'SEATED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
];

/**
 * Check for reservation conflicts on a specific table and time slot
 */
async function checkReservationConflict({ tableNumber, reservationDate, reservationTime, durationMinutes = 90, excludeId = null }) {
  if (!tableNumber) return { hasConflict: false };

  // Calculate reservation start and end times
  const startDateTime = `${reservationDate} ${reservationTime}:00`;
  
  let sql = `
    SELECT id, customer_name, table_number, reservation_date, reservation_time, duration_minutes, status
    FROM reservations
    WHERE table_number = ?
      AND reservation_date = ?
      AND status IN ('CONFIRMED', 'SEATED', 'PENDING')
  `;
  const params = [parseInt(tableNumber, 10), reservationDate];

  if (excludeId) {
    sql += ` AND id != ?`;
    params.push(excludeId);
  }

  const existingReservations = await allQuery(sql, params);

  // Convert time string "HH:MM" to minutes from midnight for exact overlap comparison
  function timeToMinutes(t) {
    const parts = String(t).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
  }

  const newStartMin = timeToMinutes(reservationTime);
  const newEndMin = newStartMin + parseInt(durationMinutes, 10);

  for (const existing of existingReservations) {
    const exStartMin = timeToMinutes(existing.reservation_time);
    const exEndMin = exStartMin + (existing.duration_minutes || 90);

    // Overlap condition: (newStart < exEnd) && (newEnd > exStart)
    if (newStartMin < exEndMin && newEndMin > exStartMin) {
      return {
        hasConflict: true,
        conflictingReservation: existing,
        message: `تعارض في الحجز: الطاولة رقم ${tableNumber} محجوزة بالفعل للعميل [${existing.customer_name}] من الساعة ${existing.reservation_time} لمدة ${existing.duration_minutes || 90} دقيقة.`
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Create a new reservation with conflict detection
 */
async function createReservation(resData) {
  const tableNum = resData.table_number ? parseInt(resData.table_number, 10) : null;
  const duration = parseInt(resData.duration_minutes, 10) || 90;
  const partySize = Math.max(1, parseInt(resData.party_size || resData.guest_count, 10) || 2);
  const resDate = resData.reservation_date || new Date().toISOString().slice(0, 10);
  const resTime = resData.reservation_time || '20:00';
  const timezone = resData.timezone || 'Africa/Cairo';
  const areaId = resData.area_id || 'INDOOR_1';

  // Perform conflict check if table is specified
  if (tableNum) {
    const conflict = await checkReservationConflict({
      tableNumber: tableNum,
      reservationDate: resDate,
      reservationTime: resTime,
      durationMinutes: duration
    });

    if (conflict.hasConflict) {
      const err = new Error(conflict.message);
      err.code = 'RESERVATION_CONFLICT';
      err.status = 409;
      throw err;
    }
  }

  const initialStatus = resData.status && RESERVATION_STATES.includes(resData.status) ? resData.status : 'CONFIRMED';
  const resId = resData.id || `RES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return runTransaction(async (tx) => {
    const cols = await tx.all(`PRAGMA table_info(reservations)`);
    const colNames = new Set(cols.map(c => c.name));

    const insertObj = {
      customer_name: resData.customer_name || 'عميل حجز',
      customer_phone: resData.customer_phone || '',
      guest_count: partySize,
      party_size: partySize,
      table_number: tableNum,
      reservation_date: resDate,
      reservation_time: resTime,
      reserved_at: `${resDate} ${resTime}:00`,
      duration_minutes: duration,
      timezone: timezone,
      area_id: areaId,
      status: initialStatus,
      deposit_minor: resData.deposit_minor || 0,
      notes: resData.notes || null
    };

    const validCols = Object.keys(insertObj).filter(k => colNames.has(k));
    const validVals = validCols.map(k => insertObj[k]);
    const placeholders = validCols.map(() => '?').join(', ');

    const result = await tx.run(
      `INSERT INTO reservations (${validCols.join(', ')}, created_at) VALUES (${placeholders}, datetime('now', 'localtime'))`,
      validVals
    );

    const createdId = result.lastID;

    // If reservation is for today within upcoming 60 mins, hold table
    if (tableNum && initialStatus === 'CONFIRMED') {
      await tx.run(
        `UPDATE tables SET status = 'HELD_FOR_RESERVATION' WHERE table_number = ? AND status = 'AVAILABLE'`,
        [tableNum]
      );
    }

    return {
      success: true,
      reservation_id: createdId,
      customer_name: resData.customer_name,
      table_number: tableNum,
      status: initialStatus
    };
  });
}

/**
 * Transition Reservation Lifecycle Status
 */
async function updateReservationStatus(reservationId, targetStatus, actorNotes = null) {
  if (!RESERVATION_STATES.includes(targetStatus)) {
    throw new Error(`حالة الحجز غير صالحة: ${targetStatus}`);
  }

  return runTransaction(async (tx) => {
    const res = await tx.get(`SELECT * FROM reservations WHERE id = ?`, [reservationId]);
    if (!res) throw new Error('الحجز غير موجود');

    let sql = `UPDATE reservations SET status = ?`;
    const params = [targetStatus];

    if (targetStatus === 'SEATED') {
      sql += `, seated_at = datetime('now', 'localtime')`;
      if (res.table_number) {
        await tx.run(
          `UPDATE tables SET status = 'OCCUPIED', seated_at = COALESCE(seated_at, datetime('now', 'localtime')) WHERE table_number = ?`,
          [res.table_number]
        );
      }
    } else if (targetStatus === 'COMPLETED') {
      sql += `, completed_at = datetime('now', 'localtime')`;
    } else if (targetStatus === 'CANCELLED') {
      sql += `, cancellation_reason = ?`;
      params.push(actorNotes || 'تم الإلغاء بواسطة العميل أو الإدارة');
      if (res.table_number) {
        await tx.run(
          `UPDATE tables SET status = 'AVAILABLE' WHERE table_number = ? AND status = 'HELD_FOR_RESERVATION'`,
          [res.table_number]
        );
      }
    } else if (targetStatus === 'NO_SHOW') {
      if (res.table_number) {
        await tx.run(
          `UPDATE tables SET status = 'AVAILABLE' WHERE table_number = ? AND status = 'HELD_FOR_RESERVATION'`,
          [res.table_number]
        );
      }
    }

    if (actorNotes && targetStatus !== 'CANCELLED') {
      sql += `, audit_notes = ?`;
      params.push(actorNotes);
    }

    sql += ` WHERE id = ?`;
    params.push(reservationId);

    await tx.run(sql, params);

    return { success: true, reservation_id: reservationId, status: targetStatus };
  });
}

/**
 * Get reservations list with stats
 */
async function getReservations({ date = null, status = null, limit = 50 } = {}) {
  let sql = `SELECT * FROM reservations WHERE 1=1`;
  const params = [];

  if (date) {
    sql += ` AND reservation_date = ?`;
    params.push(date);
  }

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY reservation_date ASC, reservation_time ASC LIMIT ?`;
  params.push(limit);

  const reservations = await allQuery(sql, params);

  const stats = {
    total: reservations.length,
    confirmed: reservations.filter(r => r.status === 'CONFIRMED').length,
    seated: reservations.filter(r => r.status === 'SEATED').length,
    no_show: reservations.filter(r => r.status === 'NO_SHOW').length,
    cancelled: reservations.filter(r => r.status === 'CANCELLED').length,
    waitlist: reservations.filter(r => r.status === 'WAITLIST').length,
    total_pax: reservations.reduce((sum, r) => sum + (r.guest_count || r.party_size || 0), 0)
  };

  return { reservations, stats };
}

module.exports = {
  RESERVATION_STATES,
  checkReservationConflict,
  createReservation,
  updateReservationStatus,
  getReservations
};
