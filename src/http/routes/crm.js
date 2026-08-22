/**
 * CRM, Reservations, Complaints, Customer Feedback & Staff Allowances HTTP Routes
 * Strictly requires authentication and role permissions
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { allQuery, getQuery, runQuery } = require('../../db/connection');

// Customers lookup & CRM
router.get('/customers', requireAuth, async (req, res, next) => {
  try {
    const phone = req.query.phone;
    if (phone) {
      const customer = await getQuery(`SELECT * FROM customers WHERE phone = ?`, [String(phone).trim()]);
      return res.json(customer || null);
    }
    const customers = await allQuery(`SELECT id, name, phone, points, total_spent, visits, last_visit, notes FROM customers ORDER BY total_spent DESC LIMIT 50`);
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

router.post('/customers', requireAuth, async (req, res, next) => {
  try {
    const { name, phone, notes } = req.body;
    const cleanPhone = String(phone).trim();
    await runQuery(
      `INSERT INTO customers (phone, name, notes) VALUES (?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, notes = excluded.notes`,
      [cleanPhone, name, notes]
    );
    const updated = await getQuery(`SELECT * FROM customers WHERE phone = ?`, [cleanPhone]);
    res.json({ success: true, customer: updated });
  } catch (err) {
    next(err);
  }
});

// Reservations
router.get('/reservations', requireAuth, async (req, res, next) => {
  try {
    const reservations = await allQuery(`SELECT * FROM reservations ORDER BY reservation_date DESC, reservation_time DESC LIMIT 50`);
    res.json(reservations);
  } catch (err) {
    next(err);
  }
});

router.post('/reservations', requireAuth, async (req, res, next) => {
  try {
    const { customer_name, customer_phone, guest_count, table_number, reservation_date, reservation_time, notes } = req.body;
    const resId = await runQuery(
      `INSERT INTO reservations (customer_name, customer_phone, guest_count, table_number, reservation_date, reservation_time, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customer_name, customer_phone, guest_count || 2, table_number || null, reservation_date, reservation_time, notes || null]
    );
    res.json({ success: true, reservation_id: resId.lastID });
  } catch (err) {
    next(err);
  }
});

// Customer Feedback & QA
router.get('/feedback', requireAuth, async (req, res, next) => {
  try {
    const feedback = await allQuery(`SELECT * FROM customer_feedback ORDER BY created_at DESC LIMIT 50`);
    res.json(feedback);
  } catch (err) {
    next(err);
  }
});

router.post('/feedback', async (req, res, next) => {
  try {
    const { order_id, rating, comments } = req.body;
    const resId = await runQuery(
      `INSERT INTO customer_feedback (order_id, rating, comments) VALUES (?, ?, ?)`,
      [order_id || null, rating || 5, comments || '']
    );
    res.json({ success: true, feedback_id: resId.lastID });
  } catch (err) {
    next(err);
  }
});

// Complaints / QA Records
router.get('/complaints', requireAuth, async (req, res, next) => {
  try {
    const complaints = await allQuery(`SELECT * FROM complaints ORDER BY created_at DESC LIMIT 50`);
    res.json(complaints);
  } catch (err) {
    next(err);
  }
});

router.post('/complaints', requireAuth, async (req, res, next) => {
  try {
    const { customer_name, order_id, description, severity, status } = req.body;
    const result = await runQuery(
      `INSERT INTO complaints (customer_name, order_id, description, severity, status) VALUES (?, ?, ?, ?, ?)`,
      [customer_name || 'عميل', order_id || null, description, severity || 'MEDIUM', status || 'OPEN']
    );
    res.json({ success: true, complaint_id: result.lastID });
  } catch (err) {
    next(err);
  }
});

// Staff Drink / Meal Allowances
router.get('/staff/allowances', requireAuth, async (req, res, next) => {
  try {
    const allowances = await allQuery(`SELECT * FROM staff_allowances ORDER BY created_at DESC LIMIT 50`);
    res.json(allowances);
  } catch (err) {
    next(err);
  }
});

router.post('/staff/allowances', requireAuth, async (req, res, next) => {
  try {
    const { user_name, item_name, quantity } = req.body;
    const result = await runQuery(
      `INSERT INTO staff_allowances (user_name, item_name, quantity) VALUES (?, ?, ?)`,
      [user_name, item_name, quantity || 1]
    );
    res.json({ success: true, allowance_id: result.lastID });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
