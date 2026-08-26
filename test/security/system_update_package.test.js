/**
 * Safe Update Mechanism & Versioned Package Management Test Suite
 * Validates cryptographic signatures, whitelist security guards,
 * automated hot backup, transactional migrations, multi-subsystem health checks,
 * and verified rollback disaster recovery.
 */
const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getQuery, allQuery, runQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');
const {
  createSignedPackage,
  inspectPackage,
  applyUpdatePackage,
  rollbackUpdate,
  CURRENT_APP_VERSION
} = require('../../src/domain/system/updatePackageService');

describe('Safe Update Mechanism & Package Management Gate Suite', function () {
  this.timeout(30000);
  let app;
  let ownerCookies;
  let cashierCookies;

  before(async () => {
    await runMigrations();
    app = createApp();

    const ownerHash = await hashPin('1009');
    const cashierHash = await hashPin('1006');

    await runQuery(`UPDATE v3_users SET pin_hash = ?, is_active = 1, locked_until = NULL, failed_attempts = 0 WHERE id = '2' OR role_id = 'R_OWNER'`, [ownerHash]);
    await runQuery(`UPDATE v3_users SET pin_hash = ?, is_active = 1, locked_until = NULL, failed_attempts = 0 WHERE id = '5' OR role_id = 'R_CASHIER'`, [cashierHash]);
    await runQuery(`DELETE FROM system_updates WHERE id LIKE 'pkg-%'`);

    // Login as OWNER (PIN 1009)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });
    ownerCookies = ownerRes.headers['set-cookie'] || [`session_token=${ownerRes.body.sessionId}`];

    // Login as CASHIER (PIN 1006)
    const cashierRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1006' });
    cashierCookies = cashierRes.headers['set-cookie'] || [`session_token=${cashierRes.body.sessionId}`];
  });

  after(async () => {
    await runQuery(`DELETE FROM system_updates WHERE id LIKE 'pkg-%'`);
  });

  describe('1. Cryptographic Signature & Checksum Verification', () => {
    it('should successfully verify and inspect a valid signed update package', async () => {
      const validPkg = createSignedPackage({
        packageId: 'pkg-test-v2.1.0',
        name: 'حزمة الميزات التحليلية v2.1.0',
        version: '2.1.0',
        compatibility: { minAppVersion: '2.0.0', maxAppVersion: '2.9.9' },
        targetEnvironment: 'ALL',
        buildCommit: 'abc1234567890',
        schemaTarget: '028_analytics_feature.sql',
        migrations: [
          {
            version: '028_analytics_feature.sql',
            sql: `CREATE TABLE IF NOT EXISTS test_analytics_kpis (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              metric_name TEXT NOT NULL,
              metric_value REAL NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );`
          }
        ],
        configUpdates: [{ key: 'analytics_engine_enabled', value: true }],
        serviceWorkerVersion: 'cafe-os-v3.2',
        releaseNotes: {
          ar: 'تحديث تجريبي يضيف جداول تحليلات الأداء.',
          en: 'Test update adding performance analytics tables.'
        },
        affectedModules: ['REPORTS', 'BI', 'SETTINGS'],
        requiredBackup: true
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: validPkg })
        .expect(200);

      const impact = res.body.impact || res.body.data?.impact;
      assert.ok(impact, 'Impact report must be returned');
      assert.strictEqual(impact.packageId, 'pkg-test-v2.1.0');
      assert.strictEqual(impact.version, '2.1.0');
      assert.strictEqual(impact.safetyGuards.cryptographicSignatureVerified, true);
      assert.strictEqual(impact.safetyGuards.checksumValid, true);
      assert.strictEqual(impact.statistics.migrationStatements, 1);
    });

    it('should REJECT tampered package when content is modified after signing', async () => {
      const validPkg = createSignedPackage({
        packageId: 'pkg-tampered-1',
        name: 'حزمة أصلية',
        version: '2.1.0',
        migrations: [{ version: '028_tampered.sql', sql: 'CREATE TABLE t1 (id INT);' }],
        releaseNotes: { ar: 'أصلية', en: 'Original' }
      });

      // Tamper with package content after signature was generated
      const tamperedPkg = { ...validPkg, name: 'حزمة تم التلاعب بها' };

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: tamperedPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('CHECKSUM_MISMATCH'));
    });

    it('should REJECT unsigned package without signature', async () => {
      const unsignedPkg = {
        packageId: 'pkg-unsigned-1',
        name: 'Unsigned Package',
        version: '2.1.0'
      };

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: unsignedPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('SIGNATURE_ERROR'));
    });

    it('should REJECT package signed with untrusted/wrong key', async () => {
      const forgedPkg = createSignedPackage(
        {
          packageId: 'pkg-forged-1',
          name: 'Forged Package',
          version: '2.1.0',
          migrations: []
        },
        'FakeUntrustedAttackerSecretKey123'
      );

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: forgedPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('SIGNATURE_MISMATCH'));
    });
  });

  describe('2. Whitelist Security & Anti-Executable Sandbox Guards', () => {
    it('should strictly REJECT package containing arbitrary executable code or scripts', async () => {
      const maliciousPkg = createSignedPackage({
        packageId: 'pkg-malicious-code',
        name: 'Malicious Package',
        version: '2.1.0',
        executableCode: 'require("child_process").exec("rm -rf /")',
        migrations: []
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: maliciousPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('SECURITY_VIOLATION'));
    });

    it('should strictly REJECT SQL migrations containing forbidden operations (DROP DATABASE)', async () => {
      const harmfulSqlPkg = createSignedPackage({
        packageId: 'pkg-harmful-sql',
        name: 'Harmful SQL Package',
        version: '2.1.0',
        migrations: [
          {
            version: '028_bad.sql',
            sql: 'DROP DATABASE test; eval("code");'
          }
        ]
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: harmfulSqlPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('SECURITY_VIOLATION'));
    });

    it('should REJECT unsafe asset file paths with path traversal', async () => {
      const pathTraversalPkg = createSignedPackage({
        packageId: 'pkg-traversal',
        name: 'Traversal Package',
        version: '2.1.0',
        assets: [{ path: '../../etc/passwd', content: 'hacked' }]
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: pathTraversalPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('SECURITY_VIOLATION'));
    });
  });

  describe('3. SemVer, Downgrade Prevention & Compatibility Checks', () => {
    it('should REJECT version downgrade attempt below active system version', async () => {
      const downgradePkg = createSignedPackage({
        packageId: 'pkg-downgrade-1',
        name: 'Old Downgrade Version',
        version: '1.5.0', // Older than current 2.0.0
        migrations: []
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: downgradePkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('DOWNGRADE_REJECTED'));
    });

    it('should REJECT package targeting incompatible environment', async () => {
      const wrongEnvPkg = createSignedPackage({
        packageId: 'pkg-staging-only',
        name: 'Staging Only Package',
        version: '2.1.0',
        targetEnvironment: 'staging_isolated_env_xyz',
        migrations: []
      });

      const res = await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', ownerCookies)
        .send({ package: wrongEnvPkg })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('ENVIRONMENT_MISMATCH'));
    });
  });

  describe('4. RBAC, PIN Verification & Typed Confirmation Enforcement', () => {
    it('should block non-admin/cashier from accessing updates endpoints (DEFAULT_DENY / 403)', async () => {
      await request(app)
        .get('/api/admin/updates/catalog')
        .set('Cookie', cashierCookies)
        .expect(403);

      await request(app)
        .post('/api/admin/updates/inspect')
        .set('Cookie', cashierCookies)
        .send({})
        .expect(403);
    });

    it('should REJECT apply request when PIN is missing or invalid', async () => {
      const validPkg = createSignedPackage({
        packageId: 'pkg-pin-test',
        name: 'PIN Test Update',
        version: '2.1.0',
        migrations: []
      });

      const res = await request(app)
        .post('/api/admin/updates/apply')
        .set('Cookie', ownerCookies)
        .send({
          package: validPkg,
          pin: '0000', // Invalid PIN
          confirmation: 'CONFIRM UPDATE'
        })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('INVALID_PIN'));
    });

    it('should REJECT apply request when typed confirmation text is missing or invalid', async () => {
      const validPkg = createSignedPackage({
        packageId: 'pkg-confirm-test',
        name: 'Confirm Test Update',
        version: '2.1.0',
        migrations: []
      });

      const res = await request(app)
        .post('/api/admin/updates/apply')
        .set('Cookie', ownerCookies)
        .send({
          package: validPkg,
          pin: '1009',
          confirmation: 'YES' // Invalid confirmation phrase
        })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('CONFIRMATION_REQUIRED'));
    });
  });

  describe('5. Transactional Application, Automated Hot Backup & Post-Migration Health Check', () => {
    const featurePkg = createSignedPackage({
      packageId: 'pkg-release-v2.1.0-prod',
      name: 'ترقية نظام الكافيه للميزات التحليلية v2.1.0',
      version: '2.1.0',
      compatibility: { minAppVersion: '2.0.0', maxAppVersion: '2.9.9' },
      targetEnvironment: 'ALL',
      buildCommit: 'commit-2.1.0-release',
      schemaTarget: '028_analytics_feature.sql',
      migrations: [
        {
          version: '028_analytics_feature.sql',
          sql: `CREATE TABLE IF NOT EXISTS system_kpi_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kpi_name TEXT NOT NULL,
            kpi_value REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
          );`
        }
      ],
      configUpdates: [
        { key: 'system_auto_kpi_logging', value: true }
      ],
      serviceWorkerVersion: 'cafe-os-v3.2',
      releaseNotes: {
        ar: 'إضافة محرك مؤشرات الأداء اللحظية وترقية كاش المتصفح إلى v3.2',
        en: 'Added realtime KPI engine and upgraded PWA service worker to v3.2'
      },
      affectedModules: ['REPORTS', 'BI', 'SETTINGS'],
      requiredBackup: true
    });

    it('should successfully create hot backup, apply migrations, pass health checks, and mark ACTIVE', async () => {
      const res = await request(app)
        .post('/api/admin/updates/apply')
        .set('Cookie', ownerCookies)
        .send({
          package: featurePkg,
          pin: '1009',
          confirmation: 'CONFIRM UPDATE'
        })
        .expect(200);

      const data = res.body;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.packageId, 'pkg-release-v2.1.0-prod');
      assert.strictEqual(data.version, '2.1.0');
      assert.strictEqual(data.status, 'ACTIVE');
      assert.ok(data.backupFile, 'Pre-update backup file must be recorded');

      // Verify that backup file actually exists on disk
      const backupPath = path.join(__dirname, '../../backups', data.backupFile);
      assert.ok(fs.existsSync(backupPath), 'Verified backup file must exist on disk');

      // Verify migration was executed and table exists
      const tableCheck = await getQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='system_kpi_snapshots'`);
      assert.ok(tableCheck, 'system_kpi_snapshots table must have been created by migration');

      // Verify record in system_updates table
      const updateRec = await getQuery(`SELECT * FROM system_updates WHERE id = 'pkg-release-v2.1.0-prod'`);
      assert.ok(updateRec);
      assert.strictEqual(updateRec.status, 'ACTIVE');
      assert.strictEqual(updateRec.version, '2.1.0');

      // Verify current version info endpoint reflects new version
      const currRes = await request(app)
        .get('/api/admin/updates/current')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(currRes.body.appVersion, '2.1.0');
      assert.strictEqual(currRes.body.lastUpdate.packageId, 'pkg-release-v2.1.0-prod');
    });

    it('should reject re-applying an already applied active package (DUPLICATE_PACKAGE)', async () => {
      const res = await request(app)
        .post('/api/admin/updates/apply')
        .set('Cookie', ownerCookies)
        .send({
          package: featurePkg,
          pin: '1009',
          confirmation: 'CONFIRM UPDATE'
        })
        .expect(400);

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('DUPLICATE_PACKAGE'));
    });
  });

  describe('6. Verified Rollback & Disaster Recovery Flow', () => {
    it('should successfully roll back update and restore state using pre-update backup snapshot', async () => {
      const res = await request(app)
        .post('/api/admin/updates/pkg-release-v2.1.0-prod/rollback')
        .set('Cookie', ownerCookies)
        .send({ pin: '1009' })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'ROLLED_BACK');
      assert.strictEqual(res.body.targetVersion, '2.0.0');

      // Verify status in system_updates table
      const updateRec = await getQuery(`SELECT status, rollback_at FROM system_updates WHERE id = 'pkg-release-v2.1.0-prod'`);
      assert.strictEqual(updateRec.status, 'ROLLED_BACK');
      assert.ok(updateRec.rollback_at);
    });
  });

  describe('7. History, Audit Trail & Approved Catalog', () => {
    it('should return complete immutable history of updates and rollbacks', async () => {
      const historyRes = await request(app)
        .get('/api/admin/updates/history')
        .set('Cookie', ownerCookies)
        .expect(200);

      const history = historyRes.body.history || historyRes.body.data?.history;
      assert.ok(Array.isArray(history));
      assert.ok(history.length >= 1);

      const rolledBackItem = history.find(h => h.id === 'pkg-release-v2.1.0-prod');
      assert.ok(rolledBackItem);
      assert.strictEqual(rolledBackItem.status, 'ROLLED_BACK');
    });

    it('should return vetted pre-approved packages catalog', async () => {
      const catRes = await request(app)
        .get('/api/admin/updates/catalog')
        .set('Cookie', ownerCookies)
        .expect(200);

      const packages = catRes.body.packages || catRes.body.data?.packages;
      assert.ok(Array.isArray(packages));
      assert.ok(packages.length > 0);
      assert.ok(packages[0].signature);
      assert.ok(packages[0].checksum);
    });
  });
});
