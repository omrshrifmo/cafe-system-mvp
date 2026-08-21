const assert = require('assert');
const { hashPin, verifyPin } = require('../../src/domain/auth/service');
const { hasPermission } = require('../../src/domain/auth/permissions');

describe('Auth & Permission Unit Tests', () => {
  it('should hash and verify PIN with bcrypt', async () => {
    const pin = '1011';
    const hash = await hashPin(pin);
    assert.strictEqual(typeof hash, 'string');
    assert.ok(hash.startsWith('$2'));

    const isValid = await verifyPin(pin, hash);
    assert.strictEqual(isValid, true);

    const isInvalid = await verifyPin('9999', hash);
    assert.strictEqual(isInvalid, false);
  });

  it('should enforce role permissions accurately', () => {
    // SUPER_ADMIN & OWNER have all permissions
    assert.strictEqual(hasPermission('SUPER_ADMIN', 'reports:financial'), true);
    assert.strictEqual(hasPermission('OWNER', 'orders:void_unpaid'), true);

    // OP_MANAGER has financial reports
    assert.strictEqual(hasPermission('OP_MANAGER', 'reports:financial'), true);

    // OP_ASSISTANT_CASHIER (Cashier) is BLOCKED from financial reports
    assert.strictEqual(hasPermission('OP_ASSISTANT_CASHIER', 'reports:financial'), false);
    assert.strictEqual(hasPermission('CASHIER', 'reports:financial'), false);

    // Cashier can take payments and declare cash
    assert.strictEqual(hasPermission('OP_ASSISTANT_CASHIER', 'payments:take'), true);
    assert.strictEqual(hasPermission('OP_ASSISTANT_CASHIER', 'shifts:declare_cash'), true);

    // Barista has only barista domain permissions
    assert.strictEqual(hasPermission('BARISTA', 'orders:read:barista'), true);
    assert.strictEqual(hasPermission('BARISTA', 'payments:take'), false);
  });
});
