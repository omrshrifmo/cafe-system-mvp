const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function lockAccountingPeriod(venueId, periodDate, periodType, actorId) {
  return runTransaction(async (tx) => {
    const existing = await getQuery(
      `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
      [venueId, periodDate, periodType]
    );

    if (existing && existing.status === 'LOCKED') {
      return { status: 'ALREADY_LOCKED' };
    }

    if (existing) {
      await tx.run(
        `UPDATE accounting_periods SET status = 'LOCKED', locked_by = ?, locked_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
         WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
        [actorId, venueId, periodDate, periodType]
      );
    } else {
      const periodId = `PER-${Date.now()}`;
      await tx.run(
        `INSERT INTO accounting_periods (id, venue_id, period_date, period_type, status, locked_by, locked_at)
         VALUES (?, ?, ?, ?, 'LOCKED', ?, datetime('now', 'localtime'))`,
        [periodId, venueId, periodDate, periodType, actorId]
      );
    }

    return { status: 'SUCCESS' };
  });
}

async function isPeriodLocked(tx, venueId, periodDate, periodType) {
  const row = await getQuery(
    tx ? `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?` 
       : `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
    [venueId, periodDate, periodType],
    tx
  );
  return row && row.status === 'LOCKED';
}

module.exports = { lockAccountingPeriod, isPeriodLocked };
