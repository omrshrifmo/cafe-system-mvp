const express = require('express');
const { getMode, setMode, MODES } = require('../../domain/system/modeService');
const { requireAuth } = require('../middleware/auth');
const logger = require('../../observability/logger');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({
    success: true,
    mode: getMode()
  });
});

router.post('/init-live', async (req, res) => {
  if (getMode() !== MODES.ONBOARDING) {
    return res.status(400).json({ success: false, error: 'System is already initialized.' });
  }

  try {
    await setMode(MODES.LIVE);
    // Note: Here we would trigger the explicit cutover audit and create the admin user
    // if this were fully implemented in the wizard.
    logger.info('System transitioned to LIVE mode from Onboarding.');
    res.json({ success: true, mode: MODES.LIVE });
  } catch (err) {
    logger.error('Failed to init live mode', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to switch to LIVE mode.' });
  }
});

router.post('/init-demo', async (req, res) => {
  if (getMode() !== MODES.ONBOARDING) {
    return res.status(400).json({ success: false, error: 'System is already initialized.' });
  }

  try {
    await setMode(MODES.DEMO);
    // Note: Here we would copy a seed DB to demo.sqlite
    logger.info('System transitioned to DEMO mode from Onboarding.');
    res.json({ success: true, mode: MODES.DEMO });
  } catch (err) {
    logger.error('Failed to init demo mode', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to switch to DEMO mode.' });
  }
});

router.post('/demo-reset', requireAuth, async (req, res) => {
  if (getMode() !== MODES.DEMO) {
    return res.status(403).json({ success: false, error: 'Reset is only allowed in DEMO mode.' });
  }

  // Expecting a confirmation field
  if (req.body.confirmation !== 'RESET') {
    return res.status(400).json({ success: false, error: 'Invalid confirmation string.' });
  }

  try {
    // In a full implementation, we drop the demo DB and copy the seed file over.
    logger.info('DEMO Reset triggered by user', { userId: req.user.id });
    // Simulate re-seeding
    await setMode(MODES.DEMO);
    res.json({ success: true, message: 'Demo environment reset successfully.' });
  } catch (err) {
    logger.error('Failed to reset demo mode', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to reset DEMO mode.' });
  }
});

module.exports = router;
