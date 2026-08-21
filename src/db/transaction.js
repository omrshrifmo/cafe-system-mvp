/**
 * Async Transaction Helper with Mutex Queue for Atomic Operations
 */
const { getDb } = require('./connection');

let txQueue = Promise.resolve();

async function runTransaction(callback, customDb = null) {
  const db = customDb || getDb();

  // Chain transaction execution to prevent overlapping BEGIN IMMEDIATE on single SQLite connection
  return new Promise((resolve, reject) => {
    txQueue = txQueue.then(async () => {
      try {
        await new Promise((res, rej) => {
          db.run('BEGIN IMMEDIATE TRANSACTION', (err) => err ? rej(err) : res());
        });

        // Execute transaction callback
        const result = await callback({
          run: (sql, params = []) => new Promise((res, rej) => {
            db.run(sql, params, function (err) {
              if (err) return rej(err);
              res({ lastID: this.lastID, changes: this.changes });
            });
          }),
          get: (sql, params = []) => new Promise((res, rej) => {
            db.get(sql, params, (err, row) => {
              if (err) return rej(err);
              res(row || null);
            });
          }),
          all: (sql, params = []) => new Promise((res, rej) => {
            db.all(sql, params, (err, rows) => {
              if (err) return rej(err);
              res(rows || []);
            });
          })
        });

        await new Promise((res, rej) => {
          db.run('COMMIT', (err) => err ? rej(err) : res());
        });

        resolve(result);
      } catch (err) {
        await new Promise((res) => {
          db.run('ROLLBACK', () => res());
        });
        reject(err);
      }
    }).catch(err => {
      reject(err);
    });
  });
}

module.exports = {
  runTransaction
};
