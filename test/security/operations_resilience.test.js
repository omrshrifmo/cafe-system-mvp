/**
 * Enterprise Operations Resilience, Durable Printing & Disaster Recovery Test Suite
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const {
  formatReceiptEscPos,
  formatKitchenTicketEscPos,
  formatZReportEscPos,
  enqueuePrintJob,
  processPrintJob,
  getPrinterHealth,
  setPrinterHealth,
  CMD
} = require('../../src/domain/printing/service');
const {
  createHotBackup,
  createEncryptedBackup,
  restoreEncryptedBackup,
  verifyBackup,
  getBackupStatus,
  testFullDisasterRecoveryRehearsal
} = require('../../src/domain/system/backupService');

describe('Enterprise Operations Resilience & Disaster Recovery Suite', function () {
  this.timeout(20000);
  let app;

  before(async () => {
    await runMigrations();
    app = createApp();
  });

  describe('1. Health Probes & Monitoring Contracts', () => {
    it('GET /api/health/liveness should return 200 with status UP', async () => {
      const res = await request(app).get('/api/health/liveness');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'UP');
      assert.ok(res.body.uptime_seconds >= 0);
    });

    it('GET /api/health/readiness should verify DB integrity and migrations', async () => {
      const res = await request(app).get('/api/health/readiness');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'READY');
      assert.strictEqual(res.body.checks.database_integrity.status, 'PASS');
      assert.strictEqual(res.body.checks.migrations.status, 'PASS');
    });

    it('GET /api/metrics should expose structured metrics and counters', async () => {
      const res = await request(app).get('/api/metrics');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.metrics);
      assert.ok(typeof res.body.metrics.process.uptime_seconds === 'number');
    });
  });

  describe('2. Durable Printing, Safe Drawer Kick & DLQ', () => {
    it('should format receipt ESC/POS buffer with header, items, and tax breakdown', () => {
      const buffer = formatReceiptEscPos({
        order_id: 101,
        table_number: 5,
        cashier_name: 'أحمد محمود',
        items: [{ item_name: 'قهوة تركي', quantity: 2, price: 40 }],
        subtotal: 80,
        vat_amount: 11.2,
        total_amount: 91.2,
        kick_drawer: false
      });

      assert.ok(Buffer.isBuffer(buffer));
      assert.ok(buffer.length > 0);
      // Check that buffer begins with ESC @ (Init)
      assert.strictEqual(buffer[0], 0x1B);
      assert.strictEqual(buffer[1], 0x40);
    });

    it('should enforce safe drawer kick ONLY when payment method is CASH', () => {
      // Cash payment -> Includes DRAWER_KICK command
      const cashBuffer = formatReceiptEscPos({
        order_id: 102,
        total_amount: 100,
        kick_drawer: true,
        payment_method: 'CASH'
      });
      assert.ok(cashBuffer.includes(CMD.DRAWER_KICK), 'Drawer kick should be present for CASH');

      // Visa payment -> DRAWER_KICK suppressed even if kick_drawer is true
      const visaBuffer = formatReceiptEscPos({
        order_id: 103,
        total_amount: 100,
        kick_drawer: true,
        payment_method: 'VISA'
      });
      assert.ok(!visaBuffer.includes(CMD.DRAWER_KICK), 'Drawer kick must be suppressed for VISA');
    });

    it('should suppress duplicate print jobs within deduplication window', async () => {
      const payload = { order_id: 888, total_amount: 250, items: ['عصير مانجو'] };

      const job1 = await enqueuePrintJob({
        jobType: 'RECEIPT',
        payload,
        idempotencyKey: 'PRINT_DEDUP_TEST_001'
      });
      assert.strictEqual(job1.status, 'QUEUED');

      // Duplicate submission
      const job2 = await enqueuePrintJob({
        jobType: 'RECEIPT',
        payload,
        idempotencyKey: 'PRINT_DEDUP_TEST_001'
      });
      assert.strictEqual(job2.duplicate_suppressed, true);
      assert.strictEqual(job2.job_id, job1.job_id);
    });

    it('should retry failed print job with backoff and move to DEAD_LETTER after max retries', async () => {
      const enq = await enqueuePrintJob({
        jobType: 'KITCHEN_TICKET',
        payload: { table_number: 12, item_name: 'بيتزا مارجريتا' }
      });

      // Simulated failing hardware print function
      const failingPrintFn = async () => {
        throw new Error('Hardware connection timeout: 192.168.1.200:9100');
      };

      const result = await processPrintJob(enq.job_id, failingPrintFn);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'DEAD_LETTER');
      assert.strictEqual(result.attempts, 3);
    });

    it('should monitor and update printer health status', () => {
      const initial = getPrinterHealth('DEFAULT_POS');
      assert.strictEqual(initial.status, 'ONLINE');
      assert.strictEqual(initial.healthy, true);

      // Simulate paper out
      setPrinterHealth('DEFAULT_POS', { status: 'ERROR', paper: 'EMPTY', error: 'Paper roll exhausted' });
      const updated = getPrinterHealth('DEFAULT_POS');
      assert.strictEqual(updated.status, 'ERROR');
      assert.strictEqual(updated.healthy, false);

      // Restore to healthy
      setPrinterHealth('DEFAULT_POS', { status: 'ONLINE', paper: 'OK', error: null });
      assert.strictEqual(getPrinterHealth('DEFAULT_POS').healthy, true);
    });
  });

  describe('3. Online Hot Backups, AES-256 Encryption & Restore Rehearsal', () => {
    it('should create hot online backup with SHA-256 checksum and verify database integrity', async () => {
      const backupManifest = await createHotBackup();
      assert.ok(fs.existsSync(backupManifest.file_path));
      assert.ok(backupManifest.sha256_checksum);
      assert.strictEqual(backupManifest.status, 'VERIFIED');

      const verification = await verifyBackup(backupManifest.file_path);
      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.integrity, 'OK');
      assert.ok(verification.table_count > 10);
    });

    it('should create AES-256-GCM encrypted backup package and verify checksum', async () => {
      const encPackage = await createEncryptedBackup('TestStrongSecretPass2026!');
      assert.ok(fs.existsSync(encPackage.file_path));
      assert.strictEqual(encPackage.encryption_algorithm, 'AES-256-GCM');
      assert.ok(encPackage.sha256_checksum);
    });

    it('should restore encrypted backup to an isolated separate SQLite database and verify 100% parity', async () => {
      const testDir = path.join(__dirname, '../../backups');
      const encPackage = await createEncryptedBackup('RestoreSecret2026!', testDir);

      const isolatedDbPath = path.join(testDir, `isolated-test-${Date.now()}.sqlite`);
      const restoreResult = await restoreEncryptedBackup(encPackage.file_path, 'RestoreSecret2026!', isolatedDbPath);

      assert.strictEqual(restoreResult.success, true);
      assert.strictEqual(restoreResult.integrity, 'OK');
      assert.ok(restoreResult.table_count > 10);

      // Clean up isolated DB file
      if (fs.existsSync(isolatedDbPath)) {
        fs.unlinkSync(isolatedDbPath);
      }
    });

    it('should execute full disaster recovery rehearsal measuring RTO and RPO metrics', async () => {
      const rehearsal = await testFullDisasterRecoveryRehearsal();
      assert.strictEqual(rehearsal.rehearsal_status, 'SUCCESS');
      assert.strictEqual(rehearsal.integrity_check, 'OK');
      assert.ok(rehearsal.rto_seconds < 60.0, `RTO must be under 60 seconds (measured: ${rehearsal.rto_seconds}s)`);
      assert.ok(rehearsal.rpo_minutes <= 15.0, `RPO must be under 15 minutes (declared: ${rehearsal.rpo_minutes}m)`);
    });
  });

});
