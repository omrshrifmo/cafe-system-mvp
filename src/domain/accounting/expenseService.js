/**
 * Expenses, Utilities & Versioned Indirect Cost Allocation Domain Service
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const { verifyReauthentication, logAudit } = require('../auth/service');
const logger = require('../../observability/logger');

const EXPENSE_TYPES = {
  DIRECT_PRODUCT_COST: 'DIRECT_PRODUCT_COST',
  DIRECT_OPERATING_EXPENSE: 'DIRECT_OPERATING_EXPENSE',
  PAYROLL: 'PAYROLL',
  UTILITIES: 'UTILITIES',
  PAYMENT_FEES: 'PAYMENT_FEES',
  INDIRECT_COST: 'INDIRECT_COST'
};

const ALLOCATION_BASES = {
  REVENUE_PROPORTION: 'REVENUE_PROPORTION',
  HOURS_PROPORTION: 'HOURS_PROPORTION',
  COVERS_PROPORTION: 'COVERS_PROPORTION',
  AREA_PROPORTION: 'AREA_PROPORTION',
  CONSUMPTION_PROPORTION: 'CONSUMPTION_PROPORTION'
};

async function getExpenses(filter = {}) {
  let query = `
    SELECT e.id, e.venue_id, e.vendor_id, e.category_id, e.amount_minor,
           (e.amount_minor / 100.0) as amount,
           e.tax_minor, (e.tax_minor / 100.0) as tax,
           e.currency, e.billing_period_start, e.billing_period_end, e.due_date,
           e.status, e.allocation_policy_json, e.attachment_ref, e.created_by,
           e.approved_by, e.created_at,
           v.name as vendor_name, ec.name as category_name, ec.type as cost_type
    FROM expenses e
    LEFT JOIN vendors v ON e.vendor_id = v.id
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.cost_type) {
    query += ` AND ec.type = ?`;
    params.push(filter.cost_type);
  }
  if (filter.status) {
    query += ` AND e.status = ?`;
    params.push(filter.status);
  }

  query += ` ORDER BY e.created_at DESC LIMIT 100`;
  const rows = await allQuery(query, params);

  // Attach allocations
  for (const row of rows) {
    const allocations = await allQuery(
      `SELECT a.department, a.ratio_basis_points,
              (a.ratio_basis_points / 100.0) as ratio_percent,
              a.allocated_amount_minor, (a.allocated_amount_minor / 100.0) as allocated_amount,
              a.allocation_basis, a.basis_version
       FROM indirect_cost_allocations a
       WHERE a.expense_id = ?`,
      [row.id]
    );
    row.allocations = allocations;
    row.is_allocated = allocations.length > 0;
    if (!row.is_allocated && row.cost_type === EXPENSE_TYPES.INDIRECT_COST) {
      row.allocation_status = 'UNALLOCATED_EXCEPTION';
    } else {
      row.allocation_status = row.is_allocated ? 'ALLOCATED' : 'DIRECT';
    }
  }

  return rows;
}

async function recordExpense(expenseData, actorId = null) {
  const {
    vendor_id = 'VEND_GENERAL',
    category_id = 'CAT_GEN_EXPENSE',
    amount,
    currency = 'ج.م',
    tax = 0,
    billing_period_start,
    billing_period_end,
    due_date,
    notes,
    attachment_ref,
    allocation_policy
  } = expenseData;

  const amountMinor = Math.round((Number(amount) || 0) * 100);
  if (amountMinor <= 0) {
    throw new Error('VALIDATION_ERROR: قيمة المصروف يجب أن تكون أكبر من الصفر');
  }

  const taxMinor = Math.round((Number(tax) || 0) * 100);
  const expenseId = `EXP_${Date.now()}`;

  return runTransaction(async (tx) => {
    // Ensure vendor and category exist
    await tx.run(
      `INSERT OR IGNORE INTO vendors (id, name) VALUES (?, 'مورد عام')`,
      [vendor_id]
    );
    await tx.run(
      `INSERT OR IGNORE INTO expense_categories (id, venue_id, name, type) VALUES (?, 'V_DEFAULT', 'مصروفات تشغيلية', 'INDIRECT_COST')`,
      [category_id]
    );

    const validActorId = (actorId && !isNaN(Number(actorId))) ? Number(actorId) : 1;

    // Insert Expense Document
    await tx.run(
      `INSERT INTO expenses (
         id, venue_id, vendor_id, category_id, amount_minor, tax_minor, currency,
         billing_period_start, billing_period_end, due_date, status,
         allocation_policy_json, attachment_ref, created_by, created_at
       ) VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, datetime('now', 'localtime'))`,
      [
        expenseId,
        vendor_id,
        category_id,
        amountMinor,
        taxMinor,
        currency,
        billing_period_start || null,
        billing_period_end || null,
        due_date || null,
        allocation_policy ? JSON.stringify(allocation_policy) : null,
        attachment_ref || null,
        validActorId
      ]
    );

    // Also mirror to legacy daily_expenses for backwards compatibility
    await tx.run(
      `INSERT INTO daily_expenses (description, amount, payment_source, created_by, expense_date)
       VALUES (?, ?, 'DRAWER', ?, date('now', 'localtime'))`,
      [notes || `مصروف [${category_id}]`, amountMinor / 100, validActorId]
    );

    // If allocation policy is specified, compute and record indirect allocations
    if (allocation_policy && allocation_policy.basis) {
      const basis = allocation_policy.basis;
      const ratios = allocation_policy.ratios || {
        BARISTA: 4000,  // 40.00%
        KITCHEN: 4000,  // 40.00%
        SHISHA: 2000    // 20.00%
      };

      for (const [dept, ratioBps] of Object.entries(ratios)) {
        const allocMinor = Math.round((amountMinor * ratioBps) / 10000);
        const allocId = `ALLOC_${expenseId}_${dept}`;

        await tx.run(
          `INSERT INTO indirect_cost_allocations (
             id, venue_id, expense_id, allocation_basis, basis_version,
             department, ratio_basis_points, allocated_amount_minor, currency
           ) VALUES (?, 'V_DEFAULT', ?, ?, 1, ?, ?, ?, ?)`,
          [allocId, expenseId, basis, dept, ratioBps, allocMinor, currency]
        );
      }
    }

    return {
      id: expenseId,
      amount: amountMinor / 100,
      status: 'APPROVED',
      message: 'تم تسجيل المصروف وترحيله بنجاح 🧾'
    };
  });
}

async function allocateIndirectCosts(expenseId, basis = ALLOCATION_BASES.REVENUE_PROPORTION, customRatios = null, actorId = null) {
  return runTransaction(async (tx) => {
    const expense = await tx.get(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense) throw new Error('NOT_FOUND: المصروف غير موجود');

    // Default ratios based on selected basis
    let ratios = customRatios;
    if (!ratios) {
      if (basis === ALLOCATION_BASES.REVENUE_PROPORTION) {
        ratios = { BARISTA: 4500, KITCHEN: 3500, SHISHA: 2000 };
      } else if (basis === ALLOCATION_BASES.AREA_PROPORTION) {
        ratios = { BARISTA: 3000, KITCHEN: 5000, SHISHA: 2000 };
      } else {
        ratios = { BARISTA: 3334, KITCHEN: 3333, SHISHA: 3333 };
      }
    }

    // Delete existing allocations for this expense
    await tx.run(`DELETE FROM indirect_cost_allocations WHERE expense_id = ?`, [expenseId]);

    const allocatedLines = [];
    for (const [dept, ratioBps] of Object.entries(ratios)) {
      const allocMinor = Math.round((expense.amount_minor * ratioBps) / 10000);
      const allocId = `ALLOC_${expenseId}_${dept}_${Date.now()}`;

      await tx.run(
        `INSERT INTO indirect_cost_allocations (
           id, venue_id, expense_id, allocation_basis, basis_version,
           department, ratio_basis_points, allocated_amount_minor, currency
         ) VALUES (?, 'V_DEFAULT', ?, ?, 1, ?, ?, ?, ?)`,
        [allocId, expenseId, basis, dept, ratioBps, allocMinor, expense.currency]
      );

      allocatedLines.push({
        department: dept,
        ratio_percent: ratioBps / 100.0,
        allocated_amount: allocMinor / 100.0
      });
    }

    return {
      expense_id: expenseId,
      basis,
      total_amount: expense.amount_minor / 100.0,
      allocations: allocatedLines,
      message: 'تم توزيع التكاليف غير المباشرة على الأقسام بنجاح 📊'
    };
  });
}

module.exports = {
  EXPENSE_TYPES,
  ALLOCATION_BASES,
  getExpenses,
  recordExpense,
  allocateIndirectCosts
};
