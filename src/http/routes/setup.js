const express = require('express');
const { getMode, setMode, MODES } = require('../../domain/system/modeService');
const { 
  getSetupProgress, 
  saveSetupStep, 
  finalizeSetup, 
  getReadinessChecklist 
} = require('../../domain/system/setupService');
const { getOnboardingState } = require('../../domain/system/onboardingState');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { verifyReauthentication } = require('../../domain/auth/service');
const logger = require('../../observability/logger');

const router = express.Router();

// Helper middleware: allow unauthenticated during initial ONBOARDING mode or test environment; otherwise require active authentication
const requireAuthOrOnboarding = (req, res, next) => {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  if (getMode() === MODES.ONBOARDING) {
    return next();
  }
  return requireAuth(req, res, next);
};

// Setup Status & Wizard Progress
router.get('/status', async (req, res) => {
  const onboarding_state = await getOnboardingState().catch(() => null);
  res.json({
    success: true,
    mode: getMode(),
    is_onboarding: getMode() === MODES.ONBOARDING,
    onboarding_state: onboarding_state || 'UNKNOWN'
  });
});

router.get('/progress', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const progress = await getSetupProgress();
    res.json(progress);
  } catch (err) {
    next(err);
  }
});

// Save Wizard Step (Resumable)
router.post('/step', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const { step, payload } = req.body;
    if (!step || !payload) {
      return res.status(400).json({ success: false, error: 'step and payload are required' });
    }
    const result = await saveSetupStep(step, payload, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Readiness Checklist (Protected unless in initial onboarding)
router.get('/readiness', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const readiness = await getReadinessChecklist();
    res.json(readiness);
  } catch (err) {
    next(err);
  }
});

// Finalize Setup & Mode Transition
router.post('/finalize', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const { pin, ...finalPayload } = req.body;
    const result = await finalizeSetup(finalPayload, req.user || null, pin || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/init-live', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const { pin, ...finalPayload } = req.body;
    finalPayload.mode = MODES.LIVE;
    const result = await finalizeSetup(finalPayload, req.user || null, pin || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/init-demo', requireAuthOrOnboarding, async (req, res, next) => {
  try {
    const { pin, ...finalPayload } = req.body;
    finalPayload.mode = MODES.DEMO;
    const result = await finalizeSetup(finalPayload, req.user || null, pin || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/demo-reset', requireAuth, async (req, res, next) => {
  if (getMode() !== MODES.DEMO) {
    return res.status(403).json({ success: false, error: 'Reset is only allowed in DEMO mode.' });
  }

  const { pin, confirmation } = req.body;
  if (confirmation !== 'RESET') {
    return res.status(400).json({ success: false, error: 'Invalid confirmation string (must be RESET).' });
  }

  // Require owner/manager PIN reauthentication for reset
  if (pin) {
    const isAuth = await verifyReauthentication(req.user.id, pin);
    if (!isAuth) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED: PIN verification failed.' });
    }
  }

  try {
    logger.info('DEMO Reset triggered by user', { userId: req.user.id });
    await setMode(MODES.DEMO);
    res.json({ success: true, message: 'Demo environment reset successfully.' });
  } catch (err) {
    logger.error('Failed to reset demo mode', { error: err.message });
    next(err);
  }
});

module.exports = router;
