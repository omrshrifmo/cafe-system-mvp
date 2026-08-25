/**
 * Full-Day Deterministic Simulator Mocha Test Gate
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runFullDaySimulation } = require('../../scripts/full_day_simulator');

describe('Full-Day Deterministic Simulation & Audit Gate Suite', function () {
  this.timeout(60000);

  let simResult;

  before(async function () {
    this.timeout(60000);
    simResult = await runFullDaySimulation();
  });

  it('1. Should execute exactly 30 table sessions across 2 shifts with zero failures', () => {
    assert.strictEqual(simResult.total_tables_executed, 30);
    assert.strictEqual(simResult.shifts_closed, 2);
    assert.strictEqual(simResult.overall_status, 'PASS');
  });

  it('2. Financial Reconciliation: Net sales must match across EOD, BI and Shareholders reports', () => {
    const fin = simResult.financial_reconciliation;
    assert.strictEqual(fin.eod_revenue_reconciled, true);
    assert.strictEqual(fin.bi_revenue_reconciled, true);
    assert.strictEqual(fin.shareholders_reconciled, true);
    assert.ok(fin.total_net_sales_egp > 0);
    assert.ok(fin.total_collected_egp >= fin.total_net_sales_egp);
  });

  it('3. Inventory & BOM Reconciliation: Consumption must be recorded without missing units', () => {
    const bom = simResult.inventory_bom_reconciliation;
    assert.strictEqual(bom.bom_report_status, true);
    assert.strictEqual(bom.all_items_matched, true);
    assert.ok(bom.consumption_items_verified > 0);
  });

  it('4. Concurrency & Stress Scenarios: All 8 concurrent tests must pass 100%', () => {
    const conc = simResult.concurrency_reconciliation;
    assert.strictEqual(conc.all_passed, true);
    assert.strictEqual(conc.passed_tests, 8);
    assert.strictEqual(conc.total_tests, 8);
  });

  it('5. Artifact Verification: All required artifact files must exist on disk', () => {
    const artifactFiles = [
      'artifacts/full-day/seed-manifest.json',
      'artifacts/full-day/table-results.json',
      'artifacts/full-day/event-trace.json',
      'artifacts/full-day/reconciliation.json',
      'artifacts/full-day/concurrency.json',
      'artifacts/full-day/realtime.json',
      'artifacts/full-day/offline.json',
      'artifacts/full-day/print.json',
      'artifacts/full-day/expected-vs-actual.md',
      'docs/full-day-simulator.md',
      'docs/release-gate.json'
    ];

    for (const relPath of artifactFiles) {
      const fullPath = path.join(__dirname, '../../', relPath);
      assert.ok(fs.existsSync(fullPath), `Artifact missing: ${relPath}`);
      const stats = fs.statSync(fullPath);
      assert.ok(stats.size > 0, `Artifact file is empty: ${relPath}`);
    }
  });

  it('6. Release Gate File: Must contain GO / PASS decision', () => {
    const gatePath = path.join(__dirname, '../../docs/release-gate.json');
    const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
    assert.strictEqual(gate.decision, 'GO / PASS');
    assert.strictEqual(gate.metrics.tables_executed, 30);
    assert.strictEqual(gate.metrics.concurrency_scenarios_passed, 8);
  });

});
