const crypto = require('crypto');
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

// Station definitions
const STATIONS = {
  BARISTA: 'BARISTA',
  KITCHEN: 'KITCHEN',
  SHISHA: 'SHISHA'
};

// Canonical KDS state machine per spec: NEW, ACKNOWLEDGED, IN_PROGRESS,
// READY, PICKED_UP, SERVED, CANCELLED (supporting legacy alias forms).
const LEGAL_KDS_TRANSITIONS = {
  'NEW': ['ACKNOWLEDGED', 'IN_PROGRESS', 'IN_PREPARATION', 'CANCELLED'],
  'PENDING': ['ACKNOWLEDGED', 'IN_PROGRESS', 'IN_PREPARATION', 'CANCELLED'],
  'ACKNOWLEDGED': ['IN_PROGRESS', 'IN_PREPARATION', 'READY', 'CANCELLED'],
  'IN_PROGRESS': ['READY', 'CANCELLED'],
  'IN_PREPARATION': ['READY', 'CANCELLED'],
  'READY': ['PICKED_UP', 'COLLECTED', 'SERVED', 'DELIVERED', 'CANCELLED'],
  'PICKED_UP': ['SERVED', 'DELIVERED'],
  'COLLECTED': ['SERVED', 'DELIVERED'],
  'SERVED': [],
  'DELIVERED': [],
  'CANCELLED': []
};

// Legacy state-name aliases so existing clients/tests keep working.
const STATE_ALIASES = {
  'IN_PREPARATION': 'IN_PROGRESS',
  'COLLECTED': 'PICKED_UP',
  'DELIVERED': 'SERVED'
};

function normalizeState(state) {
  if (!state) return state;
  return STATE_ALIASES[String(state).toUpperCase()] || String(state).toUpperCase();
}

/**
 * Determine station from item metadata (department, category, or name)
 */
function resolveStationForItem(item = {}) {
  const dept = (item.department || '').toUpperCase();
  const cat = (item.category_name || item.category || '').toUpperCase();
  const name = (item.name || item.item_name || '').toUpperCase();

  if (dept === 'BARISTA' || dept === 'BEVERAGE' || dept === 'HOT_DRINKS' || dept === 'COLD_DRINKS' ||
    cat.includes('DRINK') || cat.includes('COFFEE') || cat.includes('مشروب') || cat.includes('قهوة') ||
    name.includes('LATTE') || name.includes('ESPRESSO') || name.includes('لاتيه') || name.includes('اسبريسو') || name.includes('شاي')) {
    return STATIONS.BARISTA;
  }

  if (dept === 'SHISHA' || cat.includes('SHISHA') || cat.includes('شيشة') || name.includes('شيشة') || name.includes('معسل')) {
    return STATIONS.SHISHA;
  }

  return STATIONS.KITCHEN;
}

async function getNextSequence(tx, venueId) {
  const row = await (tx ? tx.get(`SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?`, [venueId])
    : getQuery(`SELECT COALESCE(MAX(sequence), 0) + 1 as seq FROM outbox_events WHERE venue_id = ?`, [venueId]));
  return row ? row.seq : 1;
}

/**
 * Routes order lines to appropriate KDS stations with rich recipe & allergen metadata
 */
async function routeOrderToKds(tx, venueId, orderSessionId, lines = []) {
  // Allow callers without an external transaction: wrap in a fresh atomic tx so the
  // routing + KDS state + outbox are applied exactly once.
  if (!tx) {
    return runTransaction(async (t) => routeOrderToKds(t, venueId, orderSessionId, lines));
  }

  if (!lines || lines.length === 0) return [];

  // Resolve the immutable shift scope bound to the order session so every floor
  // artifact (KDS order, runner task, BOM) is reconciled under one shift.
  let sessionShiftId = await tx.get(
    `SELECT shift_id FROM v3_order_sessions WHERE id = ?`,
    [orderSessionId]
  );
  sessionShiftId = sessionShiftId ? sessionShiftId.shift_id : null;

  // Group lines by station
  const stationBatches = {
>>>>>>>
    task_progress
    [STATIONS.BARISTA]: [],
    [STATIONS.KITCHEN]: [],
    [STATIONS.SHISHA]: []
};

for (const line of lines) {
  // Fetch line item details with recipe, allergen, and ingredient context
  const item = await(tx ? tx.get(
    `SELECT m.id, m.name, m.department, c.name as category_name
       FROM v3_menu_items m
       LEFT JOIN v3_menu_categories c ON m.category_id = c.id
       WHERE m.id = ?`,
    [line.menu_item_id || line.item_id]
  ) : getQuery(
    `SELECT m.id, m.name, m.department, c.name as category_name
       FROM v3_menu_items m
       LEFT JOIN v3_menu_categories c ON m.category_id = c.id
       WHERE m.id = ?`,
    [line.menu_item_id || line.item_id]
  ));

  const station = resolveStationForItem(item || line);
  stationBatches[station].push({
    ...line,
    item_name: item ? item.name : (line.name || line.item_name || 'صنف غير معروف'),
    department: item ? item.department : station
  });
}

const createdKdsOrders = [];

for (const [station, stLines] of Object.entries(stationBatches)) {
  if (stLines.length === 0) continue;

  const kdsOrderId = `KDS-${station}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const nowIso = new Date().toISOString();

  // Create KDS order header
  await tx.run(
    `INSERT INTO kds_orders (id, venue_id, order_session_id, station_id, state, created_at, updated_at) 
       VALUES (?, ?, ?, ?, 'NEW', datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    [kdsOrderId, venueId, orderSessionId, station]
  );

  const lineRecords = [];
  for (const line of stLines) {
    const kdsLineId = `KDL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Fetch versioned recipe BOM if configured
    const recipe = await(tx ? tx.get(
      `SELECT r.id as recipe_id, r.version as recipe_version, r.instructions
         FROM v3_recipe_versions r
         WHERE r.menu_item_id = ?
         ORDER BY r.version DESC LIMIT 1`,
      [line.menu_item_id || line.item_id]
    ) : getQuery(
      `SELECT r.id as recipe_id, r.version as recipe_version, r.instructions
         FROM v3_recipe_versions r
         WHERE r.menu_item_id = ?
         ORDER BY r.version DESC LIMIT 1`,
      [line.menu_item_id || line.item_id]
    ));

    let ingredients = [];
    if (recipe && recipe.recipe_id) {
      ingredients = await(tx ? tx.all(
        `SELECT i.name as ingredient_name, ri.quantity_microunits, ri.unit
           FROM v3_recipe_ingredients ri
           JOIN v3_inventory_items i ON ri.inventory_item_id = i.id
           WHERE ri.recipe_version_id = ?`,
        [recipe.recipe_id]
      ) : allQuery(
        `SELECT i.name as ingredient_name, ri.quantity_microunits, ri.unit
           FROM v3_recipe_ingredients ri
           JOIN v3_inventory_items i ON ri.inventory_item_id = i.id
           WHERE ri.recipe_version_id = ?`,
        [recipe.recipe_id]
      ));
    }

    let targetLineId = line.id || line.v3_order_line_id;
    if (targetLineId) {
      const existingLine = await(tx ? tx.get(`SELECT id FROM v3_order_lines WHERE id = ?`, [targetLineId]) : getQuery(`SELECT id FROM v3_order_lines WHERE id = ?`, [targetLineId]));
      if (!existingLine) {
        await tx.run(
          `INSERT INTO v3_order_lines (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, created_at)
             VALUES (?, ?, ?, ?, 5000, 5000, 'PENDING', datetime('now', 'localtime'))`,
          [targetLineId, orderSessionId, line.menu_item_id || line.item_id, line.quantity || 1]
        );
      }
    } else {
      targetLineId = `LN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await tx.run(
        `INSERT INTO v3_order_lines (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, created_at)
           VALUES (?, ?, ?, ?, 5000, 5000, 'PENDING', datetime('now', 'localtime'))`,
        [targetLineId, orderSessionId, line.menu_item_id || line.item_id, line.quantity || 1]
      );
    }

    await tx.run(
      `INSERT INTO kds_order_lines (id, kds_order_id, v3_order_line_id, menu_item_id, state, created_at, updated_at) 
         VALUES (?, ?, ?, ?, 'NEW', datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [kdsLineId, kdsOrderId, targetLineId, line.menu_item_id || line.item_id]
    );

    lineRecords.push({
      kds_line_id: kdsLineId,
      menu_item_id: line.menu_item_id || line.item_id,
      item_name: line.item_name,
      quantity: line.quantity || 1,
      notes: line.notes || null,
      modifiers: line.modifiers || [],
      recipe_version: recipe ? recipe.recipe_version : 1,
      instructions: recipe ? recipe.instructions : null,
      allergens: line.allergens || (recipe && recipe.instructions && recipe.instructions.toLowerCase().includes('milk') ? ['MILK'] : []),
      ingredients: ingredients.map(ing => ({
        name: ing.ingredient_name,
        quantity: ing.quantity_microunits / 1000000,
        unit: ing.unit
      })),
      state: 'NEW',
      created_at: nowIso
    });
  }

  // Persist Outbox Event
  const nextSeq = await getNextSequence(tx, venueId);
  const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const payload = {
    kds_order_id: kdsOrderId,
    order_session_id: orderSessionId,
    station_id: station,
    state: 'NEW',
    lines: lineRecords,
    created_at: nowIso
  };

  await tx.run(
    `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status) 
       VALUES (?, 'KDS_ORDER_CREATED', 'KDS_ORDER', ?, ?, ?, 1, 'v1', ?, ?, 'PENDING')`,
    [eventId, kdsOrderId, JSON.stringify(payload), nextSeq, venueId, station]
  );

  createdKdsOrders.push({
    kds_order_id: kdsOrderId,
    station_id: station,
    lines: lineRecords
  });
}

return createdKdsOrders;
}

/**
 * Updates KDS Line State with role authorization and legal state progression.
 * Every accepted transition writes an immutable kds_line_transitions audit row
 * carrying authenticated actor, station, device, version, timestamp, request id.
 */
async function updateKdsLineState(kdsLineId, newState, actorId, expectedVersion, role = null, context = {}) {
  const deviceId = context.deviceId || null;
  const requestId = context.requestId || null;
  return runTransaction(async (tx) => {
    const line = await tx.get(
      `SELECT l.*, o.id as kds_order_id, o.order_session_id, o.station_id, o.venue_id, o.version as order_version,
              o.shift_id as order_shift_id,
              m.name as item_name
       FROM kds_order_lines l 
       JOIN kds_orders o ON l.kds_order_id = o.id 
       LEFT JOIN v3_menu_items m ON l.menu_item_id = m.id
       WHERE l.id = ?`,
      [kdsLineId]
    );

    if (!line) {
      const err = new Error(`NOT_FOUND: خط الطلب في شاشة المطبخ غير موجود [${kdsLineId}]`);
      err.statusCode = 404;
      throw err;
    }

    const normRole = (role || '').toUpperCase();
    // Role station permission enforcement
    if (normRole === 'BARISTA' && line.station_id !== STATIONS.BARISTA) {
      const err = new Error(`FORBIDDEN: الباريستا مصرح له بتعديل طلبات البار فقط`);
      err.statusCode = 403;
      throw err;
    }
    if (normRole === 'CHEF' && line.station_id !== STATIONS.KITCHEN) {
      const err = new Error(`FORBIDDEN: الشيف مصرح له بتعديل طلبات المطبخ فقط`);
      err.statusCode = 403;
      throw err;
    }
    if (normRole === 'SHISHA' && line.station_id !== STATIONS.SHISHA) {
      const err = new Error(`FORBIDDEN: مسؤول الشيشة مصرح له بتعديل طلبات الشيشة فقط`);
      err.statusCode = 403;
      throw err;
    }

    // Legal state progression check (with legacy alias normalization)
    const currentState = String(line.state || 'NEW').toUpperCase();
    const targetState = String(newState || '').toUpperCase();
    const currentNorm = normalizeState(currentState);
    const targetNorm = normalizeState(targetState);
    const allowed = (LEGAL_KDS_TRANSITIONS[currentState] || []).concat(LEGAL_KDS_TRANSITIONS[currentNorm] || []);
    if (!allowed.includes(targetState) && !allowed.includes(targetNorm)) {
      const err = new Error(`INVALID_STATE_TRANSITION: لا يمكن تحويل الصنف من ${currentState} إلى ${targetState}`);
      err.statusCode = 400;
      throw err;
    }

    // Optimistic Concurrency Check
    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (line.order_version !== expectedVersion) {
        const err = new Error(`OPTIMISTIC_LOCK_FAILURE: تعارض في نسخة الطلب (المتوقع: ${expectedVersion}، الحالي: ${line.order_version})`);
        err.statusCode = 409;
        throw err;
      }
    }

    const nowIso = new Date().toISOString();
    const newVersion = line.order_version + 1;

    // Update Line State
    await tx.run(
      `UPDATE kds_order_lines SET state = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [targetState, kdsLineId]
    );

    // Immutable transition audit row (actor, station, device, version, timestamp, request id)
    await tx.run(
      `INSERT INTO kds_line_transitions (id, kds_line_id, kds_order_id, order_session_id, station_id, from_state, to_state, actor_id, device_id, version, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [`KLT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, kdsLineId, line.kds_order_id,
      line.order_session_id, line.station_id, currentState, targetState, actorId, deviceId, newVersion, requestId]
    );

    // Propagate floor state back onto the authoritative sales ledger lines
    const salesStatusMap = { 'READY': 'READY', 'PICKED_UP': 'READY', 'SERVED': 'SERVED', 'CANCELLED': 'CANCELLED' };
    if (salesStatusMap[targetState] && line.v3_order_line_id) {
      try {
        await tx.run(
          `UPDATE v3_order_lines SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [salesStatusMap[targetState], line.v3_order_line_id]
        );
      } catch (e) { /* legacy tables may lack updated_at; state propagation is best-effort */ }
    }

    // Update KDS Order Header
    await tx.run(
      `UPDATE kds_orders SET version = ?, actor_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [newVersion, actorId, line.kds_order_id]
    );

    // If line is READY, check if Runner task should be created
    let runnerTaskId = null;
    if (targetState === 'READY') {
      const { createTask } = require('../floor/runnerService');
      const orderSession = await tx.get(
        `SELECT id, table_id FROM v3_order_sessions WHERE id = ?`,
        [line.order_session_id]
      );

      runnerTaskId = await createTask(
        line.venue_id,
        'DELIVERY',
        1, // Priority High
        JSON.stringify({
          kds_order_id: line.kds_order_id,
          kds_line_id: kdsLineId,
          order_session_id: line.order_session_id,
          table_id: orderSession ? orderSession.table_id : null,
          item_name: line.item_name,
          station_id: line.station_id
        }),
        tx,
        { shiftId: line.order_shift_id || null, deviceId: deviceId }
      );
    }

    // Outbox event emission
    const nextSeq = await getNextSequence(tx, line.venue_id);
    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      kds_line_id: kdsLineId,
      kds_order_id: line.kds_order_id,
      order_session_id: line.order_session_id,
      item_name: line.item_name,
      previous_state: currentState,
      new_state: targetState,
      actor_id: actorId,
      device_id: deviceId,
      version: newVersion,
      runner_task_id: runnerTaskId,
      request_id: requestId,
      timestamp: nowIso
    };

    await tx.run(
      `INSERT INTO outbox_events (event_id, topic, aggregate_type, aggregate_id, payload_json, sequence, aggregate_version, schema_version, venue_id, station_id, status) 
       VALUES (?, 'KDS_LINE_UPDATED', 'KDS_ORDER', ?, ?, ?, ?, 'v1', ?, ?, 'PENDING')`,
      [eventId, line.kds_order_id, JSON.stringify(payload), nextSeq, newVersion, line.venue_id, line.station_id]
    );

    return {
      status: 'SUCCESS',
      kds_line_id: kdsLineId,
      kds_order_id: line.kds_order_id,
      state: targetState,
      previous_state: currentState,
      version: newVersion,
      runner_task_id: runnerTaskId
    };
  });
}

/**
 * Get active KDS orders for a station with full recipe and timer context
 */
async function getKdsOrdersByStation(venueId, stationId) {
  const orders = await allQuery(
    `SELECT o.*, s.table_id, s.created_by as waiter_id,
            CAST((strftime('%s', 'now', 'localtime') - strftime('%s', o.created_at)) / 60 AS INTEGER) as elapsed_minutes
     FROM kds_orders o
     LEFT JOIN v3_order_sessions s ON o.order_session_id = s.id
     WHERE o.venue_id = ? AND o.station_id = ? AND o.state NOT IN ('SERVED', 'DELIVERED', 'CANCELLED')
     ORDER BY o.created_at ASC`,
    [venueId, stationId]
  );

  const result = [];
  for (const ord of orders) {
    const lines = await allQuery(
      `SELECT l.*, m.name as item_name, m.department
       FROM kds_order_lines l
       LEFT JOIN v3_menu_items m ON l.menu_item_id = m.id
       WHERE l.kds_order_id = ?`,
      [ord.id]
    );

    result.push({
      ...ord,
      lines
    });
  }

  return result;
}

module.exports = {
  STATIONS,
  LEGAL_KDS_TRANSITIONS,
  resolveStationForItem,
  routeOrderToKds,
  updateKdsLineState,
  getKdsOrdersByStation
};
