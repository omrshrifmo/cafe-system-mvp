/**
 * Database Connection Management (SQLite WAL Mode)
 */
const sqlite3 = require('sqlite3').verbose();
const env = require('../config/env');
const logger = require('../observability/logger');
const modeService = require('../domain/system/modeService');
const { assertSafeMutationTarget } = require('../domain/system/mutationGuard');

let dbInstance = null;
let currentDbPath = null;

function getDb(customPath = null) {
  const dbPath = customPath || modeService.getDatabasePath();

  if (customPath && customPath !== currentDbPath && dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {}
    dbInstance = null;
  }

  if (!dbInstance) {
    currentDbPath = dbPath;
    if (process.env.NODE_ENV === 'test' || customPath) {
      assertSafeMutationTarget(dbPath, 'DB Connection Initialized');
    }

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
      dbInstance.run('PRAGMA cache_size = -20000');
      dbInstance.run('PRAGMA temp_store = MEMORY');
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
        currentDbPath = null;
        resolve();
      });
    } else {
      currentDbPath = null;
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
