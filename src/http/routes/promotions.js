/**
 * Advanced Offers & Promotions HTTP Routes
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const {
  getAllPromotions,
  createPromotion,
  togglePromotion,
  deletePromotion,
  evaluateBestPromotion
} = require('../../domain/promotions/promotionEngine');

// List promotions
router.get('/promotions', requireAuth, async (req, res, next) => {
  try {
    const promotions = await getAllPromotions();
    res.json({ success: true, data: promotions, promotions });
  } catch (err) {
    next(err);
  }
});

// Create promotion (OP_MANAGER, OWNER, SUPER_ADMIN)
router.post('/promotions', requireAuth, async (req, res, next) => {
  try {
    const result = await createPromotion(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Toggle active status
router.put('/promotions/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const { is_active } = req.body;
    const result = await togglePromotion(req.params.id, is_active);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Delete promotion
router.delete('/promotions/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await deletePromotion(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Evaluate cart promotions
router.post('/promotions/evaluate', requireAuth, async (req, res, next) => {
  try {
    const { items = [], subtotal, customer_tier } = req.body;
    const result = await evaluateBestPromotion(items, { subtotalMinor: subtotal ? Math.round(subtotal * 100) : null, customer_tier });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
