/**
 * Staff Shifts, Clock-in/out, Z-Reports & Payroll Domain Service
 */
const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');

async function clockInUser(userId, shiftType = 'MORNING') {
  const user = await getQuery(`SELECT id, name, role FROM users WHERE id = ?`, [userId]);
  if (!user) throw new Error('المستخدم غير موجود');

  // Check if already active
  const active = await getQuery(`SELECT * FROM shifts WHERE user_id = ? AND status = 'ACTIVE'`, [userId]);
  if (active) {
    return { success: true, message: 'الوردية مسجلة ونشطة بالفعل', shift: active };
  }

  const res = await runQuery(
    `INSERT INTO shifts (user_id, user_name, role, shift_type, clock_in, status)
     VALUES (?, ?, ?, ?, datetime('now', 'localtime'), 'ACTIVE')`,
    [user.id, user.name, user.role, shiftType]
  );

  return {
    success: true,
    message: 'تم تسجيل الحضور وبدء الوردية بنجاح ⏰',
    shift: {
      id: res.lastID,
      user_id: user.id,
      user_name: user.name,
      shift_type: shiftType,
      clock_in: new Date().toISOString()
    }
  };
}

async function clockOutUser(userId) {
  const active = await getQuery(`SELECT * FROM shifts WHERE user_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`, [userId]);
  if (!active) {
    throw new Error('لا توجد وردية نشطة حالياً لهذا المستخدم');
  }

  await runQuery(
    `UPDATE shifts SET clock_out = datetime('now', 'localtime'), status = 'COMPLETED' WHERE id = ?`,
    [active.id]
  );

  return {
    success: true,
    message: 'تم تسجيل الانصراف وإغلاق الوردية ⏱️',
    shift_id: active.id
  };
}

async function getUserShiftReport(userId, shiftType = 'MORNING') {
  const user = await getQuery(`SELECT id, name, role FROM users WHERE id = ?`, [userId]);
  if (!user) throw new Error('المستخدم غير موجود');

  // Fetch today's latest shift clock-in
  const shiftRow = await getQuery(
    `SELECT id, clock_in, clock_out, shift_type FROM shifts 
     WHERE user_id = ? AND date(clock_in) = date('now', 'localtime') 
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  const clockInTime = shiftRow ? shiftRow.clock_in : (new Date().toISOString().split('T')[0] + ' 00:00:00');
  const clockOutTime = shiftRow ? shiftRow.clock_out : null;
  const activeShift = shiftType || (shiftRow ? shiftRow.shift_type : 'MORNING');

  // Aggregate cash & digital sales for orders created/handled by this user since clock-in
  const salesRow = await getQuery(
    `SELECT 
       COALESCE(SUM(CASE WHEN p.method = 'CASH' THEN p.amount_minor ELSE 0 END), 0) / 100.0 as cash_sales,
       COALESCE(SUM(CASE WHEN p.method != 'CASH' THEN p.amount_minor ELSE 0 END), 0) / 100.0 as digital_sales,
       COALESCE(SUM(p.amount_minor), 0) / 100.0 as total_sales,
       COALESCE(SUM(p.tip_minor), 0) / 100.0 as total_tips,
       COUNT(DISTINCT p.session_id) as order_count
     FROM payments p
     JOIN order_sessions os ON p.session_id = os.id
     WHERE (os.created_by = ? OR p.created_by = ?)
       AND p.created_at >= ?`,
    [userId, userId, clockInTime]
  );

  const cashSales = salesRow ? salesRow.cash_sales : 0;
  const digitalSales = salesRow ? salesRow.digital_sales : 0;
  const totalSales = salesRow ? salesRow.total_sales : 0;
  const totalTips = salesRow ? salesRow.total_tips : 0;
  const orderCount = salesRow ? salesRow.order_count : 0;

  // Advances logged for this employee today
  const advRow = await getQuery(
    `SELECT COALESCE(SUM(amount), 0) as total_advances 
     FROM employee_advances 
     WHERE (employee_name = ? OR employee_id = ?) AND date(issued_at) = date('now', 'localtime')`,
    [user.name, userId]
  );
  const cashAdvances = advRow ? advRow.total_advances : 0;

  // Daily expenses from drawer today
  const expRow = await getQuery(
    `SELECT COALESCE(SUM(amount), 0) as total_expenses 
     FROM daily_expenses 
     WHERE date(expense_date) = date('now', 'localtime') OR date(created_at) = date('now', 'localtime')`
  );
  const cashExpenses = expRow ? expRow.total_expenses : 0;

  const openingFloat = 500.0;
  const expectedCash = openingFloat + cashSales - cashAdvances - cashExpenses;

  return {
    success: true,
    user_id: user.id,
    user_name: user.name,
    user_role: user.role,
    shift_id: shiftRow ? shiftRow.id : null,
    clock_in: clockInTime,
    clock_out: clockOutTime,
    shift_type: activeShift,
    opening_float: openingFloat,
    cash_sales: cashSales,
    digital_sales: digitalSales,
    total_sales: totalSales,
    total_tips: totalTips,
    cash_advances: cashAdvances,
    cash_expenses: cashExpenses,
    expected_cash: Math.max(0, expectedCash),
    order_count: orderCount,
    generated_at: new Date().toLocaleString('ar-EG')
  };
}

async function declareCashExtended(declarationPayload, actor = null) {
  const { user_id, user_name, shift_type = 'MORNING', actual_cash = 0, opening_float = 500 } = declarationPayload;
  const uId = user_id || (actor ? actor.id : 1);

  const report = await getUserShiftReport(uId, shift_type);
  const expectedCash = report.expected_cash;
  const declaredCash = Number(actual_cash) || 0;
  const variance = declaredCash - expectedCash;

  const res = await runQuery(
    `INSERT INTO drawer_declarations (user_id, user_name, shift_type, opening_float, cash_sales, declared_amount, expected_amount, variance, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED')`,
    [uId, user_name || (actor ? actor.name : 'كاشير'), shift_type, opening_float, report.cash_sales, declaredCash, expectedCash, variance]
  );

  // Spool Shift Z-Report Print Job
  const zReportPayload = JSON.stringify({
    declaration_id: res.lastID,
    user_id: uId,
    user_name: user_name || (actor ? actor.name : 'كاشير'),
    shift_type,
    opening_float,
    cash_sales: report.cash_sales,
    digital_sales: report.digital_sales,
    total_sales: report.total_sales,
    advances: report.cash_advances,
    expenses: report.cash_expenses,
    expected_cash: expectedCash,
    actual_cash: declaredCash,
    variance: variance,
    order_count: report.order_count,
    created_at: new Date().toLocaleString('ar-EG')
  });

  await runQuery(
    `INSERT INTO print_jobs (id, job_type, payload_json, status) VALUES (?, 'Z_REPORT', ?, 'PENDING')`,
    [crypto.randomUUID(), zReportPayload]
  );

  // Close active shift
  await runQuery(
    `UPDATE shifts SET clock_out = datetime('now', 'localtime'), status = 'COMPLETED'
     WHERE user_id = ? AND status = 'ACTIVE'`,
    [uId]
  );

  return {
    success: true,
    message: 'تم إغلاق الوردية وتسجيل إقرار الدرج وطباعة تقرير Z-Report بنجاح',
    declaration: {
      id: res.lastID,
      variance,
      expected_cash: expectedCash,
      actual_cash: declaredCash,
      status: variance === 0 ? 'MATCHED' : (variance > 0 ? 'SURPLUS' : 'DEFICIT')
    }
  };
}

module.exports = {
  clockInUser,
  clockOutUser,
  getUserShiftReport,
  declareCashExtended
};
