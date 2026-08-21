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
    
    let user = null;
    if (token) {
      user = await validateSession(token);
    }

    ws.user = user;
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

      // Broadcast to connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
          client.send(msgString);
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
