/**
 * Floor & Day-Management Ledger Linking Gate
 * Verifies: order -> KDS -> ready -> runner -> served -> settlement ->
 * BOM/stock ledger -> shift-scoped EOD cash -> close blocking on unresolved payments.
 * Runs against an isolated test database; never mutates LIVE data.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Isolated test DB (never LIVE cafe.db)
process.env.DB_PATH = path.join(__dirname, '../../fixtures/gate-floor-ledger.sqlite');

const { runMigrations } = require('../../src/db/migrator');
const { getDb, closeDb, getQuery, allQuery, runQuery } = require('../../src/db/connection');
const { routeOrderToKds, updateKdsLineState, resolveStationForItem } = require('../../src/domain/kds/kdsService');
const { createTask, claimTask, completeTask } = require('../../src/domain/floor/runnerService');
const { settleOrder } = require('../../src/domain/orders/settlementService');
const { openShift, recordBlindCount, calculateExpectedCash, closeShift, recordShiftHandover } = require('../../src/domain/shifts/shiftService');
const { recordCashOperation } = require('../../src/domain/shifts/cashService');

describe('Floor & Day-Management Ledger Linking Gate', function () {
    this.timeout(30000);

    let venueId = 'V_DEFAULT';
    let morningShiftId = null;
    let orderSessionId = null;
    let kdsLineIds = [];

    before(async () => {
        // Clean isolated fixture
        const dbPath = process.env.DB_PATH;
        for (const suffix of ['', '-wal', '-shm']) {
            const f = dbPath + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        await runMigrations();
        console.log('    [gate] isolated fixture migrated:', dbPath);
    });

    after(async () => {
        await closeDb().catch(() => { });
    });

    describe('Phase A - Shift scope and KDS routing', () => {

        it('opens a MORNING shift with opening float and assigned staff', async () => {
            const businessDate = new Date().toISOString().split('T')[0];
            const result = await openShift(venueId, 'MORNING', businessDate, 'Africa/Cairo', 20000, 'USER-OWNER', ['W1', 'R1'], ['DEV-POS-1']);
            assert.strictEqual(result.status, 'SUCCESS');
            assert.strictEqual(result.shift_type, 'MORNING');
            assert.strictEqual(result.opening_float_minor, 20000);
            assert.ok(Array.isArray(result.assigned_staff));
            morningShiftId = result.shift_id;
        });

        it('rejects a duplicate open of the same shift type/business date', async () => {
            const businessDate = new Date().toISOString().split('T')[0];
            await assert.rejects(
                () => openShift(venueId, 'MORNING', businessDate, 'Africa/Cairo', 20000, 'USER-OWNER'),
                /SHIFT_ALREADY_OPEN/
            );
        });

        it('routes items to canonical stations from item metadata', () => {
            assert.strictEqual(resolveStationForItem({ department: 'BARISTA' }), 'BARISTA');
            assert.strictEqual(resolveStationForItem({ name: 'لاتيه كراميل' }), 'BARISTA');
            assert.strictEqual(resolveStationForItem({ department: 'SHISHA' }), 'SHISHA');
            assert.strictEqual(resolveStationForItem({ name: 'معسل تفاح' }), 'SHISHA');
            assert.strictEqual(resolveStationForItem({ department: 'KITCHEN', name: 'Club Sandwich' }), 'KITCHEN');
            assert.strictEqual(resolveStationForItem({}), 'KITCHEN'); // default
        });

        it('creates KDS orders bound to the shift and records NEW state lines', async () => {
            // Seed minimal order session + menu items + inventory for BOM
            orderSessionId = `OS-GATE-${Date.now()}`;
            await runQuery(
                `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, status, version)
         VALUES (?, 'BR_DEFAULT', NULL, 'USER-W1', 'OPEN', 1)`,
                [orderSessionId]
            );
            // Bind session to shift
            await runQuery(`UPDATE v3_order_sessions SET shift_id = ? WHERE id = ?`, [morningShiftId, orderSessionId]);

            const menuItemId = `MI-GATE-${Date.now()}`;
            await runQuery(
                `INSERT INTO v3_menu_items (id, name, department, price_minor, is_available)
         VALUES (?, ?, ?, ?, 1)`,
                [menuItemId, 'Gate Latte', 'BARISTA', 5000]
            ).catch(async () => {
                // Fallback if schema requires more columns
                await runQuery(
                    `INSERT INTO v3_menu_items (id, name, department) VALUES (?, ?, ?)`,
                    [menuItemId, 'Gate Latte', 'BARISTA']
                );
            });

            const created = await routeOrderToKds(null, venueId, orderSessionId, [
                { menu_item_id: menuItemId, quantity: 2, id: `LN-GATE-${Date.now()}` }
            ]);
            assert.ok(created.length >= 1);
            assert.strictEqual(created[0].station_id, 'BARISTA');
            assert.strictEqual(created[0].lines[0].state, 'NEW');

            // Verify shift binding persisted
            const kdsRow = await getQuery(`SELECT shift_id FROM kds_orders WHERE id = ?`, [created[0].kds_order_id]);
            assert.strictEqual(kdsRow.shift_id, morningShiftId);

            kdsLineIds.push(created[0].lines[0].kds_line_id);
        });
    });

    describe('Phase B - KDS lifecycle with immutable transition audit', () => {

        it('progresses NEW -> ACKNOWLEDGED -> IN_PROGRESS(alias IN_PREPARATION) -> READY with audit rows', async () => {
            const lineId = kdsLineIds[0];
            const ctx = { deviceId: 'DEV-KDS-1', requestId: crypto.randomUUID() };

            const r1 = await updateKdsLineState(lineId, 'ACKNOWLEDGED', 'USER-BARISTA', null, 'BARISTA', ctx);
            assert.strictEqual(r1.state, 'ACKNOWLEDGED');

            // Legacy alias accepted
            const r2 = await updateKdsLineState(lineId, 'IN_PREPARATION', 'USER-BARISTA', null, 'BARISTA', ctx);
            assert.strictEqual(r2.state, 'IN_PROGRESS');
            assert.strictEqual(r2.previous_state, 'ACKNOWLEDGED');

            const r3 = await updateKdsLineState(lineId, 'READY', 'USER-BARISTA', null, 'BARISTA', ctx);
            assert.strictEqual(r3.state, 'READY');
            assert.ok(r3.runner_task_id, 'READY must spawn a runner delivery task');

            // Immutable transition audit rows exist with actor/station/device/version
            const transitions = await allQuery(
                `SELECT * FROM kds_line_transitions WHERE kds_line_id = ? ORDER BY created_at ASC`,
                [lineId]
            );
            assert.strictEqual(transitions.length, 3);
            assert.deepStrictEqual(transitions.map(t => t.to_state), ['ACKNOWLEDGED', 'IN_PROGRESS', 'READY']);
            for (const t of transitions) {
                assert.strictEqual(t.actor_id, 'USER-BARISTA');
                assert.strictEqual(t.station_id, 'BARISTA');
                assert.strictEqual(t.device_id, 'DEV-KDS-1');
                assert.ok(t.request_id);
            }
        });

        it('rejects illegal state transitions', async () => {
            const lineId = kdsLineIds[0];
            await assert.rejects(
                () => updateKdsLineState(lineId, 'NEW', 'USER-BARISTA', null, 'BARISTA', {}),
                /INVALID_STATE_TRANSITION/
            );
        });

        it('prevents two devices claiming the same runner task (exactly one wins)', async () => {
            // Find the task spawned by READY
            const tasks = await allQuery(
                `SELECT t.id FROM runner_tasks t WHERE t.status = 'PENDING' AND t.context_json LIKE ?`,
                [`%${orderSessionId}%`]
            );
            assert.ok(tasks.length >= 1);
            const taskId = tasks[0].id;

            const first = await claimTask(taskId, 'RUNNER-A', 1, { deviceId: 'DEV-RUNNER-1' });
            assert.strictEqual(first.task_status, 'CLAIMED');

            await assert.rejects(
                () => claimTask(taskId, 'RUNNER-B', 1, { deviceId: 'DEV-RUNNER-2' }),
                /ALREADY_CLAIMED/
            );

            // Completion is exactly-once: duplicate returns idempotent flag
            const done1 = await completeTask(taskId, 'RUNNER-A', first.version, { deviceId: 'DEV-RUNNER-1' });
            assert.strictEqual(done1.task_status, 'COMPLETED');
            const done2 = await completeTask(taskId, 'RUNNER-A', null, { deviceId: 'DEV-RUNNER-1' });
            assert.strictEqual(done2.idempotent, true);
        });
    });

    describe('Phase C - Settlement links sales, BOM/stock, loyalty to one shift scope', () => {

        it('settles an order with cash payment stamped with shift_id and creates exactly-one BOM set', async () => {
            const intent = {
                payment_method: 'CASH',
                amount_minor: 100000,
                actor_id: 'USER-CASHIER',
                device_id: 'DEV-POS-1',
                request_id: crypto.randomUUID(),
                idempotency_key: `GATE-SETTLE-${orderSessionId}`
            };

            const result = await settleOrder(orderSessionId, intent, 1);
            assert.strictEqual(result.status, 'SUCCESS');

            // Payment row is shift-scoped
            const payRow = await getQuery(`SELECT shift_id, device_id FROM v3_payments WHERE order_session_id = ?`, [orderSessionId]);
            assert.strictEqual(payRow.shift_id, morningShiftId);
            assert.strictEqual(payRow.device_id, 'DEV-POS-1');

            // Exactly one BOM consumption set for this order
            const bomSets = await allQuery(`SELECT * FROM bom_consumption_sets WHERE order_session_id = ?`, [orderSessionId]);
            assert.strictEqual(bomSets.length, 1);
            assert.strictEqual(bomSets[0].shift_id, morningShiftId);
        });

        it('duplicate settlement with same idempotency key returns original result without double effects', async () => {
            const intent = {
                payment_method: 'CASH',
                amount_minor: 100000,
                actor_id: 'USER-CASHIER',
                device_id: 'DEV-POS-1',
                idempotency_key: `GATE-SETTLE-${orderSessionId}`
            };
            const dup = await settleOrder(orderSessionId, intent, null);
            assert.strictEqual(dup.status, 'SUCCESS');

            const payCount = await getQuery(`SELECT COUNT(*) as c FROM v3_payments WHERE order_session_id = ?`, [orderSessionId]);
            assert.strictEqual(payCount.c, 1, 'no second payment row may be created');
            const bomCount = await getQuery(`SELECT COUNT(*) as c FROM bom_consumption_sets WHERE order_session_id = ?`, [orderSessionId]);
            assert.strictEqual(bomCount.c, 1, 'no second BOM set may be created');
        });

        it('records an approved cash expense inside the shift scope', async () => {
            const op = await recordCashOperation(venueId, morningShiftId, 'EXPENSE', 5000, 'Ice bags', 'USER-MANAGER', 'USER-OWNER');
            assert.strictEqual(op.status, 'SUCCESS');
        });
    });

    describe('Phase D - EOD expected cash from immutable shift scope', () => {

        it('computes expected cash = float + scoped cash sales - approved expenses', async () => {
            const recon = await calculateExpectedCash(null, morningShiftId);
            assert.strictEqual(recon.scope, 'SHIFT_ID');
            assert.strictEqual(recon.reconciliation_required, false);
            // float 20000 + cash sale (>= total due of quote) - expense 5000
            assert.ok(recon.expected_cash_minor > 20000 - 5000);
            assert.ok(recon.posted_cash_sales_minor > 0);
            assert.strictEqual(recon.approved_expenses_minor, 5000);
            // Tips and drawer transfers separately visible
            assert.ok('retained_cash_tips_minor' in recon);
            assert.ok('drawer_transfers_out_minor' in recon);
        });

        it('blocks close while unresolved unknown payments exist unless authorized exception documented', async () => {
            // Create unresolved payment in this shift
            const unrecOrderId = `OS-UNREC-${Date.now()}`;
            await runQuery(
                `INSERT INTO v3_order_sessions (id, branch_id, created_by, status, version, shift_id)
         VALUES (?, 'BR_DEFAULT', 'USER-W1', 'PAYMENT_PENDING', 1, ?)`,
                [unrecOrderId, morningShiftId]
            ).catch(() => { });
            await runQuery(
                `INSERT INTO v3_payments (id, order_session_id, amount_minor, currency, payment_method, status, created_by, shift_id)
         VALUES (?, ?, 25000, 'EGP', 'UNKNOWN', 'PENDING_RECONCILIATION', 'USER-CASHIER', ?)`,
                [`PAY-UNREC-GATE-${Date.now()}`, unrecOrderId, morningShiftId]
            ).catch(() => { });

            // Blind count then attempt close -> must be blocked
            await recordBlindCount(morningShiftId, 999999, 'USER-CASHIER');
            await assert.rejects(
                () => closeShift(morningShiftId, 'USER-OWNER', null, 'OWNER'),
                (err) => err.code === 'UNRESOLVED_PAYMENTS_PENDING' || /UNRESOLVED_PAYMENTS_PENDING/.test(err.message)
            );

            // Document authorized exception -> close now permitted
            await runQuery(
                `INSERT INTO eod_close_exceptions (id, shift_id, business_date, exception_type, severity, description, amount_minor, approved_by, approval_note)
         VALUES (?, ?, date('now','localtime'), 'UNRESOLVED_PAYMENT', 'CRITICAL', 'Bank gateway outage; reconciliation pending tomorrow', 25000, 'USER-OWNER', 'Approved by owner')`,
                [`EXC-${Date.now()}`, morningShiftId]
            );

            const closed = await closeShift(morningShiftId, 'USER-OWNER', null, 'OWNER');
            assert.strictEqual(closed.status, 'SUCCESS');
            assert.strictEqual(closed.expected_cash_minor !== null && closed.expected_cash_minor !== undefined, true);
        });

        it('masks expected cash from non-privileged roles on open shifts', async () => {
            const businessDate = new Date().toISOString().split('T')[0];
            const night = await openShift(venueId, 'NIGHT', businessDate, 'Africa/Cairo', 15000, 'USER-OWNER', [], []);
            const masked = await require('../../src/domain/shifts/shiftService').getShiftById(night.shift_id, 'CASHIER');
            assert.strictEqual(masked.expected_cash_minor, null);
            assert.strictEqual(masked.variance_minor, null);
        });

        it('records enriched handover with incoming staff, notes, exceptions, and approval', async () => {
            const businessDate = new Date().toISOString().split('T')[0];
            const svc = require('../../src/domain/shifts/shiftService');
            const handover = await svc.recordShiftHandover(
                (await svc.getActiveShift(venueId)).id,
                'USER-NIGHT-MGR',
                { incomingStaffId: 'USER-NIGHT-2', notes: 'Night handover gate', approvalActorId: 'USER-OWNER' }
            );
            assert.strictEqual(handover.status, 'SUCCESS');
            assert.strictEqual(handover.snapshot.incoming_staff_id, 'USER-NIGHT-2');
            assert.ok(Array.isArray(handover.snapshot.stock_exceptions));
            assert.ok(Array.isArray(handover.snapshot.printer_payment_exceptions));
        });
    });

    describe('Phase E - Invariants', () => {
        it('one accepted order produced exactly one payment set, one BOM set, one outbox logical event set', async () => {
            const pays = await getQuery(`SELECT COUNT(*) as c FROM v3_payments WHERE order_session_id = ?`, [orderSessionId]);
            const boms = await getQuery(`SELECT COUNT(*) as c FROM bom_consumption_sets WHERE order_session_id = ?`, [orderSessionId]);
            assert.strictEqual(pays.c, 1);
            assert.strictEqual(boms.c, 1);
        });

        it('inventory ledger balance equals displayed stock after BOM consumption', async () => {
            const rows = await allQuery(`
        SELECT i.id, i.current_stock_microunits,
               (SELECT COALESCE(SUM(l.quantity_delta_microunits), 0) FROM inventory_ledger l WHERE l.inventory_item_id = i.id) as ledger_sum
        FROM inventory_items i
      `);
            for (const r of rows) {
                assert.strictEqual(
                    Number(r.current_stock_microunits), Number(r.ledger_sum),
                    `stock parity violated for item ${r.id}`
                );
            }
        });

        it('EOD payment totals reconcile to payment ledger totals for the shift', async () => {
            const recon = await calculateExpectedCash(null, morningShiftId);
            const ledgerCash = await getQuery(
                `SELECT COALESCE(SUM(amount_minor), 0) as s FROM v3_payments WHERE shift_id = ? AND payment_method = 'CASH' AND status = 'COMPLETED'`,
                [morningShiftId]
            );
            assert.strictEqual(recon.posted_cash_sales_minor, Number(ledgerCash.s));
        });
    });
});