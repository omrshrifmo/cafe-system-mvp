const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const { getLedgerBalance, appendLedgerEvent } = require('./ledgerService');

async function createStocktakeSession(venueId, creatorId) {
  return runTransaction(async (tx) => {
    const sessionId = `STK-${Date.now()}`;
    await tx.run(
      `INSERT INTO stocktake_sessions (id, venue_id, status, created_by) VALUES (?, ?, 'FROZEN', ?)`,
      [sessionId, venueId, creatorId]
    );

    // Freeze stock (e.g. capture expected balances)
    const items = await allQuery(`SELECT id FROM inventory_items`);
    for (const item of items) {
      const expected = await getLedgerBalance(item.id);
      await tx.run(
        `INSERT INTO stocktake_lines (id, stocktake_session_id, inventory_item_id, expected_microunits) VALUES (?, ?, ?, ?)`,
        [`STL-${Date.now()}-${item.id}`, sessionId, item.id, expected]
      );
    }
    
    // Transition to counting
    await tx.run(`UPDATE stocktake_sessions SET status = 'COUNTING' WHERE id = ?`, [sessionId]);

    return sessionId;
  });
}

async function recordCount(sessionId, lineId, countedMicrounits, counterId, reason = null) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT status FROM stocktake_sessions WHERE id = ?`, [sessionId]);
    if (!session || session.status !== 'COUNTING') throw new Error('Cannot count outside of COUNTING state');

    const line = await getQuery(`SELECT expected_microunits FROM stocktake_lines WHERE id = ? AND stocktake_session_id = ?`, [lineId, sessionId]);
    if (!line) throw new Error('Line not found in stocktake session');

    const variance = countedMicrounits - line.expected_microunits;

    await tx.run(
      `UPDATE stocktake_lines SET counted_microunits = ?, variance_microunits = ?, reason = ?, counter_id = ?, counted_at = datetime('now', 'localtime') WHERE id = ?`,
      [countedMicrounits, variance, reason, counterId, lineId]
    );
  });
}

async function reviewStocktake(sessionId, reviewerId) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT status FROM stocktake_sessions WHERE id = ?`, [sessionId]);
    if (!session || session.status !== 'COUNTING') throw new Error('Session must be in COUNTING state to review');

    await tx.run(`UPDATE stocktake_sessions SET status = 'REVIEW', reviewer_id = ? WHERE id = ?`, [reviewerId, sessionId]);
  });
}

async function postStocktake(sessionId, reviewerId) {
  return runTransaction(async (tx) => {
    const session = await getQuery(`SELECT status FROM stocktake_sessions WHERE id = ?`, [sessionId]);
    if (!session || session.status !== 'REVIEW') throw new Error('Session must be in REVIEW state to post');

    const lines = await allQuery(`SELECT * FROM stocktake_lines WHERE stocktake_session_id = ? AND variance_microunits != 0`, [sessionId]);

    for (const line of lines) {
      // Create ledger adjustment entry
      await appendLedgerEvent(tx, {
        inventory_item_id: line.inventory_item_id,
        location_id: line.location_id,
        change_microunits: line.variance_microunits,
        reference_type: 'COUNT',
        reference_id: sessionId
      });
    }

    await tx.run(`UPDATE stocktake_sessions SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?`, [sessionId]);
  });
}

module.exports = {
  createStocktakeSession,
  recordCount,
  reviewStocktake,
  postStocktake
};
