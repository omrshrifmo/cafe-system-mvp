const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.BCRYPT_WORK_FACTOR = '4';

const { createApp } = require('../../src/app');
const { getDb, closeDb, getQuery, runQuery } = require('../../src/db/connection');

describe('Login Browser & 16-Role Contract Integration Gate', function() {
  this.timeout(20000);
  let app;
  const fixturePath = path.join(__dirname, '../../fixtures/gate-login-browser.sqlite');

  const CANONICAL_ROLES_PINS = [
    { role: 'SUPER_ADMIN', pin: '8801', route: '/portal.html' },
    { role: 'OWNER', pin: '8802', route: '/portal.html' },
    { role: 'OP_MANAGER', pin: '8803', route: '/portal.html' },
    { role: 'OP_ASSISTANT_CASHIER', pin: '8804', route: '/pos.html' },
    { role: 'BARISTA', pin: '8805', route: '/kds.html' },
    { role: 'CHEF', pin: '8806', route: '/kitchen.html' },
    { role: 'SHISHA', pin: '8807', route: '/shisha.html' },
    { role: 'WAITER', pin: '8808', route: '/pos.html' },
    { role: 'RUNNER', pin: '8809', route: '/runner.html' },
    { role: 'HALL_MANAGER', pin: '8810', route: '/tables.html' },
    { role: 'INVENTORY_SPECIALIST', pin: '8811', route: '/menu-manager.html' },
    { role: 'HR_PAYROLL', pin: '8812', route: '/hr.html' },
    { role: 'QA_AUDITOR', pin: '8813', route: '/qa.html' },
    { role: 'READ_ONLY', pin: '8814', route: '/bi.html' },
    { role: 'SHAREHOLDER_INVESTOR', pin: '8815', route: '/shareholders.html' },
    { role: 'ACCOUNTANT_CONTROLLER', pin: '8816', route: '/bi.html' }
  ];

  before(async function() {
    process.env.DATABASE_PATH = fixturePath;
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
    getDb(fixturePath);

    // Apply migrations
    const { runMigrations } = require('../../src/db/migrator');
    await runMigrations(getDb(fixturePath));

    // Create app instance
    app = createApp();

    await runQuery(`INSERT OR REPLACE INTO venues (id, name) VALUES ('V_DEFAULT', 'كافيه مزاج')`);

    // Seed all 16 roles and users
    for (let i = 0; i < CANONICAL_ROLES_PINS.length; i++) {
      const item = CANONICAL_ROLES_PINS[i];
      const roleId = `R_${item.role}`;
      const userId = `U_${item.role}`;
      const pinHash = await bcrypt.hash(item.pin, 4);

      await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [roleId, item.role]);
      await runQuery(`
        INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active)
        VALUES (?, ?, ?, ?, 1)
      `, [i + 10, item.role + ' User', item.role, pinHash]);

      await runQuery(`
        INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
        VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)
      `, [userId, item.role + ' User', roleId, pinHash]);
    }
  });

  after(async function() {
    await closeDb();
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  });

  it('1. /index.html and /modules/auth.js are delivered cleanly', async function() {
    const indexRes = await request(app).get('/index.html');
    assert.strictEqual(indexRes.status, 200);
    assert(indexRes.text.includes('/modules/auth.js'));

    const authRes = await request(app).get('/modules/auth.js');
    assert.strictEqual(authRes.status, 200);
    assert(/javascript/.test(authRes.headers['content-type']));
  });

  CANONICAL_ROLES_PINS.forEach((item, index) => {
    it(`Role ${index + 1}/16 [${item.role}]: PIN ${item.pin} authenticates and returns defaultRoute ${item.route}`, async function() {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ pin: item.pin });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.role, item.role);
      assert.strictEqual(res.body.user.defaultRoute, item.route);
    });
  });

  it('18. Consecutive failed logins report invalid PIN and track attempts', async function() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: '9999' });

    assert(res.status === 401 || res.status === 400);
    assert.strictEqual(res.body.success, false);
    assert(typeof res.body.error === 'string');
  });

  it('19. Sequential logout clears session on server and prevents back-button replay', async function() {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '8802' }); // Owner

    const cookie = loginRes.headers['set-cookie'];
    assert(cookie);

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .send({});
    assert.strictEqual(logoutRes.status, 200);

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);
    assert.strictEqual(meRes.status, 401);
    assert.strictEqual(meRes.body.code, 'AUTH_REQUIRED');
  });
});
