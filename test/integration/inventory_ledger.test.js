const assert = require('assert');
const { getLedgerBalance, validateNegativeStock, appendLedgerEvent } = require('../../src/domain/inventory/ledgerService');
const { runTransaction } = require('../../src/db/transaction');
const { runQuery } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');

describe('Inventory Ledger Validation', () => {
  before(async () => {
    await runMigrations();
    await runQuery(`INSERT OR IGNORE INTO inventory_items (id, name, unit, cost_per_unit_minor) VALUES (1, 'Coffee Beans', 'KG', 5000)`);
  });

  it('should calculate ledger balance via WAC and append correctly', async () => {
    const initialBalance = await getLedgerBalance(1);

    await runTransaction(async (tx) => {
      await appendLedgerEvent(tx, {
        inventory_item_id: 1,
        quantity_delta_microunits: 5000,
        event_type: 'PURCHASE',
        source_type: 'PURCHASE_RECEIPT',
        source_id: 'PO-1-' + Date.now()
      });
    });

    const balance = await getLedgerBalance(1);
    assert.strictEqual(balance, initialBalance + 5000, 'Balance should increase by 5000 after append');
  });

  it('should enforce negative stock policy', async () => {
    try {
      await validateNegativeStock({ id: 1, name: 'Coffee Beans', negative_stock_policy: 'BLOCK' }, 1e15);
      assert.fail('Should have blocked negative stock');
    } catch (err) {
      assert.match(err.message, /Insufficient stock/i);
    }
  });
});
