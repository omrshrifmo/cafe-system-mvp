const http = require('http');

const PORT = 3000;

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✅ ${message}`);
  }
}

async function runTestSuite() {
  console.log("==================================================");
  console.log("☕ كافيه مزاج - Enterprise ERP Architectural Overhaul Verification");
  console.log("==================================================");

  // 1. RBAC Login Verification
  console.log("\n[Test 1] Auth login for new 8-Role RBAC hierarchy...");
  const ownerAuth = await makeRequest('/api/auth/login', 'POST', { pin_code: '7777' });
  assert(ownerAuth.status === 200 && ownerAuth.data.user.role === 'OWNER', 'OWNER PIN login (7777) succeeded');

  const opMgrAuth = await makeRequest('/api/auth/login', 'POST', { pin_code: '6666' });
  assert(opMgrAuth.status === 200 && opMgrAuth.data.user.role === 'OP_MANAGER', 'OP_MANAGER PIN login (6666) succeeded');

  const cashierAuth = await makeRequest('/api/auth/login', 'POST', { pin_code: '5555' });
  assert(cashierAuth.status === 200 && cashierAuth.data.user.role === 'OP_ASSISTANT_CASHIER', 'OP_ASSISTANT_CASHIER PIN login (5555) succeeded');

  const waiterAuth = await makeRequest('/api/auth/login', 'POST', { pin_code: '4444' });
  assert(waiterAuth.status === 200 && waiterAuth.data.user.role === 'WAITER', 'WAITER PIN login (4444) succeeded');

  // 2. Strict Financial Privacy Verification
  console.log("\n[Test 2] Testing Financial Privacy on GET /api/reports/eod...");
  const blockedEod = await makeRequest('/api/reports/eod', 'GET', null, { 'x-user-role': 'OP_ASSISTANT_CASHIER' });
  assert(blockedEod.status === 403 && !blockedEod.data.success, 'OP_ASSISTANT_CASHIER correctly BLOCKED from viewing EOD reports (HTTP 403)');

  const allowedEod = await makeRequest('/api/reports/eod', 'GET', null, { 'x-user-role': 'OWNER' });
  assert(allowedEod.status === 200 && allowedEod.data.success, 'OWNER correctly GRANTED access to view EOD reports');

  // 3. Customizations & Waiter Tagging
  console.log("\n[Test 3] Order creation with Waiter Tagging & Modifiers...");
  const customOrder = await makeRequest('/api/orders', 'POST', {
    item_name: 'قهوة تركية',
    quantity: 2,
    table_number: 5,
    waiter_id: waiterAuth.data.user.id,
    sugar_level: 'زيادة',
    roast_type: 'محوج'
  });
  assert(customOrder.status === 201 && customOrder.data.success, 'Created order with modifiers & waiter_id');
  const orderId = customOrder.data.order.id;
  assert(customOrder.data.order.sugar_level === 'زيادة' && customOrder.data.order.roast_type === 'محوج', 'Modifiers saved in database');

  // 4. KDS 4-Lane State Machine Updates
  console.log("\n[Test 4] KDS 4-Lane State Machine transitions...");
  const statusAccepted = await makeRequest('/api/orders/kds-status', 'POST', { id: orderId, kds_status: 'ACCEPTED' });
  console.log('  statusAccepted response:', statusAccepted.status, statusAccepted.data);
  assert(statusAccepted.status === 200 && statusAccepted.data.order && statusAccepted.data.order.kds_status === 'ACCEPTED', 'KDS transition PENDING -> ACCEPTED');

  const statusReady = await makeRequest('/api/orders/kds-status', 'POST', { id: orderId, kds_status: 'READY' });
  assert(statusReady.status === 200 && statusReady.data.order.kds_status === 'READY', 'KDS transition ACCEPTED -> READY');

  // 5. Waiter-Barista Cancellation Handshake
  console.log("\n[Test 5] Waiter-Barista Cancellation Handshake...");
  const reqCancel = await makeRequest('/api/orders/request-cancel', 'POST', { id: orderId, waiter_id: waiterAuth.data.user.id, reason: 'طلب العميل تغيير الصنف' });
  assert(reqCancel.status === 200 && reqCancel.data.order.edit_request === 'CANCEL_REQUESTED', 'Waiter requested cancellation');

  const resolveCancel = await makeRequest('/api/orders/resolve-cancel', 'POST', { id: orderId, approved: false });
  assert(resolveCancel.status === 200 && resolveCancel.data.order && (resolveCancel.data.order.edit_request === null || resolveCancel.data.order.edit_request === undefined), 'Barista rejected cancellation handshake');

  // 6. Checkout & Paid Order Void Security
  console.log("\n[Test 6] Checkout & Paid Order Void Security (OWNER Only)...");
  const checkoutRes = await makeRequest('/api/checkout', 'POST', {
    table_number: 5,
    payments: [{ method: 'CASH', amount: 80 }],
    tip_amount: 10
  });
  assert(checkoutRes.status === 200 && checkoutRes.data.success, 'Checkout Table 5 completed');

  // OP_MANAGER attempts void paid order -> should fail
  const opMgrVoid = await makeRequest('/api/orders/void', 'POST', { order_id: orderId, manager_pin: '6666' });
  assert(opMgrVoid.status === 400 && !opMgrVoid.data.success, 'OP_MANAGER blocked from voiding paid order');

  // OWNER voids paid order -> should succeed
  const ownerVoid = await makeRequest('/api/orders/void', 'POST', { order_id: orderId, manager_pin: '7777' });
  assert(ownerVoid.status === 200 && ownerVoid.data.success && ownerVoid.data.voided_order.status === 'VOIDED', 'OWNER PIN successfully voided paid order & reversed revenue');

  // 7. Audit Log Trail Verification
  console.log("\n[Test 7] System Audit Log Trail Verification...");
  const auditsRes = await makeRequest('/api/audits');
  assert(auditsRes.status === 200 && auditsRes.data.success && Array.isArray(auditsRes.data.logs), 'Fetched system audit logs');
  assert(auditsRes.data.logs.length > 0, `Recorded ${auditsRes.data.logs.length} audit trail records`);

  // 8. Automated Payroll Engine & Penalties Verification
  console.log("\n[Test 8] Automated Payroll Engine & Penalties Verification...");
  const setRateRes = await makeRequest('/api/hr/hourly-rate', 'POST', { user_id: waiterAuth.data.user.id, hourly_rate: 50 });
  assert(setRateRes.status === 200 && setRateRes.data.success, 'Set waiter hourly rate to 50 EGP/hr');

  const logPenaltyRes = await makeRequest('/api/hr/penalties', 'POST', { user_id: waiterAuth.data.user.id, amount: 30, reason: 'تأخير 15 دقيقة عن الوردية' });
  assert(logPenaltyRes.status === 201 && logPenaltyRes.data.success, 'Logged 30 EGP penalty against waiter');

  const logAdvRes = await makeRequest('/api/hr/advances', 'POST', { employee_name: waiterAuth.data.user.name, amount: 20 });
  assert((logAdvRes.status === 200 || logAdvRes.status === 201) && logAdvRes.data.success, 'Logged 20 EGP advance for waiter');

  const payrollRes = await makeRequest('/api/hr/payroll', 'GET', null, { 'x-user-role': 'OWNER' });
  assert(payrollRes.status === 200 && payrollRes.data.success && Array.isArray(payrollRes.data.payroll), 'Fetched automated payroll report');
  
  const waiterPayroll = payrollRes.data.payroll.find(p => p.user_id === waiterAuth.data.user.id);
  assert(waiterPayroll && waiterPayroll.hourly_rate === 50, 'Waiter hourly rate matches saved value (50 EGP/hr)');
  assert(waiterPayroll.total_penalties >= 30, `Waiter penalties aggregated correctly (${waiterPayroll.total_penalties} EGP)`);
  assert(waiterPayroll.total_advances >= 20, `Waiter advances aggregated correctly (${waiterPayroll.total_advances} EGP)`);
  assert(waiterPayroll.net_salary === Math.round((waiterPayroll.base_salary - waiterPayroll.total_advances - waiterPayroll.total_penalties) * 100) / 100, 'Net salary math balances perfectly (Base - Advances - Penalties)');

  // 9. Quality Assurance & Complaints System Verification
  console.log("\n[Test 9] Quality Assurance & Complaints System Verification...");
  const logComplaintRes = await makeRequest('/api/qa/complaints', 'POST', {
    order_id: orderId,
    logged_by_user_id: ownerAuth.data.user.id,
    against_user_id: waiterAuth.data.user.id,
    severity: 'HIGH',
    description: 'تقديم طلب بارد وتأخير الخدمة'
  });
  assert(logComplaintRes.status === 201 && logComplaintRes.data.success, 'Logged HIGH severity QA complaint');
  const complaintId = logComplaintRes.data.complaint.id;

  const fetchComplaintsRes = await makeRequest('/api/qa/complaints');
  assert(fetchComplaintsRes.status === 200 && fetchComplaintsRes.data.success && Array.isArray(fetchComplaintsRes.data.complaints), 'Fetched QA complaints list');
  const loggedComplaint = fetchComplaintsRes.data.complaints.find(c => c.id === complaintId);
  assert(loggedComplaint && loggedComplaint.severity === 'HIGH' && loggedComplaint.status === 'OPEN', 'Logged complaint retrieved with HIGH severity and OPEN status');

  const resolveComplaintRes = await makeRequest('/api/qa/complaints/resolve', 'POST', { complaint_id: complaintId, user_id: ownerAuth.data.user.id });
  assert(resolveComplaintRes.status === 200 && resolveComplaintRes.data.success && resolveComplaintRes.data.status === 'RESOLVED', 'QA Complaint resolved successfully');

  // ==================================================
  // 10. Table Lifecycle & Customer Management Engine
  // ==================================================
  console.log("\n--- Testing Suite 10: Table Lifecycle & Customer Management Engine ---");

  // 1. Fetch default tables (1-12)
  const fetchTablesRes = await makeRequest('/api/tables');
  console.log('fetchTablesRes response:', fetchTablesRes.status, fetchTablesRes.data);
  assert(fetchTablesRes.status === 200 && fetchTablesRes.data.success && Array.isArray(fetchTablesRes.data.tables), 'Fetched tables list');
  assert(fetchTablesRes.data.tables.length === 12, '12 default seeded tables exist');
  
  // 2. Seat Table 1 with custom name & customer contact
  const seatRes = await makeRequest('/api/tables/seat', 'POST', {
    table_number: 1,
    custom_name: 'VIP Corner',
    customer_name: 'أحمد محمود',
    customer_phone: '01012345678'
  });
  assert(seatRes.status === 200 && seatRes.data.success, 'Seated Table 1 with custom name & contact');

  // 3. Verify Table 1 status updated to SEATED
  const verifySeatedRes = await makeRequest('/api/tables');
  const table1 = verifySeatedRes.data.tables.find(t => t.table_number === 1);
  assert(table1 && table1.status === 'SEATED' && table1.custom_name === 'VIP Corner' && table1.customer_name === 'أحمد محمود', 'Table 1 is SEATED with custom details');

  // 4. Place order on Table 1
  const orderRes = await makeRequest('/api/orders', 'POST', {
    item_name: 'لاتيه',
    quantity: 2,
    price: 50,
    table_number: 1,
    waiter_id: waiterAuth.data.user.id
  });
  assert(orderRes.status === 201 && orderRes.data.success, 'Placed order on Table 1');

  // 5. Request Check for Table 1
  const checkRes = await makeRequest('/api/tables/request-check', 'POST', { table_number: 1 });
  assert(checkRes.status === 200 && checkRes.data.success, 'Requested check for Table 1');

  const verifyCheckRes = await makeRequest('/api/tables');
  const table1Check = verifyCheckRes.data.tables.find(t => t.table_number === 1);
  assert(table1Check && table1Check.status === 'CHECK_REQUESTED', 'Table 1 status updated to CHECK_REQUESTED');

  // 6. Checkout Table 1 (Pay 150 EGP with 200 EGP cash -> 50 EGP change)
  const tblCheckoutRes = await makeRequest('/api/checkout', 'POST', {
    order_id: orderRes.data.order.id,
    table_number: 1,
    payments: [{ method: 'CASH', amount: 200 }],
    customer_phone: '01012345678',
    points_redeemed: 0,
    tip_amount: 10
  });
  assert(tblCheckoutRes.status === 200 && tblCheckoutRes.data.success, 'Completed checkout for Table 1');

  const verifyPaidRes = await makeRequest('/api/tables');
  const table1Paid = verifyPaidRes.data.tables.find(t => t.table_number === 1);
  assert(table1Paid && table1Paid.status === 'PAID', 'Table 1 status updated to PAID');

  // 7. Vacate Table 1 (Guest Departs)
  const vacateRes = await makeRequest('/api/tables/vacate', 'POST', { table_number: 1 });
  assert(vacateRes.status === 200 && vacateRes.data.success, 'Vacated Table 1');

  const verifyVacantRes = await makeRequest('/api/tables');
  const table1Vacant = verifyVacantRes.data.tables.find(t => t.table_number === 1);
  assert(table1Vacant && table1Vacant.status === 'VACANT' && table1Vacant.custom_name === null, 'Table 1 status reset to VACANT');

  console.log("\n==================================================");
  console.log("🎉 ALL AUTOMATED TEST SUITES (1-10) PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runTestSuite().catch(err => {
  console.error("Test Suite execution error:", err);
  process.exit(1);
});
