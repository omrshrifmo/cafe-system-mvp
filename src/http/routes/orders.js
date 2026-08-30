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
    res.json({
      success: true,
      orders,
      data: { orders },
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Get recently delivered BOH orders (optionally filtered by department and paginated)
router.get('/orders/past', async (req, res, next) => {
  try {
    const dept = req.query.department || req.query.category || null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const result = await getPastOrdersByDepartment(dept, { limit, offset });
    res.json({
      success: true,
      orders: result.orders || result,
      data: { orders: result.orders || result, pagination: result.pagination },
      pagination: result.pagination,
      requestId: req.id
    });
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
router.all('/orders/:id/status', requireAuth, async (req, res, next) => {
  if (req.method !== 'PUT' && req.method !== 'PATCH') return next();
  try {
    const { status } = req.body;
    const result = await updateKdsStatus(req.params.id, status, req.user);
    res.json({
      success: true,
      result,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// Request order cancellation (Waiter) - supports both /orders/:id/cancel-request and /orders/request-cancel
router.post('/orders/:id/cancel-request', requireAuth, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const result = await requestOrderCancellation(req.params.id, req.user ? req.user.id : null, reason);
    res.json({ success: true, edit_request: result ? result.edit_request : 'CANCEL_REQUESTED', result, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/request-cancel', requireAuth, async (req, res, next) => {
  try {
    const { order_id, id, reason } = req.body;
    const targetId = order_id || id;
    const result = await requestOrderCancellation(targetId, req.user ? req.user.id : null, reason);
    res.json({ success: true, edit_request: result ? result.edit_request : 'CANCEL_REQUESTED', result, data: result });
  } catch (err) {
    next(err);
  }
});

// Resolve order cancellation handshake (Barista / Chef / Shiash / Manager)
router.post('/orders/:id/cancel-resolve', requireAuth, async (req, res, next) => {
  try {
    const { approved, approve } = req.body;
    const isApproved = approved === true || approve === true;
    const result = await resolveOrderCancellation(req.params.id, isApproved, req.user ? req.user.id : null);
    res.json({ success: true, result, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/cancel-resolve', requireAuth, async (req, res, next) => {
  try {
    const { order_id, id, approved, approve } = req.body;
    const targetId = order_id || id;
    const isApproved = approved === true || approve === true;
    const result = await resolveOrderCancellation(targetId, isApproved, req.user ? req.user.id : null);
    res.json({ success: true, result, data: result });
  } catch (err) {
    next(err);
  }
});

// Public guest QR order (supports /public/orders and /public/order)
router.post(['/public/orders', '/public/order'], async (req, res, next) => {
  try {
    const { table_number, table_id, token, table_token, items, item_name, quantity, price, notes, item_notes } = req.body;
    
    // Resolve table number from explicit field, id, or token payload
    let targetTable = table_number || table_id;
    if (!targetTable && (token || table_token)) {
      const rawToken = String(token || table_token);
      const match = rawToken.match(/(?:table[_-]?|t[_-]?)?(\d+)/i);
      if (match) {
        targetTable = parseInt(match[1], 10);
      }
    }

    if (!targetTable && targetTable !== 0) {
      return res.status(400).json({ success: false, error: 'رقم الطاولة أو الرمز التعريفي مطلوب' });
    }

    // Normalize items array
    let itemsToOrder = [];
    if (Array.isArray(items) && items.length > 0) {
      itemsToOrder = items.map(it => ({
        menu_item_id: it.id || it.item_id || it.menu_item_id,
        item_name: it.name || it.item_name,
        name: it.name || it.item_name,
        quantity: parseInt(it.qty || it.quantity || 1, 10),
        price: Number(it.price) || 0,
        notes: it.notes || it.item_notes || '',
        sugar_level: it.sugar || it.sugar_level || 'مظبوط',
        roast_type: it.roast || it.roast_type || 'افتراضي',
        department: it.department || 'BARISTA'
      }));
    } else if (item_name) {
      itemsToOrder = [{
        item_name: item_name,
        name: item_name,
        quantity: parseInt(quantity || 1, 10),
        price: Number(price) || 0,
        notes: notes || item_notes || '',
        sugar_level: req.body.sugar_level || req.body.sugar || 'مظبوط',
        roast_type: req.body.roast_type || req.body.roast || 'افتراضي',
        department: req.body.department || 'BARISTA'
      }];
    } else {
      return res.status(400).json({ success: false, error: 'يجب اختيار أصناف للطلب' });
    }

    const result = await submitOrderWithBOM({
      table_number: targetTable,
      items: itemsToOrder,
      notes: notes || item_notes || 'طلب طاولة من المنيو الإلكتروني (QR)'
    }, null);

    res.json({
      success: true,
      message: 'تم إرسال طلبك إلى المطبخ بنجاح! سيصلك الطلب قريباً ☕',
      order: result,
      order_id: result.id || (result.items && result.items[0] ? result.items[0].id : null)
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// KDS Station Endpoints
// ==========================================
const { getKdsOrdersByStation, updateKdsLineState } = require('../../domain/kds/kdsService');
const { getRunnerTasks, claimTask, completeTask } = require('../../domain/floor/runnerService');

// Get active KDS orders for a station
router.get('/kds/orders', requireAuth, async (req, res, next) => {
  try {
    const station = (req.query.station || req.user.role || 'KITCHEN').toUpperCase();
    const venueId = req.query.venueId || 'V_DEFAULT';
    const orders = await getKdsOrdersByStation(venueId, station);
    res.json({
      success: true,
      station,
      orders
    });
  } catch (err) {
    next(err);
  }
});

// Update KDS Line Status
router.post('/kds/lines/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status, state, expected_version } = req.body;
    const targetState = status || state;
    const result = await updateKdsLineState(
      req.params.id,
      targetState,
      req.user ? req.user.id : null,
      expected_version,
      req.user ? req.user.role : null
    );
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

router.put('/kds/lines/:id/status', requireAuth, async (req, res, next) => {
  req.url = `/kds/lines/${req.params.id}/status`;
  return router.handle(req, res, next);
});

// ==========================================
// Runner / Waiter Tasks Endpoints
// ==========================================

// Get active runner tasks
router.get('/runner/tasks', requireAuth, async (req, res, next) => {
  try {
    const venueId = req.query.venueId || 'V_DEFAULT';
    const status = req.query.status || null;
    const tasks = await getRunnerTasks(venueId, status);
    res.json({
      success: true,
      tasks
    });
  } catch (err) {
    next(err);
  }
});

// Claim runner task
router.post('/runner/tasks/:id/claim', requireAuth, async (req, res, next) => {
  try {
    const { expected_version } = req.body;
    const result = await claimTask(
      req.params.id,
      req.user ? req.user.id : '109',
      expected_version
    );
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// Complete runner task
router.post('/runner/tasks/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const { expected_version } = req.body;
    const result = await completeTask(
      req.params.id,
      req.user ? req.user.id : '109',
      expected_version
    );
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
