/**
 * Authenticated Realtime WebSocket Server & Outbox Publisher
 */
const { WebSocketServer } = require('ws');
const { validateSession } = require('../domain/auth/service');
const { allQuery, runQuery } = require('../db/connection');
const logger = require('../observability/logger');

let wss = null;
let outboxTimer = null;

function setupWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    // Extract token from query params or cookie
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    
    let venueId = url.searchParams.get('venueId');
    let stationId = url.searchParams.get('stationId');
    let cursor = parseInt(url.searchParams.get('cursor'), 10) || 0;
    
    let user = null;
    if (token) {
      user = await validateSession(token);
    }

    if (!user || !venueId) {
      ws.close(4001, 'Unauthorized or missing venue');
      return;
    }

    ws.user = user;
    ws.venueId = venueId;
    ws.stationId = stationId;
    ws.isAlive = true;

    // Immediately trigger a replay from the cursor
    replayEventsForClient(ws, cursor).catch(e => logger.error('Replay error', { error: e.message }));
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (e) {}
    });

    logger.info('WebSocket client connected', { userId: user ? user.id : 'ANON', role: user ? user.role : 'ANON' });
  });

  // Outbox dispatch loop
  outboxTimer = setInterval(async () => {
    await dispatchPendingOutboxEvents();
  }, 1000);

  return wss;
}

async function dispatchPendingOutboxEvents() {
  if (!wss || wss.clients.size === 0) return;

  try {
    const events = await allQuery(
      `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 10`
    );

    for (const evt of events) {
      let payload = {};
      try { payload = JSON.parse(evt.payload_json); } catch (e) {}

      const msgString = JSON.stringify({
        topic: evt.topic,
        aggregate_type: evt.aggregate_type,
        aggregate_id: evt.aggregate_id,
        payload
      });

      // Broadcast to connected clients, scoping to venue and station
      wss.clients.forEach((client) => {
        if (client.readyState === 1 && client.venueId === evt.venue_id) { 
          // If event has a station, only broadcast to that station or HALL (runners/managers)
          if (!evt.station_id || client.stationId === evt.station_id || client.stationId === 'HALL' || client.stationId === 'MANAGER') {
            client.send(msgString);
          }
        }
      });

      await runQuery(
        `UPDATE outbox_events SET status = 'PUBLISHED', published_at = datetime('now', 'localtime') WHERE id = ?`,
        [evt.id]
      );
    }
  } catch (e) {
    // Suppress loop error
  }
}

async function replayEventsForClient(ws, cursor) {
  const events = await allQuery(
    `SELECT * FROM outbox_events WHERE venue_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 500`,
    [ws.venueId, cursor]
  );

  for (const evt of events) {
    if (evt.station_id && ws.stationId !== evt.station_id && ws.stationId !== 'HALL' && ws.stationId !== 'MANAGER') {
      continue;
    }

    let payload = {};
    try { payload = JSON.parse(evt.payload_json); } catch (e) {}

    const msgString = JSON.stringify({
      topic: evt.topic,
      aggregate_type: evt.aggregate_type,
      aggregate_id: evt.aggregate_id,
      sequence: evt.sequence,
      payload
    });

    ws.send(msgString);
  }
}

function broadcastEvent(topic, data) {
  if (!wss) return;
  const msg = JSON.stringify({ topic, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

module.exports = {
  setupWebSocketServer,
  broadcastEvent
};
