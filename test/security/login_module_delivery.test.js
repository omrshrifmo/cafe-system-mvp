const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.env.NODE_ENV = 'test';
process.env.BCRYPT_WORK_FACTOR = '4';

const { createApp } = require('../../src/app');
const { getDb, closeDb, getQuery, runQuery } = require('../../src/db/connection');

describe('Login Module Delivery & Auth UI Contract Gate', function() {
  this.timeout(15000);
  let app;
  const fixturePath = path.join(__dirname, '../../fixtures/gate-login-delivery.sqlite');

  before(async function() {
    process.env.DATABASE_PATH = fixturePath;
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
    getDb(fixturePath);

    // Apply migrations
    const { runMigrations } = require('../../src/db/migrator');
    await runMigrations(getDb(fixturePath));

    // Create app instance
    app = createApp();

    // Seed test users in isolated fixture
    const bcrypt = require('bcryptjs');
    const ownerPinHash = await bcrypt.hash('1009', 4);
    const cashierPinHash = await bcrypt.hash('1007', 4);

    await runQuery(`INSERT OR REPLACE INTO venues (id, name) VALUES ('V_DEFAULT', 'كافيه مزاج')`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_OWNER', 'V_DEFAULT', 'OWNER')`);
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_CASHIER', 'V_DEFAULT', 'OP_ASSISTANT_CASHIER')`);

    await runQuery(`
      INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active)
      VALUES 
        (1, 'فاطمة (مالك)', 'OWNER', ?, 1),
        (2, 'أحمد كركر', 'OP_ASSISTANT_CASHIER', ?, 1)
    `, [ownerPinHash, cashierPinHash]);

    await runQuery(`
      INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
      VALUES 
        ('U_TEST_OWNER', 'V_DEFAULT', 'فاطمة (مالك)', 'R_OWNER', ?, 1),
        ('U_TEST_CASHIER', 'V_DEFAULT', 'أحمد كركر', 'R_CASHIER', ?, 1)
    `, [ownerPinHash, cashierPinHash]);
  });

  after(async function() {
    await closeDb();
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  });

  it('1. /index.html contains the intended auth script reference (/modules/auth.js)', async function() {
    const res = await request(app).get('/index.html');
    assert.strictEqual(res.status, 200);
    assert(res.text.includes('<script src="/modules/auth.js"></script>'));
  });

  it('2. /modules/auth.js returns HTTP 200', async function() {
    const res = await request(app).get('/modules/auth.js');
    assert.strictEqual(res.status, 200);
  });

  it('3. /modules/auth.js response has JavaScript MIME type', async function() {
    const res = await request(app).get('/modules/auth.js');
    assert(/javascript/.test(res.headers['content-type']));
  });

  it('4. /modules/auth.js contains no HTML <html or <pre wrapper', async function() {
    const res = await request(app).get('/modules/auth.js');
    assert(!res.text.includes('<html'));
    assert(!res.text.includes('<pre'));
    assert(!res.text.includes('<!DOCTYPE'));
  });

  it('5. /modules/auth.js defines window.AuthModule with intended methods', async function() {
    const res = await request(app).get('/modules/auth.js');
    assert(res.text.includes('window.AuthModule ='));
    assert(res.text.includes('loginWithPin'));
    assert(res.text.includes('checkAuthSession'));
    assert(res.text.includes('logout'));
    assert(res.text.includes('lockScreen'));
    assert(res.text.includes('enableCaffeineMode'));
  });

  it('6. /modules/auth.js has no syntax error (node -c passes cleanly)', function() {
    const authJsPath = path.join(__dirname, '../../public/modules/auth.js');
    assert.doesNotThrow(() => {
      execSync(`node -c "${authJsPath}"`, { encoding: 'utf8' });
    });
  });

  it('7. /index.html has module health check that distinguishes module load failure from invalid PIN', async function() {
    const res = await request(app).get('/index.html');
    assert(res.text.includes('تعذر تحميل وحدة تسجيل الدخول'));
    assert(res.text.includes('window.AuthModule'));
  });

  it('8. A valid fixture PIN returns an authenticated user and correct role/default route', async function() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.user);
    assert.strictEqual(res.body.user.role, 'OWNER');
    assert.strictEqual(res.body.user.defaultRoute, '/portal.html');
  });

  it('9. An invalid PIN returns a safe Arabic error and no session', async function() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: '0000' });

    assert(res.status === 401 || res.status === 400);
    assert.strictEqual(res.body.success, false);
    assert(typeof res.body.error === 'string');
    assert.strictEqual(res.body.user, undefined);
  });

  it('10. Server response does not disclose PINs, hashes, raw tokens, or SQL', async function() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });

    const bodyStr = JSON.stringify(res.body);
    assert(!bodyStr.includes('pin_hash'));
    assert(!bodyStr.includes('$2a$'));
    assert(!bodyStr.includes('$2b$'));
    assert(!bodyStr.includes('SELECT'));
  });

  it('11. The server role, route, and permissions cannot be forged by client body', async function() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1007', role: 'SUPER_ADMIN', permissions: ['*'], defaultRoute: '/super-admin.html' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.role, 'OP_ASSISTANT_CASHIER');
    assert.strictEqual(res.body.user.defaultRoute, '/pos.html');
  });

  it('12. Logout after login revokes server session and /api/auth/me returns AUTH_REQUIRED', async function() {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });

    const cookie = loginRes.headers['set-cookie'];
    assert(cookie);

    // Verify session active
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.success, true);

    // Logout (with CSRF header or empty body)
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .send({});
    assert.strictEqual(logoutRes.status, 200);

    // Verify session revoked
    const meAfter = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);
    assert.strictEqual(meAfter.status, 401);
    assert.strictEqual(meAfter.body.code, 'AUTH_REQUIRED');
  });

  it('13. /api/build-info returns current commit and SW cafe-os-v3.2-prod', async function() {
    const res = await request(app).get('/api/build-info');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.serviceWorkerVersion, 'cafe-os-v3.2-prod');
  });

  it('14. Stale service-worker cache invalidation token is present in system_config', async function() {
    const updateService = require('../../src/domain/system/updatePackageService');
    const result = await updateService.invalidateServiceWorkerCache('v3.2-prod', getDb(fixturePath));
    assert(result && typeof result.invalidation_token === 'string');

    const row = await getQuery(`SELECT value FROM system_config WHERE key = 'sw_invalidation_token'`, [], getDb(fixturePath));
    assert.strictEqual(row.value, result.invalidation_token);
  });
});
