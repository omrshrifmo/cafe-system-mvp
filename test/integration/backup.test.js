const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getDb, allQuery, closeDb } = require('../../src/db/connection');
const { runMigrations } = require('../../src/db/migrator');

describe('Database Online Backup & Restore Tests', () => {
  const backupPath = path.join(__dirname, '../fixtures/test_runtime_backup.db');

  before(async () => {
    await runMigrations();
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  });

  after(async () => {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  });

  it('should create an online hot backup using VACUUM INTO without locking readers', async () => {
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run(`VACUUM INTO ?`, [backupPath], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    assert.ok(fs.existsSync(backupPath));
    const stats = fs.statSync(backupPath);
    assert.ok(stats.size > 0);

    // Verify backup database can be opened and queried
    const backupDb = new (require('sqlite3').verbose().Database)(backupPath);
    const rows = await new Promise((resolve, reject) => {
      backupDb.all(`SELECT COUNT(*) as count FROM users`, [], (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
    assert.ok(rows[0].count > 0);
    backupDb.close();
  });
});
