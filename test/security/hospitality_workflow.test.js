const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { allQuery, getQuery, runQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');

describe('Hospitality Workflow, Table Concurrency, Waiter Assist & CRM Suite', function() {
  this.timeout(25000);
  let app;
  let ownerCookie;
  let waiterCookie;

  before(async function() {
    this.timeout(25000);
    await runMigrations();
    app = createApp();

    // Seed test users
    const ownerPinHash = await hashPin('8802');
    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
       VALUES ('102', 'V_DEFAULT', 'المالك التجريبي', 'R_OWNER', ?, 1, 0, NULL)`,
      [ownerPinHash]
    );

    const waiterPinHash = await hashPin('8808');
    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
       VALUES ('108', 'V_DEFAULT', 'ويتر الصالة', 'R_WAITER', ?, 1, 0, NULL)`,
      [waiterPinHash]
    );

    // Login Owner
    const ownerRes = await request(app).post('/api/auth/login').send({ pin: '8802' });
    ownerCookie = ownerRes.headers['set-cookie'];

    // Login Waiter
    const waiterRes = await request(app).post('/api/auth/login').send({ pin: '8808' });
    waiterCookie = waiterRes.headers['set-cookie'];
  });

  describe('1. Canonical Table State, Optimistic Concurrency & Revert Lifecycle', () => {
    it('should derive counters and cards from exact same server state', async () => {
      const res = await request(app)
        .get('/api/tables')
        .set('Cookie', waiterCookie);

      if (res.status !== 200) {
        console.error('TEST 1 ERROR BODY:', JSON.stringify(res.body, null, 2));
      }
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.stats, 'Stats must be present');
      assert.ok(Array.isArray(res.body.data.tables), 'Tables list must be an array');

      const stats = res.body.data.stats;
      const tables = res.body.data.tables;

      assert.strictEqual(stats.total, tables.length, 'Stats total must match tables array length');
      const calculatedVacant = tables.filter(t => t.status === 'AVAILABLE').length;
      assert.strictEqual(stats.available, calculatedVacant, 'Available stats count must match table items');
    });

    it('should open a table recording full audit metadata and incrementing version', async () => {
      // Ensure table 1 exists and is available
      await request(app)
        .post('/api/tables')
        .set('Cookie', ownerCookie)
        .send({ table_number: 1, capacity: 4, custom_name: 'طاولة 1 الرئيسية', zone: 'INDOOR_1' });

      // Ensure table 1 is reset to AVAILABLE
      await runQuery(`UPDATE tables SET status = 'AVAILABLE', customer_name = NULL, customer_phone = NULL, guest_count = 0 WHERE table_number = 1`);
      const initialTable = await getQuery(`SELECT version, status FROM tables WHERE table_number = 1`);
      const initialVersion = initialTable ? initialTable.version : 1;

      const openRes = await request(app)
        .post('/api/tables/open')
        .set('Cookie', waiterCookie)
        .send({
          table_number: 1,
          guest_count: 3,
          custom_name: 'VIP ركن العائلات',
          customer_name: 'عميل تجريبي',
          customer_phone: '01012345678',
          expected_version: initialVersion
        });

      assert.strictEqual(openRes.status, 200);
      assert.strictEqual(openRes.body.success, true);
      assert.strictEqual(openRes.body.data.status, 'OCCUPIED');
      assert.strictEqual(openRes.body.data.guest_count, 3);
      assert.strictEqual(openRes.body.data.version, initialVersion + 1);

      // Verify table_events row was appended
      const openEvent = await getQuery(
        `SELECT * FROM table_events WHERE table_number = 1 AND event_type = 'OPEN' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(openEvent, 'Table OPEN event must be recorded');
      assert.strictEqual(openEvent.guest_count, 3);
    });

    it('should reject concurrent table open/claim with mismatched version (Optimistic Concurrency)', async () => {
      // Table 1 is now OCCUPIED with version 2
      const res = await request(app)
        .post('/api/tables/open')
        .set('Cookie', waiterCookie)
        .send({
          table_number: 1,
          guest_count: 2,
          expected_version: 1 // Stale version
        });

      assert.strictEqual(res.status, 409, 'Must return 409 Conflict on version mismatch or non-available status');
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Optimistic') || res.body.error.includes('ليست متاحة') || res.body.code === 'CONCURRENCY_CONFLICT');
    });

    it('should revert opened table cleanly leaving no active order sessions or orphaned events', async () => {
      const revertRes = await request(app)
        .post('/api/tables/1/revert')
        .set('Cookie', waiterCookie)
        .send({ reason: 'العميل غادر قبل الطلب' });

      assert.strictEqual(revertRes.status, 200);
      assert.strictEqual(revertRes.body.success, true);
      assert.strictEqual(revertRes.body.data.status, 'AVAILABLE');

      // Verify no open table session remains
      const openSessions = await allQuery(`SELECT * FROM table_sessions WHERE table_number = 1 AND status = 'OPEN'`);
      assert.strictEqual(openSessions.length, 0, 'Must have zero open table sessions after revert');

      // Verify stale customer fields are sanitized
      const tableRecord = await getQuery(`SELECT * FROM tables WHERE table_number = 1`);
      assert.strictEqual(tableRecord.customer_name, null, 'Stale customer_name must be cleared');
      assert.strictEqual(tableRecord.customer_phone, null, 'Stale customer_phone must be cleared');
      assert.strictEqual(tableRecord.status, 'AVAILABLE');

      // Verify REVERTED event in table_events
      const revertEvent = await getQuery(
        `SELECT * FROM table_events WHERE table_number = 1 AND event_type = 'REVERTED' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(revertEvent, 'Table REVERTED event must exist in audit log');
    });
  });

  describe('2. Non-Intrusive Waiter Assistance Timers & Strict Deduplication', () => {
    before(async () => {
      // Clean up previous service requests for table 5
      await runQuery(`DELETE FROM service_requests WHERE table_id IN (SELECT CAST(id AS TEXT) FROM tables WHERE table_number = 5)`);

      // Seat table 5 and simulate 35-minute idle time
      await request(app)
        .post('/api/tables')
        .set('Cookie', ownerCookie)
        .send({ table_number: 5, capacity: 4, custom_name: 'طاولة تراس 5', zone: 'OUTDOOR_RIGHT' });

      await runQuery(`UPDATE tables SET status = 'AVAILABLE' WHERE table_number = 5`);

      await request(app)
        .post('/api/tables/open')
        .set('Cookie', waiterCookie)
        .send({ table_number: 5, guest_count: 2, custom_name: 'طاولة تراس 5' });

      // Backdate seated_at and created_at by 35 minutes
      await runQuery(
        `UPDATE tables 
         SET seated_at = datetime('now', '-35 minutes'),
             last_ordered_at = datetime('now', '-35 minutes')
         WHERE table_number = 5`
      );
    });

    it('should generate exactly one assistance task for table idle over 30 minutes', async () => {
      const res = await request(app)
        .get('/api/tables/assistance?threshold=30')
        .set('Cookie', waiterCookie);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const tasks = res.body.tasks || res.body.data.tasks;
      assert.ok(Array.isArray(tasks));

      const table5Task = tasks.find(t => t.table_number === 5);
      assert.ok(table5Task, 'Table 5 must have generated an assistance task');
      assert.ok(table5Task.context_notes && (table5Task.context_notes.includes('دقيقة') || table5Task.context_notes.includes('لم تسجل') || table5Task.context_notes.includes('طاولة')));
    });

    it('should NOT duplicate assistance task on repeated scans', async () => {
      // Run scan again immediately
      const scanAgainRes = await request(app)
        .get('/api/tables/assistance?threshold=30')
        .set('Cookie', waiterCookie);

      assert.strictEqual(scanAgainRes.status, 200);
      const tasks = scanAgainRes.body.tasks || scanAgainRes.body.data.tasks;
      const table5Tasks = tasks.filter(t => t.table_number === 5);

      assert.strictEqual(table5Tasks.length, 1, 'Repeating check must not duplicate active assistance tasks');
    });

    it('should allow waiter to acknowledge and complete assistance task', async () => {
      const activeTasks = await allQuery(`SELECT id FROM service_requests WHERE type = 'CUSTOMER_ASSISTANCE' AND status = 'PENDING'`);
      assert.ok(activeTasks.length > 0);
      const taskId = activeTasks[0].id;

      // Acknowledge
      const ackRes = await request(app)
        .post(`/api/tables/assistance/${taskId}/acknowledge`)
        .set('Cookie', waiterCookie)
        .send({});

      assert.strictEqual(ackRes.status, 200);
      assert.strictEqual(ackRes.body.data.status, 'ACKNOWLEDGED');

      // Complete
      const compRes = await request(app)
        .post(`/api/tables/assistance/${taskId}/complete`)
        .set('Cookie', waiterCookie)
        .send({ notes: 'تم تقديم الماء والاطمئنان على العميل بنجاح' });

      assert.strictEqual(compRes.status, 200);
      assert.strictEqual(compRes.body.data.status, 'COMPLETED');
    });
  });

  describe('3. Privacy-First CRM, Masking & Idempotent Loyalty Ledger', () => {
    let customerId;
    const testPhone = '010' + Math.floor(10000000 + Math.random() * 90000000);

    it('should create customer and mask phone number by default on standard GET', async () => {
      const createRes = await request(app)
        .post('/api/customers')
        .set('Cookie', waiterCookie)
        .send({
          name: 'سارة خالد',
          phone: testPhone,
          email: `sara.${Date.now()}@example.com`,
          preferences: { sugar: 'زيادة', seat: 'نافذة' }
        });

      assert.strictEqual(createRes.status, 200);
      customerId = createRes.body.data.customer.id;
      assert.ok(customerId);

      // Standard GET by Waiter
      const listRes = await request(app)
        .get('/api/customers')
        .set('Cookie', waiterCookie);

      assert.strictEqual(listRes.status, 200);
      const customers = listRes.body.customers || listRes.body.data.customers;
      const sara = customers.find(c => c.id === customerId);
      assert.ok(sara, 'Customer must be returned');
      assert.strictEqual(sara.is_masked, true);
      assert.strictEqual(sara.phone, testPhone.slice(0, 3) + '****' + testPhone.slice(-4), 'Phone must be masked by default');
    });

    it('should award loyalty points idempotently without double-crediting on retry', async () => {
      const refId = `SETTLE-INV-TEST-${Date.now()}`;

      // First award
      const award1 = await request(app)
        .post(`/api/customers/${customerId}/loyalty`)
        .set('Cookie', ownerCookie)
        .send({
          points: 50,
          reference_type: 'SETTLEMENT',
          reference_id: refId
        });

      assert.strictEqual(award1.status, 200);
      assert.strictEqual(award1.body.data.balance_points, 50);

      // Retry same reference
      const award2 = await request(app)
        .post(`/api/customers/${customerId}/loyalty`)
        .set('Cookie', ownerCookie)
        .send({
          points: 50,
          reference_type: 'SETTLEMENT',
          reference_id: refId
        });

      assert.strictEqual(award2.status, 200);
      assert.strictEqual(award2.body.data.balance_points, 50, 'Balance must remain 50 without double-crediting');

      // Verify loyalty_ledger has exactly 1 entry
      const ledgerRows = await allQuery(`SELECT * FROM loyalty_ledger WHERE customer_id = ? AND reference_id = ?`, [customerId, refId]);
      assert.strictEqual(ledgerRows.length, 1, 'Must have exactly 1 ledger record for reference');
    });
  });

  describe('4. Reservations Conflict Detection & Seating Lifecycle', () => {
    const today = new Date().toISOString().slice(0, 10);

    before(async () => {
      // Clean up previous reservations for table 3 on today
      await runQuery(`DELETE FROM reservations WHERE table_number = 3 AND reservation_date = ?`, [today]);
    });

    it('should detect table booking conflict for overlapping time window on the same table', async () => {
      // Create first reservation on table 3 from 19:00 for 90 mins (until 20:30)
      const res1 = await request(app)
        .post('/api/reservations')
        .set('Cookie', waiterCookie)
        .send({
          customer_name: 'كريم محمود',
          customer_phone: '01122334455',
          table_number: 3,
          reservation_date: today,
          reservation_time: '19:00',
          duration_minutes: 90,
          party_size: 4
        });

      assert.strictEqual(res1.status, 200);

      // Attempt conflicting reservation on table 3 at 20:00 (overlaps with 19:00 - 20:30)
      const res2 = await request(app)
        .post('/api/reservations')
        .set('Cookie', waiterCookie)
        .send({
          customer_name: 'طارق علي',
          customer_phone: '01223344556',
          table_number: 3,
          reservation_date: today,
          reservation_time: '20:00',
          duration_minutes: 60,
          party_size: 2
        });

      assert.strictEqual(res2.status, 409, 'Conflicting reservation must be rejected with 409');
      assert.strictEqual(res2.body.success, false);
      assert.ok(res2.body.error.includes('تعارض في الحجز') || res2.body.code === 'RESERVATION_CONFLICT');
    });

    it('should allow non-overlapping reservation on the same table', async () => {
      // Reservation at 21:00 (after 20:30)
      const resOk = await request(app)
        .post('/api/reservations')
        .set('Cookie', waiterCookie)
        .send({
          customer_name: 'ياسر إبراهيم',
          customer_phone: '01555555555',
          table_number: 3,
          reservation_date: today,
          reservation_time: '21:00',
          duration_minutes: 60,
          party_size: 2
        });

      assert.strictEqual(resOk.status, 200);
      assert.strictEqual(resOk.body.success, true);
    });
  });
});
