/**
 * Inventory, Purchases Lifecycle, Stocktakes, Transfers & Suppliers HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { 
  getInventory, 
  getInventoryReconciliationAudit, 
  logPurchase, 
  logWaste, 
  transferMaterial,
  createStocktakeFreeze,
  recordStocktakeCount,
  reviewStocktake,
  postStocktake
} = require('../../domain/inventory/service');
const {
  getPurchases,
  getPurchaseById,
  createPurchaseDraft,
  submitPurchase,
  approvePurchase,
  receivePurchase,
  reversePurchase,
  getSupplierMaster
} = require('../../domain/inventory/purchasingService');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery } = require('../../db/connection');

// Inventory list & reconciliation audit
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

router.get('/inventory/reconciliation', requireAuth, requirePermission('inventory:read'), async (req, res, next) => {
  try {
    const reconciliation = await getInventoryReconciliationAudit();
    res.json({
      success: true,
      reconciliation
    });
  } catch (err) {
    next(err);
  }
});

// Purchases Lifecycle
router.get('/purchases', requireAuth, async (req, res, next) => {
  try {
    const purchases = await getPurchases(req.query);
    res.json({
      success: true,
      purchases
    });
  } catch (err) {
    next(err);
  }
});

router.get('/purchases/:id', requireAuth, async (req, res, next) => {
  try {
    const purchase = await getPurchaseById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND: أمر الشراء غير موجود' });
    }
    res.json({ success: true, purchase });
  } catch (err) {
    next(err);
  }
});

router.post('/purchases/draft', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const result = await createPurchaseDraft(req.body, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/purchases/:id/submit', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const result = await submitPurchase(req.params.id, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/purchases/:id/approve', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const { pin } = req.body;
    const result = await approvePurchase(req.params.id, req.user ? req.user.id : null, pin || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/purchases/:id/receive', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key || null;
    const result = await receivePurchase(req.params.id, req.body, req.user ? req.user.id : null, idempotencyKey);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/purchases/:id/reverse', requireAuth, requirePermission('inventory:purchase'), async (req, res, next) => {
  try {
    const { pin, reason } = req.body;
    const result = await reversePurchase(req.params.id, reason, req.user ? req.user.id : null, pin || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Legacy direct purchase (backward compatible)
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

// Waste & Material Transfers
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

// Stocktaking (Physical Inventory)
router.get('/stocktakes', requireAuth, requirePermission('inventory:read'), async (req, res, next) => {
  try {
    const sessions = await allQuery(`SELECT * FROM stocktake_sessions ORDER BY created_at DESC LIMIT 50`);
    res.json({ success: true, sessions });
  } catch (err) {
    next(err);
  }
});

router.post('/stocktakes/freeze', requireAuth, requirePermission('inventory:manage'), async (req, res, next) => {
  try {
    const result = await createStocktakeFreeze(req.body.venue_id || 'V_DEFAULT', req.body.notes, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/stocktakes/:id/count', requireAuth, requirePermission('inventory:manage'), async (req, res, next) => {
  try {
    const result = await recordStocktakeCount(req.params.id, req.body.lines || [], req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/stocktakes/:id/review', requireAuth, requirePermission('inventory:manage'), async (req, res, next) => {
  try {
    const result = await reviewStocktake(req.params.id, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/stocktakes/:id/post', requireAuth, requirePermission('inventory:manage'), async (req, res, next) => {
  try {
    const { pin } = req.body;
    const result = await postStocktake(req.params.id, req.user ? req.user.id : null, pin || null);
    res.json(result);
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

router.get('/suppliers/:id', requireAuth, async (req, res, next) => {
  try {
    const supplier = await getSupplierMaster(req.params.id);
    res.json({
      success: true,
      supplier
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
