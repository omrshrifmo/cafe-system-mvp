/**
 * CRM, Loyalty, Reservations & Hospitality Intelligence HTTP Routes
 * Enforces privacy masking by default, conflict-free reservations, and envelope standardization.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const {
  getCustomers,
  createOrUpdateCustomer,
  awardLoyaltyPoints,
  recordCustomerVisit,
  anonymizeCustomer
} = require('../../domain/hospitality/crmService');
const {
  getReservations,
  createReservation,
  updateReservationStatus,
  checkReservationConflict
} = require('../../domain/hospitality/reservationService');
const { allQuery, runQuery } = require('../../db/connection');

const {
  createComplaint,
  updateComplaint,
  resolveComplaint,
  getComplaints,
  getComplaintDetails
} = require('../../domain/qa/qualityService');

// CRM Aliases
router.get('/crm', requireAuth, async (req, res, next) => {
  req.url = '/customers' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  return router.handle(req, res, next);
});

router.post('/crm', requireAuth, async (req, res, next) => {
  req.url = '/customers';
  return router.handle(req, res, next);
});

// Quality Assurance / Incident Management
router.get(['/quality', '/qa'], requireAuth, async (req, res, next) => {
  try {
    const allowFullView = (req.user && (req.user.role === 'OWNER' || req.user.role === 'SUPER_ADMIN'));
    const feedback = await allQuery(`SELECT * FROM customer_feedback ORDER BY created_at DESC LIMIT 20`);
    const complaints = await getComplaints({}, allowFullView);
    res.json({
      success: true,
      data: {
        feedback,
        complaints,
        quality_score: 96.5
      },
      feedback,
      complaints,
      quality_score: 96.5,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post('/quality', requireAuth, async (req, res, next) => {
  req.url = '/complaints';
  return router.handle(req, res, next);
});

router.get('/quality/checklists', requireAuth, async (req, res, next) => {
  try {
    const checklists = [
      { id: 1, title: 'فحص جودة البن وطحنة الإسبريسو', department: 'BARISTA', status: 'COMPLETED' },
      { id: 2, title: 'فحص درجات حرارة الثلاجات', department: 'KITCHEN', status: 'COMPLETED' },
      { id: 3, title: 'نظافة وتطهير رؤوس الشيشة', department: 'SHISHA', status: 'COMPLETED' }
    ];
    res.json({
      success: true,
      data: { checklists },
      checklists,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Customers lookup & CRM with privacy masking
router.get('/customers', requireAuth, async (req, res, next) => {
  try {
    const phone = req.query.phone;
    const search = req.query.search;
    // Allow unmasked full view only for OWNER / SUPER_ADMIN with explicit export query
    const allowFullView = (req.user && (req.user.role === 'OWNER' || req.user.role === 'SUPER_ADMIN') && req.query.full_view === 'true');

    const customers = await getCustomers({ phone, search, allowFullView });

    if (phone && customers.length > 0) {
      return res.json({
        success: true,
        data: { customer: customers[0] },
        customer: customers[0],
        ...customers[0],
        requestId: req.id
      });
    }

    res.json({
      success: true,
      data: { customers },
      customers,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post('/customers', requireAuth, async (req, res, next) => {
  try {
    const result = await createOrUpdateCustomer(req.body);
    res.json({
      success: true,
      data: { customer: result },
      customer: result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Settle Customer Outstanding Debt ("سداد حساب آجل")
router.post('/customers/:phone/settle-debt', requireAuth, async (req, res, next) => {
  try {
    const { amount, payment_method, notes } = req.body;
    const { settleCustomerDebt } = require('../../domain/hospitality/crmService');
    const result = await settleCustomerDebt(req.params.phone, amount, payment_method, notes, req.user);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Loyalty Points Award / Redeem
router.post('/customers/:id/loyalty', requireAuth, async (req, res, next) => {
  try {
    const { points, reference_type, reference_id, notes } = req.body;
    const result = await awardLoyaltyPoints(req.params.id, points, reference_type || 'ADJUSTMENT', reference_id || `MANUAL-${Date.now()}`, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Customer Visit Logging
router.post('/customers/:id/visits', requireAuth, async (req, res, next) => {
  try {
    const { table_number, order_id, spend_minor, points_earned, notes } = req.body;
    const result = await recordCustomerVisit({
      customerId: req.params.id,
      tableNumber: table_number,
      orderId: order_id,
      spendMinor: spend_minor || 0,
      pointsEarned: points_earned || 0,
      notes
    });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Customer Anonymization (Right-to-be-forgotten)
router.post('/customers/:id/anonymize', requireAuth, requirePermission('users:manage'), async (req, res, next) => {
  try {
    const result = await anonymizeCustomer(req.params.id);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Reservations List
router.get('/reservations', requireAuth, async (req, res, next) => {
  try {
    const { date, status } = req.query;
    const { reservations, stats } = await getReservations({ date, status });
    res.json({
      success: true,
      data: { reservations, stats },
      reservations,
      stats,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Check Reservation Conflict
router.post('/reservations/check-conflict', requireAuth, async (req, res, next) => {
  try {
    const { table_number, reservation_date, reservation_time, duration_minutes, exclude_id } = req.body;
    const conflict = await checkReservationConflict({
      tableNumber: table_number,
      reservationDate: reservation_date,
      reservationTime: reservation_time,
      durationMinutes: duration_minutes,
      excludeId: exclude_id
    });
    res.json({
      success: true,
      data: conflict,
      ...conflict,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Create Reservation with Conflict Check
router.post('/reservations', requireAuth, async (req, res, next) => {
  try {
    const result = await createReservation(req.body);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Update Reservation Lifecycle Status
router.put('/reservations/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const result = await updateReservationStatus(req.params.id, status, notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Customer Feedback & QA
router.get(['/feedback', '/customers/feedback', '/crm/feedback'], requireAuth, async (req, res, next) => {
  try {
    const feedback = await allQuery(`SELECT * FROM customer_feedback ORDER BY created_at DESC LIMIT 50`);
    res.json({
      success: true,
      data: { feedback },
      feedback,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/feedback', '/customers/feedback', '/crm/feedback'], async (req, res, next) => {
  try {
    const { order_id, rating, comments, comment, customer_phone, category } = req.body;
    const finalComment = comment || comments || '';
    const resId = await runQuery(
      `INSERT INTO customer_feedback (order_id, rating, comments) VALUES (?, ?, ?)`,
      [order_id || null, rating || 5, finalComment]
    );
    res.json({
      success: true,
      data: { feedback_id: resId.lastID },
      feedback_id: resId.lastID,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Complaints / QA Records
router.get(['/complaints', '/qa/complaints', '/quality/complaints'], requireAuth, async (req, res, next) => {
  try {
    const allowFullView = (req.user && (req.user.role === 'OWNER' || req.user.role === 'SUPER_ADMIN'));
    const { status, severity, against_user_id, venue_id } = req.query;
    const complaints = await getComplaints({
      status,
      severity,
      againstUserId: against_user_id,
      venueId: venue_id
    }, allowFullView);
    res.json({
      success: true,
      data: { complaints },
      complaints,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.get(['/complaints/:id', '/qa/complaints/:id'], requireAuth, async (req, res, next) => {
  try {
    const complaint = await getComplaintDetails(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, error: 'سجل الشكوى غير موجود', code: 'NOT_FOUND', requestId: req.id });
    }
    res.json({
      success: true,
      data: { complaint },
      complaint,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/complaints', '/qa/complaints', '/quality/complaints'], requireAuth, async (req, res, next) => {
  try {
    const loggedByUserId = req.body.logged_by_user_id || (req.user ? req.user.id : '1');
    const {
      venue_id,
      order_id,
      order_session_id,
      against_user_id,
      customer_name,
      customer_phone,
      severity,
      description,
      evidence,
      owner_user_id,
      due_date
    } = req.body;

    const result = await createComplaint({
      venueId: venue_id || 'V_DEFAULT',
      orderSessionId: order_session_id || (order_id ? String(order_id) : null),
      loggedByUserId,
      againstUserId: against_user_id,
      customerName: customer_name,
      customerPhone: customer_phone,
      severity: severity || 'LOW',
      description,
      evidence: evidence || [],
      ownerUserId: owner_user_id,
      dueDate: due_date
    });

    res.json({
      success: true,
      data: result,
      ...result,
      complaint_id: result.complaint_id,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.put(['/complaints/:id', '/qa/complaints/:id'], requireAuth, async (req, res, next) => {
  try {
    const actorId = req.user ? req.user.id : 'SYSTEM';
    const { status, owner_user_id, root_cause, corrective_action, due_date, resolution_notes } = req.body;
    const result = await updateComplaint(req.params.id, {
      actorId,
      status,
      ownerUserId: owner_user_id,
      rootCause: root_cause,
      correctiveAction: corrective_action,
      dueDate: due_date,
      resolutionNotes: resolution_notes
    });
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/complaints/:id/resolve', '/qa/complaints/:id/resolve', '/qa/complaints/resolve'], requireAuth, async (req, res, next) => {
  try {
    const complaintId = req.params.id || req.body.complaint_id;
    const actorId = req.user ? req.user.id : (req.body.user_id || 'SYSTEM');
    const { resolution_notes } = req.body;
    const result = await resolveComplaint(complaintId, actorId, resolution_notes);
    res.json({
      success: true,
      data: result,
      ...result,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

// Staff Drink / Meal Allowances
router.get('/staff/allowances', requireAuth, async (req, res, next) => {
  try {
    const allowances = await allQuery(`SELECT * FROM staff_allowances ORDER BY created_at DESC LIMIT 50`);
    res.json({
      success: true,
      data: { allowances },
      allowances,
      requestId: req.id
    });
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
    res.json({
      success: true,
      data: { allowance_id: result.lastID },
      allowance_id: result.lastID,
      requestId: req.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
