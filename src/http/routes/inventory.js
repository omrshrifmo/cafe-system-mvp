/**
 * Inventory, Purchases, Waste, Transfers & Suppliers HTTP Routes
 * Strictly requires authentication and role permissions
 */
const express = require('express');
const router = express.Router();
const { getInventory, logPurchase, logWaste, transferMaterial } = require('../../domain/inventory/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');

router.get('/inventory', requireAuth, async (req, res, next) => {
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

router.get('/purchases', requireAuth, async (req, res, next) => {
  try {
    const purchases = await allQuery(
      `SELECT p.id, p.total_amount_minor / 100.0 as total_cost, p.invoice_number, p.notes, p.created_at,
              s.name as supplier_name,
              i.name as item_name, pi.unit, (pi.quantity_microunits / 1000000.0) as qty_added
       FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       LEFT JOIN purchase_items pi ON p.id = pi.purchase_id
       LEFT JOIN inventory_items i ON pi.inventory_item_id = i.id
       ORDER BY p.created_at DESC LIMIT 50`
    );
    res.json({
      success: true,
      purchases
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
router.get('/suppliers', requireAuth, async (req, res, next) => {
  try {
    const suppliers = await allQuery(`SELECT * FROM suppliers ORDER BY name ASC`);
    res.json({
      success: true,
      suppliers
    });
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
