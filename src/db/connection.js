/**
 * Database Connection Management (SQLite WAL Mode)
 */
const sqlite3 = require('sqlite3').verbose();
const env = require('../config/env');
const logger = require('../observability/logger');

let dbInstance = null;

function getDb(customPath = null) {
  if (!dbInstance) {
    const dbPath = customPath || env.DB_PATH;
    dbInstance = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error('Failed to connect to SQLite database', { error: err.message, path: dbPath });
        throw err;
      }
    });

    // Configure connection pragmas for concurrency and durability
    dbInstance.serialize(() => {
      dbInstance.run('PRAGMA foreign_keys = ON');
      dbInstance.run('PRAGMA journal_mode = WAL');
      dbInstance.run('PRAGMA synchronous = NORMAL');
      dbInstance.run('PRAGMA busy_timeout = 5000');
    });
  }
  return dbInstance;
}

function closeDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      dbInstance.close((err) => {
        if (err) {
          logger.error('Error closing SQLite database', { error: err.message });
          return reject(err);
        }
        dbInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Promisified database helper methods
function runQuery(sql, params = [], customDb = null) {
  const db = customDb || getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = [], customDb = null) {
  const db = customDb || getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function allQuery(sql, params = [], customDb = null) {
  const db = customDb || getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

module.exports = {
  getDb,
  closeDb,
  runQuery,
  getQuery,
  allQuery
};
