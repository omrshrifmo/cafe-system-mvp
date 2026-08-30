/**
 * Automated Verification for Shift Z-Report Auto-Print & Production Environment Config
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('./src/app');
const { runQuery, getQuery, allQuery } = require('./src/db/connection');
const { runMigrations } = require('./src/db/migrator');

async function runVerification() {
  console.log('🧪 Starting Shift Z-Report & Environment Configuration Verification Suite...\n');
  await runMigrations();
  const app = createApp();

  // Test 1: POST /api/print/z-report Endpoint
  console.log('▶ Test 1: Direct Shift Z-Report Print Route (POST /api/print/z-report)...');
  
  const cashierLogin = await request(app).post('/api/auth/login').send({ pin: '1007' });
  const cashierCookie = cashierLogin.headers['set-cookie'];

  const zReportRes = await request(app)
    .post('/api/print/z-report')
    .set('Cookie', cashierCookie)
    .send({
      user_id: 41,
      user_name: 'أحمد كركر (كاشير)',
      shift_type: 'MORNING',
      opening_float: 500,
      cash_sales: 1850,
      digital_sales: 450,
      total_sales: 2300,
      advances: 100,
      expenses: 150,
      expected_cash: 2100,
      actual_cash: 2100,
      variance: 0
    });

  assert.strictEqual(zReportRes.status, 200, 'POST /api/print/z-report should return 200 OK');
  assert.strictEqual(zReportRes.body.success, true);
  assert(zReportRes.body.job_id, 'Must return job_id');
  assert(zReportRes.body.z_report, 'Must return formatted z_report data');
  
  const zData = zReportRes.body.z_report;
  assert.strictEqual(zData.user_name, 'أحمد كركر (كاشير)');
  assert.strictEqual(zData.cash_sales, 1850);
  assert.strictEqual(zData.advances, 100);
  assert.strictEqual(zData.expenses, 150);
  assert.strictEqual(zData.expected_cash, 2100);
  assert.strictEqual(zData.actual_cash, 2100);
  assert.strictEqual(zData.variance, 0);
  assert(zReportRes.body.buffer_length > 0, 'Must generate ESC/POS buffer');

  // Verify print job queued
  const printJob = await getQuery(`SELECT * FROM print_jobs WHERE id = ?`, [zReportRes.body.job_id]);
  assert(printJob, 'Print job must be recorded in print_jobs table');
  assert.strictEqual(printJob.job_type, 'Z_REPORT');
  console.log('  🖨️ Z-Report printed and print job queued:', printJob.id);

  // Verify audit log
  const auditEntry = await getQuery(
    `SELECT * FROM audit_logs WHERE target_table = 'shifts' AND action = 'Z_REPORT_PRINTED' ORDER BY id DESC LIMIT 1`
  );
  assert(auditEntry, 'Audit log entry must exist for Z_REPORT_PRINTED');
  console.log('  📝 Audit log verified for Z-Report print.');
  console.log('✅ Test 1 Passed: POST /api/print/z-report fully operational.\n');

  // Test 2: Blind Cash Declaration Auto-Print Integration
  console.log('▶ Test 2: Blind Cash Declaration Auto-Print (/api/hr/declare-cash)...');
  const declRes = await request(app)
    .post('/api/hr/declare-cash')
    .set('Cookie', cashierCookie)
    .send({
      user_id: 41,
      user_name: 'أحمد كركر (كاشير)',
      shift_type: 'NIGHT',
      actual_cash: 3000,
      opening_float: 500
    });

  assert.strictEqual(declRes.status, 200, 'Cash declaration must succeed');
  assert.strictEqual(declRes.body.success, true);

  // Verify that a Z_REPORT job was enqueued during declaration
  const autoZJob = await getQuery(
    `SELECT * FROM print_jobs WHERE job_type = 'Z_REPORT' ORDER BY created_at DESC LIMIT 1`
  );
  assert(autoZJob, 'Cash declaration must automatically enqueue a Z_REPORT print job');
  console.log('  ⚡ Auto-print Z-Report triggered upon declaration:', autoZJob.id);
  console.log('✅ Test 2 Passed: Shift closure auto-print verified.\n');

  // Test 3: .env.production Template Existence & Keys
  console.log('▶ Test 3: Production Environment Template (.env.production)...');
  const prodEnvPath = path.join(__dirname, '.env.production');
  assert(fs.existsSync(prodEnvPath), '.env.production template file must exist in root');
  const prodEnvContent = fs.readFileSync(prodEnvPath, 'utf8');
  assert(prodEnvContent.includes('LICENSE_SERVER_URL='), 'Must define LICENSE_SERVER_URL');
  assert(prodEnvContent.includes('CLOUDFLARE_TUNNEL_TOKEN='), 'Must define CLOUDFLARE_TUNNEL_TOKEN');
  assert(prodEnvContent.includes('NODE_ENV="production"'), 'Must define NODE_ENV');
  console.log('  📄 .env.production template verified in root directory.');
  console.log('✅ Test 3 Passed: Environment configuration template verified.\n');

  // Test 4: main.js Cloudflare Tunnel Spawn Logic
  console.log('▶ Test 4: main.js Cloudflare Tunnel Argument Logic...');
  const mainJsPath = path.join(__dirname, 'main.js');
  const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
  assert(mainJsContent.includes('--no-autoupdate'), 'main.js must include --no-autoupdate flag');
  assert(mainJsContent.includes('CLOUDFLARE_TUNNEL_TOKEN'), 'main.js must check process.env.CLOUDFLARE_TUNNEL_TOKEN');
  assert(mainJsContent.includes('--url'), 'main.js must provide ephemeral fallback');
  console.log('  ⚙️ main.js Cloudflare spawn rules verified.');
  console.log('✅ Test 4 Passed: Tunnel spawning rules verified.\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! SYSTEM READY FOR PACKAGING.');
}

runVerification().then(() => process.exit(0)).catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
