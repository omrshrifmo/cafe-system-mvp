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
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(__dirname, '../../backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const targetPath = process.argv[3] || path.join(backupDir, `cafe_backup_${timestamp}.db`);
      
      console.log(`💾 Creating online SQLite backup at: ${targetPath}`);
      const db = getDb();
      await new Promise((resolve, reject) => {
        const backupDb = new (require('sqlite3').verbose().Database)(targetPath);
        db.serialize(() => {
          db.run(`VACUUM INTO ?`, [targetPath], (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
      console.log(`✅ Backup successfully created at: ${targetPath}`);
    } else if (command === 'restore') {
      const sourcePath = process.argv[3];
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        console.error(`❌ Source backup file not found: ${sourcePath}`);
        process.exit(1);
      }
      console.log(`⚠️ Restoring database from: ${sourcePath} to ${env.DB_PATH}`);
      await closeDb();
      fs.copyFileSync(sourcePath, env.DB_PATH);
      console.log('🔄 Running migrations on restored database...');
      await runMigrations();
      console.log('✅ Database restore and migration complete.');
    } else {
      console.error(`Unknown command: ${command}. Use: migrate | backup | restore <path>`);
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
