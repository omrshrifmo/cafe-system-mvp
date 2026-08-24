const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function lockAccountingPeriod(venueId, periodDate, periodType = 'DAILY', actorId = null) {
  return runTransaction(async (tx) => {
    const existing = await tx.get(
      `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
      [venueId, periodDate, periodType]
    );

    if (existing && existing.status === 'LOCKED') {
      return { status: 'ALREADY_LOCKED', venue_id: venueId, period_date: periodDate, period_type: periodType };
    }

    if (existing) {
      await tx.run(
        `UPDATE accounting_periods 
         SET status = 'LOCKED', locked_by = ?, locked_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
         WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
        [actorId, venueId, periodDate, periodType]
      );
    } else {
      const periodId = `PER-${periodType}-${Date.now()}`;
      await tx.run(
        `INSERT INTO accounting_periods (id, venue_id, period_date, period_type, status, locked_by, locked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'LOCKED', ?, datetime('now', 'localtime'), datetime('now', 'localtime'), datetime('now', 'localtime'))`,
        [periodId, venueId, periodDate, periodType, actorId]
      );
    }

    return {
      status: 'SUCCESS',
      venue_id: venueId,
      period_date: periodDate,
      period_type: periodType,
      period_status: 'LOCKED'
    };
  });
}

async function isPeriodLocked(tx, venueId, periodDate, periodType = 'DAILY') {
  const row = await (tx ? tx.get(
    `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
    [venueId, periodDate, periodType]
  ) : getQuery(
    `SELECT status FROM accounting_periods WHERE venue_id = ? AND period_date = ? AND period_type = ?`,
    [venueId, periodDate, periodType]
  ));

  return !!(row && row.status === 'LOCKED');
}

module.exports = { lockAccountingPeriod, isPeriodLocked };
