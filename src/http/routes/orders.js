/**
 * Orders & KDS Lifecycle HTTP Routes
 */
const express = require('express');
const router = express.Router();
const {
  submitOrderWithBOM,
  updateKdsStatus,
  requestOrderCancellation,
  resolveOrderCancellation,
  getPendingOrdersByDepartment,
  getPastOrdersByDepartment
} = require('../../domain/orders/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery } = require('../../db/connection');

// Get active BOH orders (optionally filtered by department)
router.get('/orders', async (req, res, next) => {
  try {
    const dept = req.query.department || null;
    const orders = await getPendingOrdersByDepartment(dept);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// Get recently delivered BOH orders (optionally filtered by department)
router.get('/orders/past', async (req, res, next) => {
  try {
    const dept = req.query.department || null;
    const orders = await getPastOrdersByDepartment(dept);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// Submit new order (POS / Waiter / QR)
router.post('/orders', requireAuth, async (req, res, next) => {
  try {
    const result = await submitOrderWithBOM(req.body, req.user ? req.user.id : null);
    res.json({
      success: true,
      message: 'تم تسجيل الطلب وتحديث المخزون بنجاح ☕',
      order: result
    });
  } catch (err) {
    next(err);
  }
});

// Update KDS status (ACCEPTED, READY, DELIVERED)
router.put('/orders/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    const result = await updateKdsStatus(req.params.id, status, req.user);
    res.json({
      success: true,
      result
    });
  } catch (err) {
    next(err);
  }
});

// Request order cancellation (Waiter)
router.post('/orders/:id/cancel-request', requireAuth, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const result = await requestOrderCancellation(req.params.id, req.user ? req.user.id : null, reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Resolve order cancellation handshake (Barista / Chef / Shiash / Manager)
router.post('/orders/:id/cancel-resolve', requireAuth, async (req, res, next) => {
  try {
    const { approved } = req.body;
    const result = await resolveOrderCancellation(req.params.id, approved === true, req.user ? req.user.id : null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Public guest QR order
router.post('/public/order', async (req, res, next) => {
  try {
    const { table_number, table_id, items, notes } = req.body;
    const targetTable = table_number || table_id;
    if (!targetTable) {
      return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'يجب اختيار أصناف للطلب' });
    }
    const result = await submitOrderWithBOM({
      table_number: targetTable,
      items: items.map(it => ({
        menu_item_id: it.id || it.menu_item_id,
        item_name: it.name || it.item_name,
        quantity: it.qty || it.quantity || 1,
        price: it.price || 0,
        notes: it.notes || '',
        sugar_level: it.sugar || it.sugar_level || 'مظبوط',
        roast_type: it.roast || it.roast_type || 'افتراضي'
      })),
      notes: notes || 'طلب طاولة من المنيو الإلكتروني (QR)'
    }, null);

    res.json({
      success: true,
      message: 'تم إرسال طلبك إلى المطبخ بنجاح! سيصلك الطلب قريباً ☕',
      order: result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
