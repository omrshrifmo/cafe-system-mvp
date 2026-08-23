const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const logger = require('../../observability/logger');

const MODE_FILE_PATH = path.join(__dirname, '../../../.app_mode.json');

const MODES = {
  ONBOARDING: 'ONBOARDING',
  DEMO: 'DEMO',
  LIVE: 'LIVE'
};

let currentModeCache = null;

function getMode() {
  if (currentModeCache) {
    return currentModeCache;
  }

  if (process.env.APP_MODE && MODES[process.env.APP_MODE]) {
    currentModeCache = process.env.APP_MODE;
    return currentModeCache;
  }

  if (fs.existsSync(MODE_FILE_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(MODE_FILE_PATH, 'utf8'));
      if (MODES[data.mode]) {
        currentModeCache = data.mode;
        return currentModeCache;
      }
    } catch (err) {
      logger.error('Failed to read .app_mode.json', { error: err.message });
    }
  }
  
  if (env.NODE_ENV === 'test') {
    currentModeCache = MODES.LIVE;
    return currentModeCache;
  }

  // Default to ONBOARDING if no valid file is found
  currentModeCache = MODES.ONBOARDING;
  return currentModeCache;
}

function getDatabasePath() {
  if (env.NODE_ENV === 'test') {
    if (process.env.TEST_DB_PATH) {
      return process.env.TEST_DB_PATH;
    }
    if (process.env.DB_PATH && !process.env.DB_PATH.endsWith('cafe.db')) {
      return process.env.DB_PATH;
    }
    return path.join(__dirname, '../../../test/fixtures/full_day_fixture.db');
  }

  const mode = getMode();
  if (mode === MODES.DEMO) {
    return path.join(path.dirname(env.DB_PATH), 'demo.sqlite');
  }
  return env.DB_PATH;
}

async function setMode(newMode) {
  if (!MODES[newMode]) {
    throw new Error(`Invalid mode: ${newMode}`);
  }

  logger.info(`Switching application mode from ${getMode()} to ${newMode}`);
  
  // Update cache and write to file
  currentModeCache = newMode;
  fs.writeFileSync(MODE_FILE_PATH, JSON.stringify({ mode: newMode, updatedAt: new Date().toISOString() }, null, 2), 'utf8');

  // Close the database connection dynamically (require here to avoid circular dependencies)
  const { closeDb } = require('../../db/connection');
  await closeDb();

  logger.info('Application mode switched successfully', { mode: newMode });
}

module.exports = {
  MODES,
  getMode,
  getDatabasePath,
  setMode
};
