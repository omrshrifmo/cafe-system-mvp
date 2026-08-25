/**
 * CLI utility for Database Migrations, Backups, and Restores
 */
const path = require('path');
const fs = require('fs');
const { getDb, closeDb } = require('./connection');
const { runMigrations } = require('./migrator');
const env = require('../config/env');
const logger = require('../observability/logger');

async function main() {
  const command = process.argv[2] || 'migrate';

  try {
    if (command === 'migrate') {
      console.log('🔄 Executing SQLite Database Migrations...');
      const results = await runMigrations();
      console.log(`✅ Applied ${results.length} new migration(s). Database is up to date.`);
    } else if (command === 'backup') {
      const { createHotBackup } = require('../domain/system/backupService');
      const backupDir = path.join(__dirname, '../../backups');
      const manifest = await createHotBackup(backupDir);
      console.log(`✅ Backup successfully created at: ${manifest.file_path} (SHA-256: ${manifest.sha256_checksum})`);
    } else if (command === 'status') {
      const { allQuery } = require('./connection');
      const applied = await allQuery("SELECT version, applied_at, status FROM schema_migrations;");
      console.log(`📊 Schema Migrations Applied: ${applied.length}`);
      applied.forEach(m => console.log(`  - [${m.status}] ${m.version} (${m.applied_at})`));
    } else if (command === 'restore') {
      const backupDir = path.join(__dirname, '../../backups');
      let sourcePath = process.argv[3];
      let targetPath = process.argv[4] || env.DB_PATH;
      if (!sourcePath && fs.existsSync(backupDir)) {
        const backups = fs.readdirSync(backupDir)
          .filter(f => (f.startsWith('cafe_backup_') || f.startsWith('cafe-backup-')) && (f.endsWith('.sqlite') || f.endsWith('.db')) && !f.endsWith('.enc'))
          .sort()
          .reverse();
        if (backups.length > 0) {
          sourcePath = path.join(backupDir, backups[0]);
        }
      }
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        console.error(`❌ Source backup file not found: ${sourcePath}`);
        process.exit(1);
      }
      console.log(`⚠️ Restoring database from: ${sourcePath} to ${targetPath}`);
      await closeDb();
      if (fs.existsSync(`${targetPath}-wal`)) fs.unlinkSync(`${targetPath}-wal`);
      if (fs.existsSync(`${targetPath}-shm`)) fs.unlinkSync(`${targetPath}-shm`);
      fs.copyFileSync(sourcePath, targetPath);
      console.log('🔄 Running migrations on restored database...');
      const { getDb } = require('./connection');
      const customDb = new (require('sqlite3').verbose().Database)(targetPath);
      await runMigrations(customDb);
      await new Promise(r => customDb.close(r));
      console.log('✅ Database restore and migration complete.');
    } else {
      console.error(`Unknown command: ${command}. Use: migrate | status | backup | restore <path>`);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Database CLI Operation failed:', err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
