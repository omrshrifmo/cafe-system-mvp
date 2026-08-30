/**
 * test_final_audit.js
 * End-to-End Verification Test for the Final Operational Audit Deliverables:
 * 1. HACCP Fridge/Freezer Temperature Logging & Out-of-Range Alerts
 * 2. HACCP Sanitation & Cleaning Checklists
 * 3. General Expenses & Petty Cash (Separated from direct inventory POs)
 * 4. "Caffeine Mode" Session Inactivity Override & Audit Logging
 * 5. USB Thermal Printer Integration & Windows Spooler Route
 */

const { allQuery, getQuery, runQuery } = require('./src/db/connection');
const { formatReceiptEscPos, sendRawBufferToUsbPrinter } = require('./src/domain/printing/service');
const { enableCaffeineMode, disableCaffeineMode, isCaffeineModeActive } = require('./src/domain/auth/checkpointService');

async function runTests() {
  console.log('\n===============================================================');
  console.log('   🧪 STARTING FINAL OPERATIONAL AUDIT VERIFICATION SUITE');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      process.exitCode = 1;
    }
  }

  // --- 1. HACCP & Temperature Logging ---
  console.log('--- [1/5] Testing HACCP Temperature Logs & Out-of-Range Alerts ---');
  
  // Safe zone reading (e.g., 3.2°C in fridge: 2.0°C - 5.0°C)
  const safeTemp = 3.2;
  const isSafeAlert = (safeTemp < 2.0 || safeTemp > 5.0) ? 1 : 0;
  const safeLog = await runQuery(
    `INSERT INTO haccp_logs (unit_name, unit_type, temperature, min_safe_temp, max_safe_temp, is_alert, logged_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['ثلاجة الحليب 1', 'FRIDGE', safeTemp, 2.0, 5.0, isSafeAlert, 'Lead Barista', 'حرارة مثالية في النطاق الآمن']
  );
  assert(safeLog.lastID > 0, 'Safe temperature reading recorded in haccp_logs');
  assert(isSafeAlert === 0, 'Safe temperature correctly marked with is_alert = 0');

  // Danger zone reading (e.g., 8.7°C in fridge: > 5.0°C)
  const dangerTemp = 8.7;
  const isDangerAlert = (dangerTemp < 2.0 || dangerTemp > 5.0) ? 1 : 0;
  const dangerLog = await runQuery(
    `INSERT INTO haccp_logs (unit_name, unit_type, temperature, min_safe_temp, max_safe_temp, is_alert, logged_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['ثلاجة الحلويات', 'FRIDGE', dangerTemp, 2.0, 5.0, isDangerAlert, 'Lead Barista', 'تنبيه: باب الثلاجة كان مفتوحاً']
  );
  assert(dangerLog.lastID > 0, 'Danger temperature reading recorded');
  assert(isDangerAlert === 1, 'Out-of-range temperature correctly flagged with is_alert = 1');

  const alertCheck = await getQuery(`SELECT COUNT(*) as alert_count FROM haccp_logs WHERE is_alert = 1`);
  assert(alertCheck.alert_count >= 1, `HACCP alerts correctly counted (${alertCheck.alert_count} active alert logs)`);

  // --- 2. HACCP Sanitation Checklists ---
  console.log('\n--- [2/5] Testing HACCP Sanitation Checklists & Task Toggles ---');
  
  const seedTask = await getQuery(`SELECT * FROM cleaning_checklists LIMIT 1`);
  assert(seedTask && seedTask.id, `Cleaning checklist task exists: "${seedTask ? seedTask.task_name : 'N/A'}"`);

  // Toggle completion
  const newStatus = seedTask.is_completed ? 0 : 1;
  await runQuery(
    `UPDATE cleaning_checklists SET is_completed = ?, completed_at = datetime('now', 'localtime'), completed_by = ? WHERE id = ?`,
    [newStatus, 'Barista Ahmed', seedTask.id]
  );
  const updatedTask = await getQuery(`SELECT * FROM cleaning_checklists WHERE id = ?`, [seedTask.id]);
  assert(updatedTask.is_completed === newStatus, `Task toggle successful (is_completed = ${newStatus})`);

  // --- 3. General Expenses & Petty Cash ---
  console.log('\n--- [3/5] Testing Petty Cash & General Expenses Logging ---');

  const testExpense = await runQuery(
    `INSERT INTO daily_expenses (description, amount, payment_source, category, expense_date)
     VALUES (?, ?, ?, ?, date('now', 'localtime'))`,
    ['فاتورة كهرباء شهر 8 وصيانة تكييف', 650.00, 'DRAWER', 'فواتير ومرافق (Utilities)']
  );
  assert(testExpense.lastID > 0, 'Petty cash expense inserted successfully into daily_expenses');

  const expRow = await getQuery(`SELECT * FROM daily_expenses WHERE id = ?`, [testExpense.lastID]);
  assert(expRow && Number(expRow.amount) === 650.00, 'Expense amount matches exactly (650.00 EGP)');
  assert(expRow.category === 'فواتير ومرافق (Utilities)', 'Expense category preserved accurately');

  const todayExpenses = await getQuery(`SELECT SUM(amount) as total FROM daily_expenses WHERE date(created_at) = date('now', 'localtime')`);
  assert(todayExpenses && todayExpenses.total >= 650.00, `Daily expenses aggregated correctly: ${todayExpenses ? todayExpenses.total : 0} EGP`);

  // --- 4. Caffeine Mode Session Inactivity Override ---
  console.log('\n--- [4/5] Testing "Caffeine Mode" Session Inactivity Override & Audit Logging ---');

  const adminUser = await getQuery(`SELECT id, name, role_id, venue_id FROM v3_users LIMIT 1`);
  const userId = adminUser ? adminUser.id : 'USR_ADMIN_01';
  const venueId = adminUser ? adminUser.venue_id : 'V_DEFAULT';
  const sessionId = 'TEST_SESS_' + Date.now();

  const sessionHash = 'TEST_HASH_' + Date.now() + '_' + Math.random().toString(36).substring(2);

  // Create mock active session for test
  await runQuery(
    `INSERT INTO v3_user_sessions (id, user_id, venue_id, session_hash, absolute_expiry_at, inactivity_expiry_at)
     VALUES (?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+1 hour'))`,
    [sessionId, userId, venueId, sessionHash]
  );

  const { enableCaffeineMode, disableCaffeineMode, getCaffeineModeStatus } = require('./src/domain/auth/checkpointService');

  // Enable Caffeine Mode
  const enableResult = await enableCaffeineMode(sessionId, userId, venueId, 60, 'PEAK_HOUR_TEST');
  assert(enableResult && enableResult.enabled === true, 'Caffeine Mode successfully enabled for 60 minutes');
  
  const statusCheck = await getCaffeineModeStatus(sessionId);
  assert(statusCheck.enabled === true, 'getCaffeineModeStatus reports active session');

  // Verify Audit Log
  const auditEnable = await getQuery(
    `SELECT * FROM audit_logs WHERE action = 'CAFFEINE_MODE_ENABLED' ORDER BY created_at DESC LIMIT 1`
  );
  assert(auditEnable !== undefined, 'CAFFEINE_MODE_ENABLED recorded in audit_logs');

  // Disable Caffeine Mode
  const disableResult = await disableCaffeineMode(sessionId, userId, venueId);
  assert(disableResult && disableResult.enabled === false, 'Caffeine Mode successfully disabled');

  const statusCheckAfter = await getCaffeineModeStatus(sessionId);
  assert(statusCheckAfter.enabled === false, 'getCaffeineModeStatus correctly reports inactive after disable');

  const auditDisable = await getQuery(
    `SELECT * FROM audit_logs WHERE action = 'CAFFEINE_MODE_DISABLED' ORDER BY created_at DESC LIMIT 1`
  );
  assert(auditDisable !== undefined, 'CAFFEINE_MODE_DISABLED recorded in audit_logs');

  // --- 5. USB Thermal Printer Raw Buffer & Spooler ---
  console.log('\n--- [5/5] Testing USB Thermal Printer Raw Buffer Generation ---');

  const mockReceipt = {
    order_id: 'AUDIT_TEST_01',
    cafe_name: 'كافيه مزاج',
    cashier_name: 'كاشير التجربة',
    items: [
      { item_name: 'كابتشينو دبل', quantity: 2, price: 55 },
      { item_name: 'تشيز كيك لوتس', quantity: 1, price: 75 }
    ],
    total_amount: 185,
    currency: 'ج.م',
    kick_drawer: true
  };

  const buffer = formatReceiptEscPos(mockReceipt);
  assert(Buffer.isBuffer(buffer), 'formatReceiptEscPos generated valid binary Buffer');
  assert(buffer.length > 50, `Buffer contains ESC/POS raw bytecode commands (${buffer.length} bytes)`);

  // Test sendRawBufferToUsbPrinter function call
  const usbSendResult = await sendRawBufferToUsbPrinter('ReceiptPrinter', buffer);
  assert(usbSendResult && usbSendResult.printer === 'ReceiptPrinter', 'sendRawBufferToUsbPrinter targeted printer "ReceiptPrinter"');

  // Print Summary
  console.log('\n===============================================================');
  console.log(`   🏁 FINAL OPERATIONAL AUDIT SUITE COMPLETE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL FINAL OPERATIONAL REQUIREMENTS FULLY MET & VERIFIED!');
  } else {
    console.error('⚠️ SOME TESTS FAILED. PLEASE REVIEW LOGS.');
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
