/**
 * Enterprise Database Mutation Guard
 * Enforces strict isolation: Tests, fixture resets, and automated simulations
 * are strictly prohibited from connecting to, writing to, or resetting cafe.db
 * or any unapproved production database.
 */
const path = require('path');
const logger = require('../../observability/logger');

const PROD_DB_FILENAMES = ['cafe.db', 'production.sqlite', 'live.db'];

/**
 * Checks if a given database path is an approved isolated fixture or test database.
 * @param {string} dbPath 
 * @returns {boolean}
 */
function isApprovedTestDatabase(dbPath) {
  if (!dbPath) return false;
  const normalized = path.normalize(dbPath);
  const base = path.basename(normalized);

  // Strictly reject known production filenames
  if (PROD_DB_FILENAMES.includes(base)) {
    return false;
  }

  // Approved if located in test/fixtures/, artifacts/full-day/, backups/, or named with test_/fixture_/demo_/full_day_ prefix
  const isFixtureDir = normalized.includes(path.join('test', 'fixtures')) || normalized.includes('backups') || normalized.includes(path.join('artifacts', 'full-day'));
  const hasTestPrefix = base.startsWith('test') || base.startsWith('fixture') || base.startsWith('demo') || base.startsWith('full_day') || base.includes('_test_') || base.includes('_fixture_');

  return isFixtureDir || hasTestPrefix;
}

/**
 * Asserts that a mutation or test execution is operating against a safe, isolated database.
 * Throws MUTATION_GUARD_VIOLATION if attempting to mutate production databases.
 * @param {string} dbPath 
 * @param {string} operationDescription 
 */
function assertSafeMutationTarget(dbPath, operationDescription = 'Database Mutation') {
  if (!isApprovedTestDatabase(dbPath)) {
    const base = path.basename(dbPath || '');
    const errorMsg = `MUTATION_GUARD_VIOLATION: [${operationDescription}] Attempted mutation on unapproved or production database: "${base}". Tests and fixture operations MUST only target isolated fixture databases in test/fixtures/ (e.g., full_day_fixture.db, test_*.db).`;
    logger.error(errorMsg, { dbPath, operation: operationDescription });
    const err = new Error(errorMsg);
    err.code = 'MUTATION_GUARD_VIOLATION';
    throw err;
  }
}

module.exports = {
  isApprovedTestDatabase,
  assertSafeMutationTarget,
  PROD_DB_FILENAMES
};
