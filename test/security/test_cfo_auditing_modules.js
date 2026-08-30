/**
 * Automated Test Suite: CFO Advanced Accounting & Auditing Modules
 * 1. Physical Inventory Reconciliation (نظام الجرد الفعلي)
 * 2. Hospitality & Comps (طلبات الضيافة) with BOM Expense Logging
 * 3. Indirect Costs & Profit Margin Formula
 * 4. Daily Sales Target Tracking (الهدف اليومي للمبيعات)
 */
const assert = require('assert');
const { getQuery, allQuery, runQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');
const { reconcilePhysicalInventory, getPhysicalReconciliations } = require('../../src/domain/inventory/service');
const { settleSession, getSystemTaxConfig } = require('../../src/domain/payments/service');
const { generateReport, REPORT_TYPES } = require('../../src/domain/reports/reportDefinitionService');

describe('CFO Advanced Accounting & Auditing Modules Verification', function() {
  this.timeout(10000);

  before(async function() {
    await runMigrations();

    try {
      await runQuery(`ALTER TABLE recipes ADD COLUMN indirect_cost REAL DEFAULT 0`);
    } catch (e) {}

    // Seed table
    await runQuery(`
      INSERT OR REPLACE INTO tables (id, table_number, capacity, status)
      VALUES (999, 999, 4, 'OCCUPIED')
    `);

    // Seed test menu item if menu_items table exists
    try {
      await runQuery(`
        INSERT OR REPLACE INTO menu_items (id, name, price, department, category)
        VALUES (999, 'لاتيه فاخر CFO', 30, 'BARISTA', 'مشروبات ساخنة')
      `);
    } catch (e) {}

    // Seed test inventory item
    await runQuery(`
      INSERT OR REPLACE INTO inventory (id, name, unit, current_stock, min_stock_level, unit_cost, department)
      VALUES (999, 'بن اسبريسو ممتاز CFO', 'جرام', 1000, 100, 0.5, 'BARISTA')
    `);

    // Seed test recipe with indirect cost
    await runQuery(`
      INSERT OR REPLACE INTO recipes (id, menu_item_name, inventory_id, quantity_required, indirect_cost)
      VALUES (999, 'لاتيه فاخر CFO', 999, 20, 3.5)
    `);

    // Seed daily sales target
    await runQuery(`
      INSERT INTO system_config (key, value) VALUES ('daily_target', '7500')
      ON CONFLICT(key) DO UPDATE SET value = '7500'
    `);
  });

  it('1. Physical Inventory Reconciliation: calculates variance, updates stock, logs record permanently', async function() {
    const theoretical = 1000;
    const actualCount = 850; // 150g deficit
    const actor = { id: 1, name: 'مدير النظام', role: 'OWNER' };

    const result = await reconcilePhysicalInventory(999, actualCount, actor);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.theoretical_qty, 1000);
    assert.strictEqual(result.actual_qty, 850);
    assert.strictEqual(result.variance, -150);

    // Verify inventory table current_stock was updated
    const inv = await getQuery(`SELECT current_stock FROM inventory WHERE id = 999`);
    assert.strictEqual(inv.current_stock, 850);

    // Verify reconciliation log
    const logs = await getPhysicalReconciliations(999);
    assert.ok(logs.length > 0);
    const latestLog = logs[0];
    assert.strictEqual(latestLog.inventory_id, 999);
    assert.strictEqual(latestLog.actual_qty, 850);
    assert.strictEqual(latestLog.variance, -150);
    assert.strictEqual(latestLog.user_id, 1);
  });

  it('2. Hospitality & Comps: closes order with ضيافة without drawer cash, logs BOM cost under PR / Hospitality', async function() {
    // Create a dummy session with the test item
    const ref = 'SESS-CFO-COMP-' + Date.now();
    const sRes = await runQuery(`
      INSERT INTO order_sessions (public_ref, table_id, status, subtotal_minor, total_minor, created_at)
      VALUES (?, 999, 'OPEN', 6000, 6000, datetime('now', 'localtime'))
    `, [ref]);
    const sessionId = sRes.lastID;

    await runQuery(`
      INSERT INTO order_items (session_id, item_name_snapshot, quantity, unit_price_minor, status, department)
      VALUES (?, 'لاتيه فاخر CFO', 2, 3000, 'ACTIVE', 'BARISTA')
    `, [sessionId]);

    const actor = { id: 1, name: 'الكاشير', role: 'OP_MANAGER' };

    // Settle with payment method 'ضيافة'
    const checkoutResult = await settleSession({
      session_id: sessionId,
      table_number: 999,
      payment_method: 'ضيافة',
      payments: [{ method: 'ضيافة', amount: 60 }]
    }, actor);

    assert.ok(checkoutResult.success);

    // Verify session closed
    const session = await getQuery(`SELECT status FROM order_sessions WHERE id = ?`, [sessionId]);
    assert.strictEqual(session.status, 'SETTLED');

    // Verify PR / Hospitality expense was logged with calculated BOM
    // 2 qty * 20g * 0.5 EGP = 20 EGP BOM cost
    const expense = await getQuery(`
      SELECT * FROM daily_expenses 
      WHERE category = 'PR / Hospitality' 
      ORDER BY id DESC LIMIT 1
    `);
    assert.ok(expense, 'Daily expense under PR / Hospitality should be recorded');
    assert.strictEqual(expense.amount, 20);
    assert.ok(expense.description.includes('ضيافة'));
  });

  it('3. Indirect Costs & Profit Margin Engine: correctly applies ((Price - (BOM + Indirect)) / Price) * 100', async function() {
    // LATTE: Selling Price = 30 EGP (3000 minor)
    // BOM Cost: 20g * 0.5 = 10 EGP (1000 minor)
    // Indirect Cost: 3.5 EGP (350 minor)
    // Total Unit Cost: 13.5 EGP
    // Margin: ((30 - 13.5) / 30) * 100 = (16.5 / 30) * 100 = 55.00%
    const report = await generateReport(REPORT_TYPES.BI_ANALYTICS, { range: 'all' });
    assert.ok(report.success);
    assert.ok(Array.isArray(report.top_items));

    const latteItem = report.top_items.find(i => i.name === 'لاتيه فاخر CFO');
    assert.ok(latteItem, 'Latte should appear in top items');
    assert.strictEqual(latteItem.selling_price, 30);
    assert.strictEqual(latteItem.bom_cost, 10);
    assert.strictEqual(latteItem.indirect_cost, 3.5);
    assert.strictEqual(latteItem.profit_margin_pct, 55);
  });

  it('4. Daily Sales Targets: tracked in system_config, returned in BI and EOD reports', async function() {
    const biReport = await generateReport(REPORT_TYPES.BI_ANALYTICS, { range: 'today' });
    assert.strictEqual(biReport.daily_target, 7500);
    assert.ok(typeof biReport.target_progress_pct === 'number');

    const eodReport = await generateReport(REPORT_TYPES.EOD_FINANCIAL, { shift: 'ALL' });
    assert.strictEqual(eodReport.daily_target, 7500);
    assert.strictEqual(eodReport.report.daily_target, 7500);
    assert.ok(typeof eodReport.target_progress_pct === 'number');
  });
});
