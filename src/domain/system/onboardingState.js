/**
 * Onboarding State — Server-Authoritative
 *
 * Stores and reads onboarding_state from system_config table.
 * States: UNINITIALIZED | IN_PROGRESS | COMPLETE | LOCKED
 *
 * NEVER use localStorage or client-side state as authority.
 */
'use strict';
const { getQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

const ONBOARDING_STATES = {
  UNINITIALIZED: 'UNINITIALIZED',
  IN_PROGRESS:   'IN_PROGRESS',
  COMPLETE:      'COMPLETE',
  LOCKED:        'LOCKED',
};

/**
 * Ensure the onboarding_state row exists in system_config.
 * Called once at startup.
 */
async function seedOnboardingState() {
  try {
    const existing = await getQuery(
      "SELECT value FROM system_config WHERE key = 'onboarding_state' LIMIT 1",
      []
    );
    if (!existing) {
      // ── Legacy DB detection: if users or venue config already exist, this system
      // is already set up. Seed COMPLETE rather than UNINITIALIZED to avoid
      // redirecting to the setup wizard on an already-configured system.
      let inferredState = 'UNINITIALIZED';
      try {
        const [userCount, venueName] = await Promise.all([
          getQuery("SELECT COUNT(*) as cnt FROM v3_users", []),
          getQuery("SELECT value FROM system_config WHERE key = 'cafe_name' LIMIT 1", []),
        ]);
        const hasUsers = userCount && userCount.cnt > 0;
        const hasVenue = !!venueName;
        if (hasUsers || hasVenue) {
          inferredState = 'COMPLETE';
          logger.info('[onboardingState] Legacy DB detected (users/venue exist) — seeding COMPLETE');
        }
      } catch (_) { /* table may not exist on truly fresh DB */ }

      await runQuery(
        "INSERT INTO system_config (key, value) VALUES ('onboarding_state', ?)",
        [inferredState]
      );
      logger.info(`[onboardingState] Seeded onboarding_state = ${inferredState}`);
    } else if (existing.value === 'UNINITIALIZED') {
      // Also fix already-seeded UNINITIALIZED for legacy DBs that got seeded incorrectly
      try {
        const [userCount, venueName] = await Promise.all([
          getQuery("SELECT COUNT(*) as cnt FROM v3_users", []),
          getQuery("SELECT value FROM system_config WHERE key = 'cafe_name' LIMIT 1", []),
        ]);
        const hasUsers = userCount && userCount.cnt > 0;
        const hasVenue = !!venueName;
        if (hasUsers || hasVenue) {
          await runQuery(
            "UPDATE system_config SET value = 'COMPLETE' WHERE key = 'onboarding_state'",
            []
          );
          logger.info('[onboardingState] Promoted UNINITIALIZED → COMPLETE (legacy DB with existing data)');
        }
      } catch (_) { /* ignore */ }
    }
  } catch (e) {
    logger.error('[onboardingState] Failed to seed onboarding_state:', { error: e.message });
  }
}


/**
 * Get the current onboarding state from the DB.
 * Returns one of: UNINITIALIZED | IN_PROGRESS | COMPLETE | LOCKED | null
 */
async function getOnboardingState() {
  try {
    const row = await getQuery(
      "SELECT value FROM system_config WHERE key = 'onboarding_state' LIMIT 1",
      []
    );
    return row ? row.value : null;
  } catch (e) {
    logger.error('[onboardingState] Failed to read onboarding_state:', { error: e.message });
    return null;
  }
}

/**
 * Set the onboarding state persistently in system_config.
 * @param {string} state — one of ONBOARDING_STATES
 */
async function setOnboardingState(state) {
  if (!Object.values(ONBOARDING_STATES).includes(state)) {
    throw new Error(`INVALID_ONBOARDING_STATE: ${state}`);
  }
  try {
    const existing = await getQuery(
      "SELECT value FROM system_config WHERE key = 'onboarding_state' LIMIT 1",
      []
    );
    if (existing) {
      await runQuery(
        "UPDATE system_config SET value = ? WHERE key = 'onboarding_state'",
        [state]
      );
    } else {
      await runQuery(
        "INSERT INTO system_config (key, value) VALUES ('onboarding_state', ?)",
        [state]
      );
    }
    logger.info(`[onboardingState] State changed to ${state}`);
  } catch (e) {
    logger.error('[onboardingState] Failed to set onboarding_state:', { error: e.message });
    throw e;
  }
}

async function isUninitialized() {
  const s = await getOnboardingState();
  return !s || s === ONBOARDING_STATES.UNINITIALIZED;
}

async function isComplete() {
  const s = await getOnboardingState();
  return s === ONBOARDING_STATES.COMPLETE || s === ONBOARDING_STATES.LOCKED;
}

module.exports = {
  ONBOARDING_STATES,
  seedOnboardingState,
  getOnboardingState,
  setOnboardingState,
  isUninitialized,
  isComplete,
};
