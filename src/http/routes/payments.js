/**
 * Checkout, Quotations, Settle & Void HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { quoteSession, settleSession, voidOrder } = require('../../domain/payments/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// Server-authoritative quote calculation
router.get('/quote', async (req, res, next) => {
  try {
    const tableNumber = req.query.table_number ? parseInt(req.query.table_number, 10) : null;
    const sessionId = req.query.session_id || null;
    const target = tableNumber || sessionId;

    if (!target) {
      return res.status(400).json({ success: false, error: 'table_number or session_id is required' });
    }

    const quote = await quoteSession(target);
    res.json({
      success: true,
      quote
    });
  } catch (err) {
    next(err);
  }
});

// Checkout / Settle Bill
router.post('/checkout', requireAuth, requirePermission('payments:take'), async (req, res, next) => {
  try {
    const result = await settleSession(req.body, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Void Order (Requires Manager/Owner PIN, and Ultimate Void rule for paid orders)
router.post('/orders/:id/void', requireAuth, async (req, res, next) => {
  try {
    const { manager_pin, reason } = req.body;
    if (!manager_pin) {
      return res.status(400).json({ success: false, error: 'manager_pin is required' });
    }
    const result = await voidOrder(req.params.id, manager_pin, reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
