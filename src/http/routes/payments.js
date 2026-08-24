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

router.post('/quote', async (req, res, next) => {
  try {
    const { table_number, session_id, items = [] } = req.body;
    if (items && items.length > 0) {
      const { getSystemTaxConfig } = require('../../domain/payments/service');
      const { getMenuItemWithActivePriceAndBOM } = require('../../domain/catalog/service');
      const config = await getSystemTaxConfig();
      let subtotalMinor = 0;
      const verifiedItems = [];
      for (const it of items) {
        const catalogItem = await getMenuItemWithActivePriceAndBOM(it.item_id || it.id || it.name);
        const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
        const unitPriceMinor = catalogItem ? catalogItem.price_minor : (it.price_minor || 0);
        subtotalMinor += unitPriceMinor * qty;
        verifiedItems.push({
          item_id: catalogItem ? catalogItem.id : it.item_id,
          name: catalogItem ? catalogItem.name : it.name,
          unit_price_minor: unitPriceMinor,
          quantity: qty,
          total_price_minor: unitPriceMinor * qty
        });
      }
      let serviceMinor = 0;
      let taxMinor = 0;
      if (config.apply_taxes) {
        serviceMinor = Math.round((subtotalMinor * config.service_percent) / 100);
        const taxableBase = subtotalMinor + serviceMinor;
        taxMinor = Math.round((taxableBase * config.vat_percent) / 100);
      }
      const totalMinor = subtotalMinor + serviceMinor + taxMinor;
      return res.json({
        success: true,
        quote: {
          currency: config.currency,
          subtotal_minor: subtotalMinor,
          service_minor: serviceMinor,
          tax_minor: taxMinor,
          total_minor: totalMinor,
          subtotal: subtotalMinor / 100,
          service_amount: serviceMinor / 100,
          vat_amount: taxMinor / 100,
          total_amount: totalMinor / 100,
          items: verifiedItems
        }
      });
    }

    const target = table_number || session_id;
    if (!target) {
      return res.status(400).json({ success: false, error: 'table_number, session_id, or items is required' });
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

// Quotes Aliases
router.get('/quotes', async (req, res, next) => {
  req.url = '/quote' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  return router.handle(req, res, next);
});

router.post('/quotes', async (req, res, next) => {
  req.url = '/quote';
  return router.handle(req, res, next);
});

// Payments Roster / List
router.get('/payments', requireAuth, requirePermission('payments:take'), async (req, res, next) => {
  try {
    const { allQuery } = require('../../db/connection');
    const payments = await allQuery(
      `SELECT p.id, p.session_id, p.method, p.amount_minor, p.tip_minor, p.currency, p.created_at, u.name as cashier_name
       FROM payments p
       LEFT JOIN users u ON p.created_by = u.id
       ORDER BY p.created_at DESC LIMIT 50`
    );
    res.json({
      success: true,
      payments: payments.map(p => ({
        ...p,
        amount: p.amount_minor / 100,
        tip: p.tip_minor / 100
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Receipts retrieval
router.get('/receipts', requireAuth, async (req, res, next) => {
  try {
    const { allQuery } = require('../../db/connection');
    const recentReceipts = await allQuery(
      `SELECT p.id as receipt_id, p.session_id, p.amount_minor, p.method, p.created_at, os.table_id
       FROM payments p
       JOIN order_sessions os ON p.session_id = os.id
       ORDER BY p.created_at DESC LIMIT 20`
    );
    return res.json({
      success: true,
      receipts: recentReceipts.map(r => ({ ...r, amount: r.amount_minor / 100 }))
    });
  } catch (err) {
    next(err);
  }
});

router.get('/receipts/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId;
    const { allQuery, getQuery } = require('../../db/connection');
    const session = await getQuery(`SELECT * FROM order_sessions WHERE id = ?`, [sessionId]);
    if (!session) {
      return res.status(404).json({ success: false, error: 'جلسة الطلب غير موجودة' });
    }

    const items = await allQuery(`SELECT id, item_name_snapshot as item_name, unit_price_minor, quantity FROM order_items WHERE session_id = ?`, [sessionId]);
    const payments = await allQuery(`SELECT id, method, amount_minor, created_at FROM payments WHERE session_id = ?`, [sessionId]);

    res.json({
      success: true,
      receipt: {
        session_id: session.id,
        table_id: session.table_id,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
        items: items.map(i => ({ ...i, price: i.unit_price_minor / 100 })),
        payments: payments.map(p => ({ ...p, amount: p.amount_minor / 100 }))
      }
    });
  } catch (err) {
    next(err);
  }
});

// Settle Checkout
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
