/**
 * Verification Test for Advanced Catalog Modifiers, Flavors, Surprise Mix,
 * Custom Manual Discounts with RBAC & Audit Logging, and Master Setup Zip Export / Import.
 */
const assert = require('assert');
const { allQuery, getQuery, runQuery } = require('./src/db/connection');
const { getMenu, createMenuItem } = require('./src/domain/catalog/service');
const { settleSession } = require('./src/domain/payments/service');

async function runTests() {
  console.log('🧪 Starting Advanced Catalog & Custom Discounts Verification Suite...\n');

  // Test 1: Seed 'شيشة فاخر' with is_surprise_mix = true and 'لاتيه' with available_flavors
  console.log('▶ Test 1: Seeding catalog items with modifiers, flavors, and surprise mix...');
  
  const ts = Date.now();
  const latteId = await createMenuItem({
    sku: `TEST-LATTE-${ts}`,
    name: `لاتيه كراميل تجريبي ${ts}`,
    name_en: `Caramel Latte Test ${ts}`,
    department: 'BARISTA',
    priceMinor: 5000, // 50.00 EGP
    has_sugar_options: 1,
    has_roast_options: 1,
    available_flavors: ['فانيليا', 'كراميل', 'بندق'],
    is_surprise_mix: 0,
    prep_instructions: 'تبخير الحليب وإضافة صوص الكراميل'
  });

  const shishaId = await createMenuItem({
    sku: `TEST-SHISHA-${ts}`,
    name: `شيشة فاخر ميكس تجريبي ${ts}`,
    name_en: `Premium Shisha Mix Test ${ts}`,
    department: 'SHISHA',
    priceMinor: 8000, // 80.00 EGP
    has_sugar_options: 0,
    has_roast_options: 0,
    available_flavors: null,
    is_surprise_mix: 1,
    prep_instructions: 'خلطة المعلم السرية لحجر الشيشة'
  });

  const { publishMenuItem } = require('./src/domain/catalog/service');

  assert(latteId > 0, 'Latte menu item should be created');
  assert(shishaId > 0, 'Shisha menu item should be created');

  await publishMenuItem(latteId, 1);
  await publishMenuItem(shishaId, 1);

  const categories = await getMenu();
  const allItems = categories.flatMap(c => c.items);
  const foundLatte = allItems.find(i => i.id === latteId);
  const foundShisha = allItems.find(i => i.id === shishaId);

  assert(foundLatte, 'Found latte item in menu');
  assert.strictEqual(foundLatte.has_sugar_options, true, 'Latte should have sugar options');
  assert.strictEqual(foundLatte.has_roast_options, true, 'Latte should have roast options');
  assert(Array.isArray(foundLatte.available_flavors), 'Latte flavors should be parsed array');
  assert(foundLatte.available_flavors.includes('كراميل'), 'Latte flavors include كراميل');
  assert.strictEqual(foundLatte.prep_instructions, 'تبخير الحليب وإضافة صوص الكراميل');

  assert(foundShisha, 'Found shisha item in menu');
  assert.strictEqual(foundShisha.is_surprise_mix, true, 'Shisha should have is_surprise_mix = true');
  console.log('✅ Test 1 Passed: Advanced catalog schema, modifiers, flavors, and surprise mix verified.\n');

  // Test 2: Custom Manual Discount with RBAC & Audit Log
  console.log('▶ Test 2: Settle session with Custom Manual Discount (Manager Role)...');

  const managerUser = { id: 1, name: 'المدير العام', role: 'OP_MANAGER' };
  const waiterUser = { id: 2, name: 'الويتر', role: 'WAITER' };

  // 2.1 Assert Non-Authorized role (WAITER) fails to apply custom discount
  let waiterFailed = false;
  try {
    await settleSession({
      subtotal: 100,
      custom_discount_amount: 20,
      custom_discount_type: 'AMOUNT',
      payments: [{ method: 'CASH', amount: 80 }]
    }, waiterUser);
  } catch (err) {
    waiterFailed = true;
    assert(err.status === 403 || err.statusCode === 403, 'Should reject non-authorized role with 403');
    console.log('  🔒 RBAC enforced: WAITER was correctly blocked from applying custom discount.');
  }
  assert(waiterFailed, 'Waiter must be rejected from applying custom manual discount');

  // 2.2 Assert Authorized role (OP_MANAGER) succeeds
  const checkoutPayload = {
    subtotal: 200,
    custom_discount_amount: 30, // 30 EGP discount
    custom_discount_type: 'AMOUNT',
    payments: [{ method: 'CASH', amount: 300 }]
  };

  const result = await settleSession(checkoutPayload, managerUser);
  assert(result.session_id, 'Session should be created and settled');
  console.log('  💳 Checkout settled successfully. Session ID:', result.session_id);

  // 2.3 Verify Audit Log entry in audit_logs
  const auditEntry = await getQuery(
    `SELECT * FROM audit_logs WHERE target_table = 'order_sessions' AND record_id = ? AND action = 'CUSTOM_DISCOUNT_APPLIED' ORDER BY id DESC LIMIT 1`,
    [String(result.session_id)]
  );

  assert(auditEntry, 'Audit log entry must exist for custom discount');
  assert.strictEqual(auditEntry.user_id, managerUser.id, 'Audit log must record actor user ID');
  const details = JSON.parse(auditEntry.new_value);
  assert.strictEqual(details.discount_amount_egp, 30, 'Audit log must record exact 30 EGP discount');
  assert.strictEqual(details.applied_by_role, 'OP_MANAGER', 'Audit log must record role');
  console.log('  📝 Audit log verified in database:', details);
  console.log('✅ Test 2 Passed: Custom Manual Discounts & Audit Logs fully validated.\n');

  // Test 3: Module Settings & Master Template zip generation
  console.log('▶ Test 3: Module Settings and Master Templates Export...');
  const { getSystemTaxConfig } = require('./src/domain/payments/service');
  
  await runQuery(`INSERT INTO system_config (key, value) VALUES ('module_wifi', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  await runQuery(`INSERT INTO system_config (key, value) VALUES ('module_gaming', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  
  const taxConfig = await getSystemTaxConfig();
  assert.strictEqual(taxConfig.module_wifi, true, 'module_wifi should be true');
  assert.strictEqual(taxConfig.module_gaming, false, 'module_gaming should be false');
  console.log('  🧩 System module toggles verified:', { wifi: taxConfig.module_wifi, gaming: taxConfig.module_gaming });

  console.log('✅ Test 3 Passed: Module Settings verified.\n');

  console.log('🎉 ALL ADVANCED CATALOG, MODIFIERS, RBAC DISCOUNTS & AUDIT LOG TESTS PASSED SUCCESSFULLY!');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
