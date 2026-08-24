const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { createApp } = require('../../src/app');
const { setupWebSocketServer, dispatchPendingOutboxEvents } = require('../../src/realtime/websocket');
const { getQuery, runQuery, allQuery } = require('../../src/db/connection');
const { createSession } = require('../../src/domain/auth/service');
const { routeOrderToKds, updateKdsLineState, getKdsOrdersByStation } = require('../../src/domain/kds/kdsService');
const { createTask, claimTask, completeTask, getRunnerTasks } = require('../../src/domain/floor/runnerService');
const { processClientSyncBatch } = require('../../src/domain/sync/service');

const bcrypt = require('bcryptjs');
const request = require('supertest');

describe('Station Operations, Realtime Outbox & Offline Sync Gate Suite', function () {
  this.timeout(15000);

  let app;
  let server;
  let port;
  let baristaToken;
  let chefToken;
  let runnerToken;
  let managerToken;

  before(async () => {
    // Seed roles safely
    const canonicalRoles = ['BARISTA', 'CHEF', 'RUNNER', 'MANAGER'];
    for (const r of canonicalRoles) {
      await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [`R_${r}`, r]);
    }

    const upsertUser = async (id, name, roleId, pin) => {
      const pinHash = await bcrypt.hash(pin, 10);
      await runQuery(
        `INSERT OR IGNORE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, 1, 0)`,
        [id, name, roleId, pinHash]
      );
      await runQuery(
        `UPDATE v3_users SET is_active = 1, failed_attempts = 0, pin_hash = ?, role_id = ? WHERE id = ?`,
        [pinHash, roleId, id]
      );
    };

    await upsertUser('201', 'Barista User', 'R_BARISTA', '7701');
    await upsertUser('202', 'Chef User', 'R_CHEF', '7702');
    await upsertUser('203', 'Runner User', 'R_RUNNER', '7703');
    await upsertUser('204', 'Manager User', 'R_MANAGER', '7704');

    // Setup HTTP and WS Server
    app = createApp();
    server = http.createServer(app);
    setupWebSocketServer(server);

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });

    const bRes = await request(app).post('/api/auth/login').send({ pin: '7701' });
    baristaToken = bRes.body.token;

    const cRes = await request(app).post('/api/auth/login').send({ pin: '7702' });
    chefToken = cRes.body.token;

    const rRes = await request(app).post('/api/auth/login').send({ pin: '7703' });
    runnerToken = rRes.body.token;

    const mRes = await request(app).post('/api/auth/login').send({ pin: '7704' });
    managerToken = mRes.body.token;
  });

  after((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('1. Canonical KDS Routing & Station Operations', () => {
    it('should route items correctly to BARISTA, SHISHA, and KITCHEN with recipe metadata', async () => {
      const sessId = `SESS-KDS-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, created_at, updated_at)
         VALUES (?, (SELECT id FROM branches LIMIT 1), 'T-01', 201, 'DINE_IN', 'OPEN', 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
        [sessId]
      );

      // Seed items with recipe and allergens
      const latteId = `MI-LATTE-${Date.now()}`;
      await runQuery(`INSERT INTO v3_menu_items (id, name, department, is_available) VALUES (?, 'Spanish Latte', 'BARISTA', 1)`, [latteId]);
      await runQuery(`INSERT INTO v3_recipe_versions (id, menu_item_id, version, instructions, allergens_json) VALUES (?, ?, 1, 'Brew espresso, steam milk', '["MILK"]')`, [`REC-${latteId}`, latteId]);

      const burgerId = `MI-BURGER-${Date.now()}`;
      await runQuery(`INSERT INTO v3_menu_items (id, name, department, is_available) VALUES (?, 'Classic Burger', 'KITCHEN', 1)`, [burgerId]);

      const lines = [
        { id: `LN-1-${Date.now()}`, menu_item_id: latteId, quantity: 2 },
        { id: `LN-2-${Date.now()}`, menu_item_id: burgerId, quantity: 1 }
      ];

      const { runTransaction } = require('../../src/db/transaction');
      const kdsOrders = await runTransaction(async (tx) => {
        return routeOrderToKds(tx, 'V_DEFAULT', sessId, lines);
      });

      assert.strictEqual(kdsOrders.length, 2);
      const baristaOrd = kdsOrders.find(o => o.station_id === 'BARISTA');
      const kitchenOrd = kdsOrders.find(o => o.station_id === 'KITCHEN');

      assert.ok(baristaOrd, 'Barista station order created');
      assert.ok(kitchenOrd, 'Kitchen station order created');
      assert.strictEqual(baristaOrd.lines[0].allergens[0], 'MILK');
    });

    it('should enforce role-based station modification and legal state transitions', async () => {
      const orders = await getKdsOrdersByStation('V_DEFAULT', 'BARISTA');
      assert.ok(orders.length > 0);
      const targetLine = orders[0].lines[0];

      // Barista moves NEW -> IN_PREPARATION (legal)
      const res1 = await updateKdsLineState(targetLine.id, 'IN_PREPARATION', 201, 1, 'BARISTA');
      assert.strictEqual(res1.status, 'SUCCESS');
      assert.strictEqual(res1.state, 'IN_PREPARATION');

      // Illegal transition: IN_PREPARATION -> COLLECTED (must be READY first)
      await assert.rejects(
        async () => {
          await updateKdsLineState(targetLine.id, 'COLLECTED', 201, res1.version, 'BARISTA');
        },
        /INVALID_STATE_TRANSITION/
      );

      // Station RBAC: Chef attempting to modify Barista line is forbidden
      await assert.rejects(
        async () => {
          await updateKdsLineState(targetLine.id, 'READY', 202, res1.version, 'CHEF');
        },
        /FORBIDDEN/
      );

      // Barista completes to READY -> auto creates runner task
      const res2 = await updateKdsLineState(targetLine.id, 'READY', 201, res1.version, 'BARISTA');
      assert.strictEqual(res2.state, 'READY');
      assert.ok(res2.runner_task_id, 'Runner delivery task auto-created on READY');
    });
  });

  describe('2. Runner Floor Operations & Duplicate Protection', () => {
    let testTaskId;

    it('should create and retrieve runner tasks', async () => {
      testTaskId = await createTask('V_DEFAULT', 'DELIVERY', 2, { table_id: 'T-05', item_name: 'Hot Latte' });
      assert.ok(testTaskId);

      const tasks = await getRunnerTasks('V_DEFAULT');
      const found = tasks.find(t => t.id === testTaskId);
      assert.ok(found);
      assert.strictEqual(found.status, 'PENDING');
      assert.strictEqual(found.context.table_id, 'T-05');
    });

    it('should prevent duplicate claiming of the same runner task', async () => {
      // First claim succeeds
      const claim1 = await claimTask(testTaskId, 203, 1);
      assert.strictEqual(claim1.task_status, 'CLAIMED');

      // Second claim by another runner is rejected
      await assert.rejects(
        async () => {
          await claimTask(testTaskId, 204, claim1.version);
        },
        /ALREADY_CLAIMED/
      );
    });

    it('should complete runner task cleanly', async () => {
      const comp = await completeTask(testTaskId, 203);
      assert.strictEqual(comp.task_status, 'COMPLETED');
    });
  });

  describe('3. Realtime Scoped WebSocket & Gap Replay', () => {
    it('should establish 2 isolated client sessions and receive sequenced events in real-time', async () => {
      const client1Messages = [];
      const client2Messages = [];

      const ws1 = new WebSocket(`ws://localhost:${port}/ws?token=${baristaToken}&stationId=BARISTA&venueId=V_DEFAULT`);
      const ws2 = new WebSocket(`ws://localhost:${port}/ws?token=${runnerToken}&stationId=HALL&venueId=V_DEFAULT`);

      await new Promise((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 2) resolve();
        };
        ws1.on('open', check);
        ws2.on('open', check);
      });

      ws1.on('message', (data) => {
        try { client1Messages.push(JSON.parse(data)); } catch (e) {}
      });
      ws2.on('message', (data) => {
        try { client2Messages.push(JSON.parse(data)); } catch (e) {}
      });

      // Emit new runner task and flush outbox
      await createTask('V_DEFAULT', 'DELIVERY', 1, { table_id: 'T-10', item_name: 'Espresso Double' });
      await dispatchPendingOutboxEvents();

      // Wait a moment for delivery
      await new Promise(r => setTimeout(r, 400));

      // ws2 (station HALL) must receive RUNNER_TASK_CREATED
      const taskEvt = client2Messages.find(m => m.topic === 'RUNNER_TASK_CREATED');
      assert.ok(taskEvt, 'HALL client received RUNNER_TASK_CREATED event');
      assert.ok(taskEvt.sequence > 0, 'Event includes sequence number');

      ws1.close();
      ws2.close();
    });

    it('should replay missed events when client connects with previous cursor (Gap Recovery)', async () => {
      // Read current max sequence
      const maxSeqRow = await getQuery(`SELECT MAX(sequence) as max_seq FROM outbox_events WHERE venue_id = 'V_DEFAULT'`);
      const currentMax = maxSeqRow ? maxSeqRow.max_seq : 0;

      // Emit 2 new events
      await createTask('V_DEFAULT', 'DELIVERY', 1, { table_id: 'T-11' });
      await createTask('V_DEFAULT', 'DELIVERY', 1, { table_id: 'T-12' });
      await dispatchPendingOutboxEvents();

      // Reconnect with cursor = currentMax (simulating client that was offline)
      const replayedMessages = [];
      const wsReplay = new WebSocket(`ws://localhost:${port}/ws?token=${runnerToken}&stationId=HALL&venueId=V_DEFAULT&cursor=${currentMax}`);

      await new Promise((resolve) => {
        wsReplay.on('open', resolve);
      });

      wsReplay.on('message', (data) => {
        try { replayedMessages.push(JSON.parse(data)); } catch (e) {}
      });

      await new Promise(r => setTimeout(r, 500));

      const replayed = replayedMessages.filter(m => m.is_replay === true);
      assert.ok(replayed.length >= 2, 'Client received all missed events via cursor replay');
      wsReplay.close();
    });
  });

  describe('4. Offline Batch Sync Contract & Unsafe Payment Safety Guard', () => {
    it('should process safe batch commands (SUBMIT_ORDER, CLAIM_RUNNER_TASK)', async () => {
      const taskForSync = await createTask('V_DEFAULT', 'DELIVERY', 1, { table_id: 'T-20' });

      const batch = [
        {
          client_command_id: `CMD-ORD-${Date.now()}`,
          idempotency_key: `IDEM-ORD-${Date.now()}`,
          action: 'SUBMIT_ORDER',
          payload: {
            table_id: 'T-20',
            order_type: 'DINE_IN',
            items: [{ name: 'Turkish Coffee', quantity: 1 }]
          }
        },
        {
          client_command_id: `CMD-CLM-${Date.now()}`,
          idempotency_key: `IDEM-CLM-${Date.now()}`,
          action: 'CLAIM_RUNNER_TASK',
          payload: {
            task_id: taskForSync,
            runner_id: 203
          }
        }
      ];

      const res = await processClientSyncBatch(batch, { id: '203', role: 'RUNNER' });
      assert.strictEqual(res.processed_count, 2);
      assert.strictEqual(res.accepted_count, 2);
      assert.strictEqual(res.results[0].status, 'ACCEPTED');
      assert.strictEqual(res.results[1].status, 'ACCEPTED');
    });

    it('should return DUPLICATE for repeated idempotency key with same payload', async () => {
      const fixedKey = `IDEM-DUP-${Date.now()}`;
      const cmd = {
        client_command_id: `CMD-1`,
        idempotency_key: fixedKey,
        action: 'SUBMIT_ORDER',
        payload: { table_id: 'T-30', items: [{ name: 'Tea', quantity: 1 }] }
      };

      const res1 = await processClientSyncBatch([cmd], { id: '201', role: 'BARISTA' });
      assert.strictEqual(res1.results[0].status, 'ACCEPTED');

      // Duplicate submission
      const res2 = await processClientSyncBatch([cmd], { id: '201', role: 'BARISTA' });
      assert.strictEqual(res2.results[0].status, 'DUPLICATE');
      assert.ok(res2.results[0].result.order_session_id);
    });

    it('should return CONFLICT if same idempotency key is reused with different payload', async () => {
      const fixedKey = `IDEM-CONFLICT-${Date.now()}`;
      const cmd1 = {
        client_command_id: `CMD-A`,
        idempotency_key: fixedKey,
        action: 'SUBMIT_ORDER',
        payload: { table_id: 'T-30', items: [{ name: 'Tea', quantity: 1 }] }
      };
      await processClientSyncBatch([cmd1], { id: '201', role: 'BARISTA' });

      const cmd2 = {
        client_command_id: `CMD-B`,
        idempotency_key: fixedKey,
        action: 'SUBMIT_ORDER',
        payload: { table_id: 'T-30', items: [{ name: 'LATTE_DIFFERENT', quantity: 5 }] }
      };
      const res2 = await processClientSyncBatch([cmd2], { id: '201', role: 'BARISTA' });
      assert.strictEqual(res2.results[0].status, 'CONFLICT');
    });

    it('STRICT POLICY: should REJECT financial settlement actions in offline sync batch', async () => {
      const unsafeBatch = [
        {
          client_command_id: `CMD-UNSAFE-${Date.now()}`,
          idempotency_key: `IDEM-UNSAFE-${Date.now()}`,
          action: 'SETTLE_PAYMENT',
          payload: { order_id: 'ORD-1', amount: 5000 }
        },
        {
          client_command_id: `CMD-UNSAFE2-${Date.now()}`,
          idempotency_key: `IDEM-UNSAFE2-${Date.now()}`,
          action: 'VOID_PAID',
          payload: { order_id: 'ORD-1' }
        }
      ];

      const res = await processClientSyncBatch(unsafeBatch, { id: '204', role: 'MANAGER' });
      assert.strictEqual(res.accepted_count, 0);
      assert.strictEqual(res.results[0].status, 'REJECTED');
      assert.ok(res.results[0].error.includes('UNSAFE_OFFLINE_ACTION'));
      assert.strictEqual(res.results[1].status, 'REJECTED');
      assert.ok(res.results[1].error.includes('UNSAFE_OFFLINE_ACTION'));
    });
  });
});
