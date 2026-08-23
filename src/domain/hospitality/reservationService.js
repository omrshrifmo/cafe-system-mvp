const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function createReservation(resData) {
  return runTransaction(async (tx) => {
    // Basic conflict detection (simplified for SQLite)
    // In production, we'd use datetime logic on timezone boundaries.
    const endTime = new Date(new Date(resData.reservation_time).getTime() + resData.duration_minutes * 60000).toISOString();
    
    if (resData.table_id) {
      const conflicts = await allQuery(
        `SELECT id FROM reservations 
         WHERE table_id = ? 
         AND status IN ('PENDING', 'CONFIRMED', 'SEATED')
         AND datetime(reservation_time) < datetime(?) 
         AND datetime(reservation_time, '+' || duration_minutes || ' minutes') > datetime(?)`,
        [resData.table_id, endTime, resData.reservation_time]
      );
      
      if (conflicts && conflicts.length > 0) {
        throw new Error('Table is already reserved for this time slot');
      }
    }

    const res = await tx.run(
      `INSERT INTO reservations (id, venue_id, customer_id, table_id, party_size, reservation_time, duration_minutes, status, deposit_minor, reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        resData.id,
        resData.venue_id,
        resData.customer_id,
        resData.table_id || null,
        resData.party_size,
        resData.reservation_time,
        resData.duration_minutes || 90,
        resData.deposit_minor || 0,
        resData.reference || null
      ]
    );
    return res;
  });
}

module.exports = {
  createReservation
};
