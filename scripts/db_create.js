const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/db/migrator');
const { getDb, closeDb } = require('../src/db/connection');
const env = require('../src/config/env');
const logger = require('../src/observability/logger');

async function resetDb() {
  const dbPath = env.DB_PATH;
  
  if (dbPath.endsWith('cafe.db') && process.argv[2] !== '--force') {
    logger.error('Cannot reset LIVE database (cafe.db). Use --force if you are absolutely sure.');
    process.exit(1);
  }

  logger.info(`Resetting database at ${dbPath}...`);
  
  await closeDb();

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  logger.info('Running migrations to bootstrap fresh database...');
  const db = getDb(); // Re-open db which will create the file
  await runMigrations();
  await closeDb();

  logger.info('Database reset complete.');
}

if (require.main === module) {
  resetDb().catch(err => {
    console.error('Failed to reset database:', err);
    process.exit(1);
  });
}
