const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

async function createExpense(expenseData) {
  return runTransaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO expenses (id, venue_id, vendor_id, category_id, amount_minor, tax_minor, currency, billing_period_start, billing_period_end, due_date, status, allocation_policy_json, attachment_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
      [
        expenseData.id,
        expenseData.venue_id,
        expenseData.vendor_id,
        expenseData.category_id,
        expenseData.amount_minor,
        expenseData.tax_minor || 0,
        expenseData.currency || 'EGP',
        expenseData.billing_period_start,
        expenseData.billing_period_end,
        expenseData.due_date,
        expenseData.allocation_policy_json || null,
        expenseData.attachment_ref || null,
        expenseData.created_by
      ]
    );
    return res;
  });
}

async function approveExpense(expenseId, approverId) {
  return runTransaction(async (tx) => {
    const expense = await getQuery(`SELECT status FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense || expense.status !== 'DRAFT') throw new Error('Cannot approve non-draft expense');

    await tx.run(
      `UPDATE expenses SET status = 'APPROVED', approved_by = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [approverId, expenseId]
    );
  });
}

async function payExpense(expenseId) {
  return runTransaction(async (tx) => {
    const expense = await getQuery(`SELECT status FROM expenses WHERE id = ?`, [expenseId]);
    if (!expense || expense.status !== 'APPROVED') throw new Error('Cannot pay non-approved expense');

    await tx.run(
      `UPDATE expenses SET status = 'PAID', updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [expenseId]
    );
  });
}

module.exports = {
  createExpense,
  approveExpense,
  payExpense
};
