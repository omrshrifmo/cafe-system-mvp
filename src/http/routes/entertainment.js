/**
 * Entertainment, Gaming Consoles, Billiards & WiFi Voucher HTTP Routes
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const {
  getRentableResources,
  startEntertainmentSession,
  stopEntertainmentSession,
  generateWifiVoucher
} = require('../../domain/hospitality/entertainmentService');
const { allQuery } = require('../../db/connection');

// List all entertainment resources
router.get('/entertainment/resources', requireAuth, async (req, res, next) => {
  try {
    const resources = await getRentableResources();
    res.json({ success: true, data: resources });
  } catch (err) {
    next(err);
  }
});

// Start rental session
router.post('/entertainment/sessions/start', requireAuth, async (req, res, next) => {
  try {
    const { resource_id, table_number, player_mode, notes } = req.body;
    if (!resource_id) {
      return res.status(400).json({ success: false, error: 'resource_id مطلوب' });
    }
    const result = await startEntertainmentSession(resource_id, { table_number, player_mode, notes }, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Stop rental session
router.post('/entertainment/sessions/:id/stop', requireAuth, async (req, res, next) => {
  try {
    const result = await stopEntertainmentSession(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// List WiFi vouchers
router.get('/wifi/vouchers', requireAuth, async (req, res, next) => {
  try {
    const vouchers = await allQuery(`SELECT * FROM wifi_vouchers ORDER BY created_at DESC LIMIT 50`);
    res.json({ success: true, data: vouchers });
  } catch (err) {
    next(err);
  }
});

// Generate WiFi voucher (MikroTik Hotspot API integration)
router.post('/wifi/voucher', requireAuth, async (req, res, next) => {
  try {
    const { profile, custom_code, price } = req.body;
    const result = await generateWifiVoucher({ profile, custom_code, price }, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
