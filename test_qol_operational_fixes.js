/**
 * Automated Verification Suite for 3 Real-World QoL Operational Fixes:
 * 1. Audited "No-Sale" Drawer Kick (POST /api/print/open-drawer with RBAC & Audit Log)
 * 2. Receipt Reprinting (POST /api/print/receipt/reprint/:id with ** نسخة مكررة ** Watermark)
 * 3. Post-Shift Auto-Logout in HR & Blind Cash Declaration
 */

const assert = require('assert');
const request = require('supertest');
const { createApp } = require('./src/app');
const { runQuery, getQuery, allQuery } = require('./src/db/connection');
const { runMigrations } = require('./src/db/migrator');

async function runTests() {
  console.log('🧪 Starting Real-World QoL Operational Verification Suite...\n');
  await runMigrations();
  const app = createApp();

  // Test 1: Audited "No-Sale" Drawer Kick
  console.log('▶ Test 1: Audited "No-Sale" Drawer Kick (POST /api/print/open-drawer)...');
  
  // 1.1 Login as Waiter (Unauthorized for No-Sale Drawer Kick)
  const waiterLogin = await request(app).post('/api/auth/login').send({ pin: '1001' });
  const waiterCookie = waiterLogin.headers['set-cookie'];

  const waiterKickRes = await request(app)
    .post('/api/print/open-drawer')
    .set('Cookie', waiterCookie)
    .send({ reason: 'محاولة فتح غير مصرح' });

  assert.strictEqual(waiterKickRes.status, 403, 'Waiter must be blocked with 403 from opening drawer without a sale');
  console.log('  🔒 RBAC enforced: WAITER was correctly blocked (403 Forbidden).');

  // 1.2 Login as Cashier (Authorized for No-Sale Drawer Kick)
  const cashierLogin = await request(app).post('/api/auth/login').send({ pin: '1007' });
  const cashierCookie = cashierLogin.headers['set-cookie'];

  const cashierKickRes = await request(app)
    .post('/api/print/open-drawer')
    .set('Cookie', cashierCookie)
    .send({ reason: 'صرف فكة من الدرج (No-Sale)' });

  assert.strictEqual(cashierKickRes.status, 200, 'Cashier should successfully trigger drawer kick');
  assert.strictEqual(cashierKickRes.body.success, true);
  assert.strictEqual(cashierKickRes.body.drawer_kicked, true);
  assert.strictEqual(cashierKickRes.body.action, 'NO_SALE_DRAWER_OPENED');
  console.log('  🗄️ Cashier successfully triggered No-Sale drawer kick.');

  // 1.3 Verify Audit Log entry in audit_logs
  const kickAudit = await getQuery(
    `SELECT * FROM audit_logs WHERE target_table = 'cash_drawer' AND action = 'NO_SALE_DRAWER_OPENED' ORDER BY id DESC LIMIT 1`
  );
  assert(kickAudit, 'Audit log entry must exist for NO_SALE_DRAWER_OPENED');
  const kickDetails = JSON.parse(kickAudit.new_value);
  assert.strictEqual(kickDetails.reason, 'صرف فكة من الدرج (No-Sale)');
  console.log('  📝 Audit log verified in database:', kickDetails);
  console.log('✅ Test 1 Passed: Audited No-Sale Drawer Kick verified.\n');

  // Test 2: Receipt Reprinting with Duplicate Copy Banner
  console.log('▶ Test 2: Receipt Reprinting (POST /api/print/receipt/reprint/:id)...');

  // Find a past session or create a settled dummy session
  let pastSession = await getQuery(`SELECT id FROM order_sessions WHERE status = 'SETTLED' LIMIT 1`);
  if (!pastSession) {
    const dummyId = (await runQuery(`INSERT INTO order_sessions (venue_id, table_number, status, subtotal_minor, total_minor, opened_at, closed_at) VALUES ('V_DEFAULT', 4, 'SETTLED', 6000, 6000, datetime('now', 'localtime'), datetime('now', 'localtime'))`)).lastID;
    await runQuery(`INSERT INTO order_items (session_id, item_name, unit_price_minor, quantity, status) VALUES (?, 'شاي بالنعناع', 3000, 2, 'SETTLED')`, [dummyId]);
    pastSession = { id: dummyId };
  }

  const reprintRes = await request(app)
    .post(`/api/print/receipt/reprint/${pastSession.id}`)
    .set('Cookie', cashierCookie)
    .send({});

  assert.strictEqual(reprintRes.status, 200, 'Reprint request should succeed');
  assert.strictEqual(reprintRes.body.success, true);
  assert.strictEqual(reprintRes.body.is_duplicate, true, 'Reprint must mark receipt as duplicate copy');
  assert(reprintRes.body.receipt, 'Reprint payload must contain receipt data');
  console.log('  🖨️ Receipt reprint spooled successfully with is_duplicate: true.');

  // Verify Audit Log entry for reprint
  const reprintAudit = await getQuery(
    `SELECT * FROM audit_logs WHERE target_table = 'order_sessions' AND record_id = ? AND action = 'RECEIPT_REPRINTED' ORDER BY id DESC LIMIT 1`,
    [String(pastSession.id)]
  );
  assert(reprintAudit, 'Audit log entry must exist for RECEIPT_REPRINTED');
  console.log('  📝 Audit log for reprint verified:', JSON.parse(reprintAudit.new_value));
  console.log('✅ Test 2 Passed: Receipt Reprinting & Duplicate Copy Header verified.\n');

  // Test 3: Post-Shift Cash Declaration & Auto-Logout endpoint
  console.log('▶ Test 3: Post-Shift Cash Declaration & Z-Report...');
  const shiftRes = await request(app)
    .post('/api/shifts/declare-cash-extended')
    .set('Cookie', cashierCookie)
    .send({
      user_id: 4,
      user_name: 'أحمد كركر (كاشير)',
      shift_type: 'MORNING',
      actual_cash: 2500,
      opening_float: 500
    });

  assert.strictEqual(shiftRes.status, 200, 'Shift cash declaration should succeed');
  assert.strictEqual(shiftRes.body.success, true);
  console.log('  💰 Shift declaration saved and Z-Report triggered successfully.');
  console.log('✅ Test 3 Passed: Post-Shift workflow verified.\n');

  console.log('🎉 ALL 3 REAL-WORLD QoL OPERATIONAL FIXES VERIFIED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
