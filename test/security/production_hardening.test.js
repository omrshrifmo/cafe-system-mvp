const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { closeDb } = require('../../src/db/connection');
const { sanitizeCsvValue, sanitizePath } = require('../../src/http/middleware/security');
const { createHotBackup, verifyBackup, getBackupStatus } = require('../../src/domain/system/backupService');

describe('Continuous Operations & Production Hardening Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    await runMigrations();
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closeDb();
  });

  describe('1. Security Headers & Defense-in-Depth', () => {
    it('should inject Content-Security-Policy, X-Frame-Options, and NoSniff headers', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      assert.strictEqual(res.status, 200);

      const csp = res.headers.get('content-security-policy');
      assert.ok(csp && csp.includes("default-src 'self'"), 'Missing or invalid CSP header');

      const frameOptions = res.headers.get('x-frame-options');
      assert.strictEqual(frameOptions, 'DENY', 'Missing or invalid X-Frame-Options');

      const contentTypeOptions = res.headers.get('x-content-type-options');
      assert.strictEqual(contentTypeOptions, 'nosniff', 'Missing X-Content-Type-Options nosniff');
    });

    it('should reject unauthorized CORS origin preflight requests', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://malicious-attacker-site.com',
          'Access-Control-Request-Method': 'POST'
        }
      });
      assert.strictEqual(res.status, 403, 'Should reject unauthorized CORS origin');
    });

    it('should sanitize CSV formula injection characters (=, +, -, @)', () => {
      assert.strictEqual(sanitizeCsvValue('=SUM(A1:A10)'), "'=SUM(A1:A10)");
      assert.strictEqual(sanitizeCsvValue('+12345'), "'+12345");
      assert.strictEqual(sanitizeCsvValue('-100'), "'-100");
      assert.strictEqual(sanitizeCsvValue('@cmd'), "'@cmd");
      assert.strictEqual(sanitizeCsvValue('Normal Text'), 'Normal Text');
    });

    it('should sanitize path traversal strings', () => {
      assert.strictEqual(sanitizePath('../../etc/passwd'), 'etc/passwd');
      assert.strictEqual(sanitizePath('..\\..\\windows\\system32'), 'windows\\system32');
    });
  });

  describe('2. Observability & Health Probes', () => {
    it('should return UP on /api/health/liveness', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.ok(data.uptime_seconds >= 0);
    });

    it('should perform deep database and migration validation on /api/health/readiness', async () => {
      const res = await fetch(`${baseUrl}/api/health/readiness`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'READY');
      assert.strictEqual(data.checks.database_integrity.status, 'PASS');
      assert.ok(data.checks.migrations.applied_count > 0);
      assert.ok(data.checks.system_resources.rss_mb);
    });

    it('should expose metrics in JSON and Prometheus formats', async () => {
      const jsonRes = await fetch(`${baseUrl}/api/metrics`);
      assert.strictEqual(jsonRes.status, 200);
      const jsonData = await jsonRes.json();
      assert.ok(jsonData.metrics.requests.total > 0);

      const promRes = await fetch(`${baseUrl}/api/metrics?format=prometheus`);
      assert.strictEqual(promRes.status, 200);
      const promText = await promRes.text();
      assert.ok(promText.includes('cafe_http_requests_total'));
      assert.ok(promText.includes('cafe_process_memory_rss_bytes'));
    });
  });

  describe('3. Online Hot Backups & Disaster Recovery', () => {
    it('should create an online hot backup with SHA-256 checksum and verify integrity', async () => {
      const backupDir = path.join(__dirname, '../../backups');
      const manifest = await createHotBackup(backupDir);

      assert.ok(manifest.backup_file.endsWith('.sqlite'));
      assert.ok(manifest.sha256_checksum.length === 64, 'SHA-256 checksum must be 64 characters hex');
      assert.strictEqual(manifest.status, 'VERIFIED');

      // Verify backup file
      const verification = await verifyBackup(manifest.file_path);
      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.integrity, 'OK');
      assert.ok(verification.table_count > 10);

      // Check backup status reporting
      const status = await getBackupStatus(backupDir);
      assert.strictEqual(status.has_backup, true);
      assert.strictEqual(status.is_stale, false);
    });
  });

});
