const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

// Basic routing mock. In prod, read from `menu_items` or a `routing_rules` table.
async function routeOrderToKds(tx, venueId, orderSessionId, lines) {
  // Aggregate lines by station
  const stationMap = {
    'BARISTA': [],
    'KITCHEN': [],
    'SHISHA': []
  };

  for (const line of lines) {
    // A real implementation would query the catalog for `routing_category`.
    // Defaulting to KITCHEN for safety, but mimicking routing here.
    let station = 'KITCHEN';
    if (line.menu_item_id.includes('coffee')) station = 'BARISTA';
    if (line.menu_item_id.includes('shisha')) station = 'SHISHA';

    stationMap[station].push(line);
  }

  for (const [station, stLines] of Object.entries(stationMap)) {
    if (stLines.length === 0) continue;

    const kdsOrderId = `KDS-${station}-${Date.now()}`;
    await tx.run(
      `INSERT INTO kds_orders (id, venue_id, order_session_id, station_id, state) VALUES (?, ?, ?, ?, 'NEW')`,
      [kdsOrderId, venueId, orderSessionId, station]
    );

    for (const line of stLines) {
      await tx.run(
        `INSERT INTO kds_order_lines (id, kds_order_id, v3_order_line_id, menu_item_id, state) VALUES (?, ?, ?, ?, 'NEW')`,
        [`KDL-${Date.now()}-${Math.random()}`, kdsOrderId, line.id, line.menu_item_id]
      );
    }

    // Insert outbox event for Realtime sync
    const nextSeq = await getNextSequence(tx, venueId);
    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, venue_id, station_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`EVT-${Date.now()}-${Math.random()}`, 'kds_order_created', 'kds_order', kdsOrderId, JSON.stringify({ kdsOrderId, lines: stLines }), nextSeq, 1, venueId, station]
    );
  }
}

async function updateKdsLineState(kdsLineId, newState, actorId, expectedVersion, role) {
  return runTransaction(async (tx) => {
    const line = await getQuery(`
      SELECT l.*, o.station_id, o.venue_id, o.version as order_version 
      FROM kds_order_lines l 
      JOIN kds_orders o ON l.kds_order_id = o.id 
      WHERE l.id = ?`, 
    [kdsLineId]);

    if (!line) throw new Error('KDS line not found');

    // Basic Role validation
    if (role === 'BARISTA' && line.station_id !== 'BARISTA') {
      throw new Error('Unauthorized: Barista cannot alter non-Barista work');
    }
    if (role === 'CHEF' && line.station_id !== 'KITCHEN') {
      throw new Error('Unauthorized: Chef cannot alter non-Kitchen work');
    }

    // Version validation (Optimistic Locking on Order level)
    if (expectedVersion !== undefined && line.order_version !== expectedVersion) {
      throw new Error(`Optimistic lock failure: Expected ${expectedVersion}, got ${line.order_version}`);
    }

    // Update state
    await tx.run(`UPDATE kds_order_lines SET state = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newState, kdsLineId]);
    await tx.run(`UPDATE kds_orders SET version = version + 1, actor_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [actorId, line.kds_order_id]);

    const nextSeq = await getNextSequence(tx, line.venue_id);
    await tx.run(
      `INSERT INTO outbox_events (id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, venue_id, station_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`EVT-${Date.now()}-${Math.random()}`, 'kds_line_updated', 'kds_order', line.kds_order_id, JSON.stringify({ kdsLineId, newState, actorId }), nextSeq, line.order_version + 1, line.venue_id, line.station_id]
    );

    return { status: 'SUCCESS', version: line.order_version + 1 };
  });
}

async function getNextSequence(tx, venueId) {
  // Simple sequence generator per venue
  const row = await getQuery(tx ? `SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?` : `SELECT 1`, [venueId], tx);
  return row ? row.seq : 1;
}

module.exports = { routeOrderToKds, updateKdsLineState };
