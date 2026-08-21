/**
 * Inventory, Purchases, Waste & Transfers HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { getInventory, logPurchase, logWaste, transferMaterial } = require('../../domain/inventory/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');

router.get('/inventory', async (req, res, next) => {
  try {
    const inventory = await getInventory();
    res.json({
      success: true,
      inventory,
      items: inventory
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inventory/purchase', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const result = await logPurchase(req.body, req.user ? req.user.id : null);
    res.json({
      success: true,
      message: 'تم تسجيل فاتورة المشتريات وإيداع المخزون بنجاح 📦',
      purchase: result
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inventory/waste', requireAuth, requirePermission('inventory:waste'), async (req, res, next) => {
  try {
    const result = await logWaste(req.body, req.user ? req.user.id : null);
    res.json({
      success: true,
      message: 'تم تسجيل الهالك وخصمه من المخزون بنجاح 🗑️',
      waste: result
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inventory/transfer', requireAuth, requirePermission('inventory:transfer'), async (req, res, next) => {
  try {
    const result = await transferMaterial(req.body, req.user ? req.user.id : null);
    res.json({
      success: true,
      message: 'تم تحويل الخامات بين الأقسام بنجاح 🔄',
      transfer: result
    });
  } catch (err) {
    next(err);
  }
});

// Suppliers
router.get('/suppliers', async (req, res, next) => {
  try {
    const suppliers = await allQuery(`SELECT * FROM suppliers ORDER BY name ASC`);
    res.json(suppliers);
  } catch (err) {
    next(err);
  }
});

router.post('/suppliers', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const { name, contact_person, phone, category, address, notes } = req.body;
    const result = await runQuery(
      `INSERT INTO suppliers (name, contact_person, phone, category, address, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, contact_person, phone, category, address, notes]
    );
    res.json({ success: true, supplier_id: result.lastID });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
