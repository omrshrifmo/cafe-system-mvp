const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getQuery } = require('../../src/db/connection');

describe('Admin Configuration & Cafe Information Tests', () => {
  let app;
  let ownerToken;
  let cashierToken;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Login as Owner (SUPER_ADMIN / OWNER)
    const ownerRes = await request(app).post('/api/auth/login').send({ pin: '9999' });
    ownerToken = ownerRes.body.token;

    // Login as Cashier (OP_ASSISTANT_CASHIER)
    const cashierRes = await request(app).post('/api/auth/login').send({ pin: '1004' });
    cashierToken = cashierRes.body.token;
  });

  it('should allow Owner to update venue metadata', async () => {
    const res = await request(app)
      .put('/api/admin/venue')
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({
        legal_name: 'شركة مزاج للقهوة ش.م.م',
        tax_registration_number: '123-456-789',
        operating_hours: [{ day: 'Monday', open: '08:00', close: '23:00' }]
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.venue.legal_name, 'شركة مزاج للقهوة ش.م.م');
  });

  it('should block Cashier from updating venue metadata', async () => {
    const res = await request(app)
      .put('/api/admin/venue')
      .set('Cookie', [`session_token=${cashierToken}`])
      .send({ legal_name: 'Hacked Cafe' });

    assert.strictEqual(res.status, 403);
  });

  it('should reject policy publish without valid reauthentication PIN', async () => {
    const res = await request(app)
      .post('/api/admin/policies')
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({
        pin: '0000', // Wrong pin
        payload: { tax_percent: 14 }
      });

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('INVALID_PIN'));
  });

  it('should publish new policy with valid PIN and create audit log', async () => {
    const res = await request(app)
      .post('/api/admin/policies')
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({
        pin: '9999',
        payload: { tax_percent: 15, service_charge_percent: 10 }
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.policy.version >= 1);

    // Verify audit log creation
    const audit = await getQuery(`SELECT * FROM v3_audit_logs WHERE target_type = 'POLICY' ORDER BY created_at DESC LIMIT 1`);
    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.strictEqual(details.new_data.payload.tax_percent, 15);
  });

  it('should reject policy publish with invalid tax percent range', async () => {
    const res = await request(app)
      .post('/api/admin/policies')
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({
        pin: '9999',
        payload: { tax_percent: 150 }
      });

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Invalid tax percent'));
  });

  it('should register and revoke a device successfully', async () => {
    // 1. Register device
    const regRes = await request(app)
      .post('/api/admin/devices')
      .set('Cookie', [`session_token=${ownerToken}`])
      .send({
        name: 'Terminal 1',
        device_type: 'POS',
        capabilities: ['CASH_DRAWER', 'PRINTER']
      });

    assert.strictEqual(regRes.status, 200);
    assert.strictEqual(regRes.body.success, true);
    
    const deviceId = regRes.body.device.id;

    // 2. Revoke device
    const revokeRes = await request(app)
      .post(`/api/admin/devices/${deviceId}/revoke`)
      .set('Cookie', [`session_token=${ownerToken}`]);

    assert.strictEqual(revokeRes.status, 200);
    assert.strictEqual(revokeRes.body.success, true);

    const deviceRecord = await getQuery(`SELECT status FROM devices WHERE id = ?`, [deviceId]);
    assert.strictEqual(deviceRecord.status, 'REVOKED');
  });
});
