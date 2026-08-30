/**
 * Menu Engineering & Recipe Margin Analytics HTTP Routes
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const {
  getMenuEngineeringReport,
  calculateItemDynamicCost
} = require('../../domain/catalog/menuEngineeringService');

// Get BCG Matrix report
router.get('/menu-engineering', requireAuth, async (req, res, next) => {
  try {
    const threshold = parseFloat(req.query.threshold) || 40;
    const report = await getMenuEngineeringReport(threshold);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// Get individual item dynamic cost breakdown
router.get('/menu-engineering/item/:id', requireAuth, async (req, res, next) => {
  try {
    const costData = await calculateItemDynamicCost(req.params.id);
    res.json({ success: true, ...costData });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
