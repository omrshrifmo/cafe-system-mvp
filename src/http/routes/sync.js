/**
 * Offline Sync Batch Commands HTTP Route
 */
const express = require('express');
const router = express.Router();
const { processClientSyncBatch } = require('../../domain/sync/service');
const { requireAuth } = require('../middleware/auth');

router.post('/sync/commands', requireAuth, async (req, res, next) => {
  try {
    const { commands = [] } = req.body;
    const result = await processClientSyncBatch(commands, req.user);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sync/batch', requireAuth, async (req, res, next) => {
  req.url = '/sync/commands';
  return router.handle(req, res, next);
});

module.exports = router;
