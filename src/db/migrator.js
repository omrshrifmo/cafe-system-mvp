/**
 * Versioned Database Migration Engine
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, runQuery, allQuery } = require('./connection');
const { runTransaction } = require('./transaction');
const logger = require('../observability/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function getFileChecksum(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

async function initMigrationTable(db = null) {
  const sql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      status TEXT NOT NULL DEFAULT 'SUCCESS'
    )
  `;
  await runQuery(sql, [], db);
}

async function runMigrations(customDb = null) {
  const db = customDb || getDb();
  await initMigrationTable(db);

  const appliedRows = await allQuery(`SELECT version, checksum FROM schema_migrations WHERE status = 'SUCCESS'`, [], db);
  const appliedMap = new Map(appliedRows.map(r => [r.version, r.checksum]));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const migrationResults = [];

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const checksum = getFileChecksum(content);
    const version = file;

    if (appliedMap.has(version)) {
      const existingChecksum = appliedMap.get(version);
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${version}! Expected ${existingChecksum}, got ${checksum}. Migration history has been altered.`);
      }
      continue;
    }

    logger.info(`Applying migration: ${version}`);
    const startTime = Date.now();

    // Execute migration SQL inside transaction
    await runTransaction(async (tx) => {
      // Basic splitting for multiple statements in a single file
      const cleanSql = content
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of cleanSql) {
        await tx.run(statement);
      }

      const duration = Date.now() - startTime;
      await tx.run(
        `INSERT INTO schema_migrations (version, checksum, execution_time_ms, status) VALUES (?, ?, ?, 'SUCCESS')`,
        [version, checksum, duration]
      );
      migrationResults.push({ version, duration, status: 'SUCCESS' });
    }, db);

    logger.info(`Successfully applied migration: ${version} in ${Date.now() - startTime}ms`);
  }

  return migrationResults;
}

module.exports = {
  runMigrations,
  initMigrationTable
};
