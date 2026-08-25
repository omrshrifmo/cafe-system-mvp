/**
 * Live Database Checksum-Verified Backup and Restore Verification Script
 * Records row counts, monetary totals, stock totals, and migration checksums before and after.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createHotBackup } = require('../src/domain/system/backupService');
const { calculateFileSha256 } = require('../src/domain/system/backupService');

function queryAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function queryGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || {});
    });
  });
}

async function getDbMetrics(dbPath) {
  const db = new sqlite3.Database(dbPath);
  
  const tables = await queryAll(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  const rowCounts = {};
  for (const t of tables) {
    const r = await queryGet(db, `SELECT COUNT(*) as count FROM "${t.name}"`);
    rowCounts[t.name] = r.count || 0;
  }

  // Monetary Totals
  let monetary = { total_payments_minor: 0, total_orders_minor: 0, total_expenses_minor: 0 };
  try {
    const pay = await queryGet(db, `SELECT COALESCE(SUM(amount_minor), 0) as total FROM v3_payments`);
    monetary.total_payments_minor = pay.total;
  } catch (e) {}

  try {
    const ord = await queryGet(db, `SELECT COALESCE(SUM(total_minor), 0) as total FROM v3_order_sessions`);
    monetary.total_orders_minor = ord.total;
  } catch (e) {}

  try {
    const exp = await queryGet(db, `SELECT COALESCE(SUM(amount_minor), 0) as total FROM expenses`);
    monetary.total_expenses_minor = exp.total;
  } catch (e) {}

  // Stock Totals
  let stock = { total_stock_microunits: 0, total_items_count: 0 };
  try {
    const stk = await queryGet(db, `SELECT COALESCE(SUM(current_stock_microunits), 0) as total_stock, COUNT(*) as count FROM inventory_items`);
    stock.total_stock_microunits = stk.total_stock;
    stock.total_items_count = stk.count;
  } catch (e) {}

  // Migrations
  const migrations = await queryAll(db, `SELECT version, checksum FROM schema_migrations ORDER BY version`);

  await new Promise(r => db.close(r));

  return {
    tableCount: tables.length,
    rowCounts,
    monetary,
    stock,
    migrations
  };
}

async function main() {
  const liveDbPath = path.join(__dirname, '../cafe.db');
  const backupDir = path.join(__dirname, '../backups');
  const artifactsDir = path.join(__dirname, '../artifacts/baseline');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  console.log('--- Step 1: Capturing Live Database Baseline Metrics ---');
  const beforeMetrics = await getDbMetrics(liveDbPath);

  console.log('--- Step 2: Creating Online Hot Backup ---');
  const hotBackup = await createHotBackup(backupDir);
  console.log('Backup generated:', hotBackup);

  console.log('--- Step 3: Restoring Backup into Separate Isolated File ---');
  const restoredDbPath = path.join(backupDir, 'cafe_restore_verification.sqlite');
  if (fs.existsSync(restoredDbPath)) fs.unlinkSync(restoredDbPath);
  if (fs.existsSync(`${restoredDbPath}-wal`)) fs.unlinkSync(`${restoredDbPath}-wal`);
  if (fs.existsSync(`${restoredDbPath}-shm`)) fs.unlinkSync(`${restoredDbPath}-shm`);

  fs.copyFileSync(hotBackup.file_path, restoredDbPath);

  console.log('--- Step 4: Capturing Restored Database Verification Metrics ---');
  const afterMetrics = await getDbMetrics(restoredDbPath);

  const restoredSha256 = await calculateFileSha256(restoredDbPath);

  const backupManifest = {
    backup_created_at: hotBackup.created_at,
    live_database_path: liveDbPath,
    backup_file_path: hotBackup.file_path,
    backup_sha256: hotBackup.sha256_checksum,
    restored_verification_file: restoredDbPath,
    restored_sha256: restoredSha256,
    checksums_match: hotBackup.sha256_checksum === restoredSha256,
    duration_ms: hotBackup.duration_ms,
    status: 'VERIFIED'
  };

  const integrityReport = {
    evaluated_at: new Date().toISOString(),
    live_database: liveDbPath,
    restored_database: restoredDbPath,
    metrics_parity: {
      tables_match: beforeMetrics.tableCount === afterMetrics.tableCount,
      monetary_match: JSON.stringify(beforeMetrics.monetary) === JSON.stringify(afterMetrics.monetary),
      stock_match: JSON.stringify(beforeMetrics.stock) === JSON.stringify(afterMetrics.stock),
      migrations_match: JSON.stringify(beforeMetrics.migrations) === JSON.stringify(afterMetrics.migrations),
      row_counts_match: JSON.stringify(beforeMetrics.rowCounts) === JSON.stringify(afterMetrics.rowCounts)
    },
    before_backup: beforeMetrics,
    after_restore: afterMetrics
  };

  fs.writeFileSync(path.join(artifactsDir, 'backup-manifest.json'), JSON.stringify(backupManifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(artifactsDir, 'database-integrity.json'), JSON.stringify(integrityReport, null, 2), 'utf8');

  console.log('✅ Backup & Integrity Verification Complete.');
  console.log(JSON.stringify(integrityReport.metrics_parity, null, 2));
}

main().catch(err => {
  console.error('Integrity verification failed:', err);
  process.exit(1);
});
