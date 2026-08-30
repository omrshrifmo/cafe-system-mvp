/**
 * Privacy-First CRM, Loyalty Ledger & Customer Intelligence Service
 * Enforces phone masking by default, idempotent loyalty accruals, and consent controls.
 */
const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

/**
 * Mask string for privacy preservation (e.g., 01012345678 -> 010****5678)
 */
function maskPhone(phone) {
  if (!phone) return '—';
  const clean = String(phone).trim();
  if (clean.length <= 5) return '***';
  const start = clean.substring(0, 3);
  const end = clean.substring(clean.length - 4);
  return `${start}****${end}`;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '—';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `*@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/**
 * Get customers with privacy masking by default
 */
async function getCustomers({ phone = null, search = null, allowFullView = false, limit = 50 } = {}) {
  let sql = `
    SELECT id, venue_id, name, phone, masked_phone, email, masked_email,
           consent_status, tags, notes, privacy_scope, preferences_json,
           visit_count, lifetime_spend_minor, loyalty_balance, credit_balance_minor,
           last_visit_at, created_at
    FROM v3_customers
    WHERE 1=1
  `;
  const params = [];

  if (phone) {
    sql += ` AND (phone = ? OR masked_phone = ?)`;
    params.push(String(phone).trim(), String(phone).trim());
  }

  if (search) {
    sql += ` AND (name LIKE ? OR phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY lifetime_spend_minor DESC LIMIT ?`;
  params.push(limit);

  const customers = await allQuery(sql, params);

  return customers.map(c => {
    let prefs = {};
    let tags = [];
    try { prefs = JSON.parse(c.preferences_json || '{}'); } catch (e) {}
    try { tags = JSON.parse(c.tags || '[]'); } catch (e) {}

    return {
      id: c.id,
      venue_id: c.venue_id,
      name: c.name,
      phone: allowFullView ? (c.phone || c.masked_phone) : (c.masked_phone || maskPhone(c.phone)),
      email: allowFullView ? (c.email || c.masked_email) : (c.masked_email || maskEmail(c.email)),
      is_masked: !allowFullView,
      consent_status: c.consent_status || 'PENDING',
      privacy_scope: c.privacy_scope || 'STANDARD',
      visit_count: c.visit_count || 0,
      lifetime_spend: (c.lifetime_spend_minor || 0) / 100,
      lifetime_spend_minor: c.lifetime_spend_minor || 0,
      loyalty_balance: c.loyalty_balance || 0,
      credit_balance: (c.credit_balance_minor || 0) / 100,
      last_visit_at: c.last_visit_at,
      preferences: prefs,
      tags: tags,
      notes: c.notes,
      created_at: c.created_at
    };
  });
}

/**
 * Create or Update Customer record with privacy metadata
 */
async function createOrUpdateCustomer(customerData) {
  return runTransaction(async (tx) => {
    const rawPhone = customerData.phone ? String(customerData.phone).trim() : null;
    const maskedPhone = maskPhone(rawPhone);
    const rawEmail = customerData.email ? String(customerData.email).trim() : null;
    const maskedEmail = maskEmail(rawEmail);

    let customerId = customerData.id;
    if (!customerId && rawPhone) {
      const existing = await tx.get(`SELECT id FROM v3_customers WHERE phone = ?`, [rawPhone]);
      if (existing) customerId = existing.id;
    }

    if (!customerId) {
      customerId = `CUST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    const existing = await tx.get(`SELECT id FROM v3_customers WHERE id = ?`, [customerId]);

    const tagsJson = customerData.tags ? JSON.stringify(customerData.tags) : null;
    const prefsJson = customerData.preferences ? JSON.stringify(customerData.preferences) : null;

    if (existing) {
      await tx.run(
        `UPDATE v3_customers 
         SET name = COALESCE(?, name),
             phone = COALESCE(?, phone),
             masked_phone = COALESCE(?, masked_phone),
             email = COALESCE(?, email),
             masked_email = COALESCE(?, masked_email),
             consent_status = COALESCE(?, consent_status),
             privacy_scope = COALESCE(?, privacy_scope),
             tags = COALESCE(?, tags),
             preferences_json = COALESCE(?, preferences_json),
             notes = COALESCE(?, notes)
         WHERE id = ?`,
        [
          customerData.name,
          rawPhone,
          maskedPhone,
          rawEmail,
          maskedEmail,
          customerData.consent_status,
          customerData.privacy_scope,
          tagsJson,
          prefsJson,
          customerData.notes,
          customerId
        ]
      );
    } else {
      await tx.run(
        `INSERT INTO v3_customers (
          id, venue_id, name, phone, masked_phone, email, masked_email,
          consent_status, privacy_scope, tags, preferences_json, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
        [
          customerId,
          customerData.venue_id || 'V_DEFAULT',
          customerData.name || 'عميل ضيف',
          rawPhone,
          maskedPhone,
          rawEmail,
          maskedEmail,
          customerData.consent_status || 'PENDING',
          customerData.privacy_scope || 'STANDARD',
          tagsJson,
          prefsJson,
          customerData.notes || null
        ]
      );
    }

    // Sync legacy customers table for backward compatibility
    if (rawPhone) {
      await tx.run(
        `INSERT INTO customers (phone, name, preferences, created_at)
         VALUES (?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(phone) DO UPDATE SET name = excluded.name, preferences = excluded.preferences`,
        [rawPhone, customerData.name || 'عميل ضيف', customerData.notes || null]
      );
    }

    return { id: customerId, name: customerData.name, masked_phone: maskedPhone };
  });
}

/**
 * Award or Redeem Loyalty Points Idempotently
 */
async function awardLoyaltyPoints(customerId, points, referenceType, referenceId, notes = null) {
  const pts = parseInt(points, 10);
  if (!pts || isNaN(pts)) throw new Error('عدد نقاط الولاء يجب أن يكون رقماً صحيحاً');

  return runTransaction(async (tx) => {
    const customer = await tx.get(`SELECT id, loyalty_balance, lifetime_spend_minor, visit_count FROM v3_customers WHERE id = ?`, [customerId]);
    if (!customer) throw new Error('العميل غير مسجل في النظام');

    // Idempotency: Check if referenceId was already processed
    const existingLedger = await tx.get(
      `SELECT id, balance_points FROM loyalty_ledger WHERE reference_type = ? AND reference_id = ?`,
      [referenceType, referenceId]
    );

    if (existingLedger) {
      logger.warn(`Loyalty reference ${referenceType}:${referenceId} already awarded. Returning current balance.`);
      return {
        success: true,
        idempotent_cached: true,
        customer_id: customerId,
        change_points: pts,
        balance_points: existingLedger.balance_points
      };
    }

    const currentBalance = customer.loyalty_balance || 0;
    const newBalance = Math.max(0, currentBalance + pts);
    const ledgerId = `LL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    await tx.run(
      `INSERT INTO loyalty_ledger (id, customer_id, change_points, balance_points, reference_type, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [ledgerId, customerId, pts, newBalance, referenceType, referenceId]
    );

    await tx.run(
      `UPDATE v3_customers SET loyalty_balance = ? WHERE id = ?`,
      [newBalance, customerId]
    );

    return {
      success: true,
      ledger_id: ledgerId,
      customer_id: customerId,
      change_points: pts,
      balance_points: newBalance
    };
  });
}

/**
 * Record Customer Visit Timeline & Spend
 */
async function recordCustomerVisit({ customerId, tableNumber = null, orderId = null, spendMinor = 0, pointsEarned = 0, notes = null }) {
  return runTransaction(async (tx) => {
    const visitId = `CV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await tx.run(
      `INSERT INTO customer_visits (id, venue_id, customer_id, table_number, order_id, spend_minor, points_earned, notes, visit_date, created_at)
       VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [visitId, customerId, tableNumber, orderId, spendMinor, pointsEarned, notes]
    );

    await tx.run(
      `UPDATE v3_customers 
       SET visit_count = visit_count + 1,
           lifetime_spend_minor = lifetime_spend_minor + ?,
           last_visit_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [spendMinor, customerId]
    );

    return { success: true, visit_id: visitId };
  });
}

/**
 * Anonymize customer for GDPR / right-to-be-forgotten privacy compliance
 */
async function anonymizeCustomer(customerId) {
  return runTransaction(async (tx) => {
    await tx.run(
      `UPDATE v3_customers 
       SET name = 'عميل مجهول (ANONYMIZED)',
           phone = NULL,
           masked_phone = '***',
           email = NULL,
           masked_email = '***',
           notes = NULL,
           preferences_json = NULL,
           consent_status = 'REVOKED',
           privacy_scope = 'ANONYMIZED'
       WHERE id = ?`,
      [customerId]
    );
    return { success: true, customer_id: customerId, status: 'ANONYMIZED' };
  });
}

/**
 * Settle Customer Outstanding Debt ("سداد حساب آجل")
 */
async function settleCustomerDebt(phone, amount, paymentMethod = 'CASH', notes = '', actor = null) {
  const cleanPhone = String(phone || '').trim();
  const amt = Number(amount);
  if (!cleanPhone || isNaN(amt) || amt <= 0) {
    throw new Error('VALIDATION_ERROR: رقم هاتف العميل ومبلغ السداد الإيجابي مطلوبان');
  }

  const amtMinor = Math.round(amt * 100);

  return runTransaction(async (tx) => {
    // 1. Check legacy customers table
    let cust = await tx.get(`SELECT * FROM customers WHERE phone = ?`, [cleanPhone]);
    if (!cust) {
      // Check v3_customers
      cust = await tx.get(`SELECT * FROM v3_customers WHERE phone = ?`, [cleanPhone]);
    }

    if (!cust) {
      throw new Error(`NOT_FOUND: العميل صاحب الرقم [${cleanPhone}] غير مسجل بالنظام`);
    }

    const currentDebtMinor = (cust.credit_balance_minor !== undefined && cust.credit_balance_minor !== null)
      ? Number(cust.credit_balance_minor)
      : Math.round((Number(cust.credit_balance) || 0) * 100);

    const currentDebtEgp = currentDebtMinor / 100.0;

    // Reduce debt
    const newDebtMinor = Math.max(0, currentDebtMinor - amtMinor);
    const newDebtEgp = newDebtMinor / 100.0;

    // Update customers
    await tx.run(`UPDATE customers SET credit_balance = ? WHERE phone = ?`, [newDebtEgp, cleanPhone]);
    await tx.run(`UPDATE v3_customers SET credit_balance_minor = ? WHERE phone = ?`, [newDebtMinor, cleanPhone]);

    // Create a compliant order_session record for accounting & ledger tracking
    const publicRef = `DEBT_SETTLE_${cleanPhone}_${Date.now()}`;
    const sessRes = await tx.run(
      `INSERT INTO order_sessions (public_ref, order_type, customer_id, status, total_minor, created_by)
       VALUES (?, 'TAKEAWAY', ?, 'SETTLED', ?, ?)`,
      [publicRef, cleanPhone, amtMinor, actor ? parseInt(actor.id, 10) : 1]
    );
    const sessionId = sessRes.lastID;

    // Insert append-only payment record
    await tx.run(
      `INSERT INTO payments (session_id, method, amount_minor, tip_minor, currency, external_ref, created_by)
       VALUES (?, ?, ?, 0, 'EGP', ?, ?)`,
      [sessionId, paymentMethod.toUpperCase(), amtMinor, `سداد حساب آجل للعميل: ${cleanPhone}${notes ? ' - ' + notes : ''}`, actor ? parseInt(actor.id, 10) : 1]
    );

    // Audit log
    const { logAudit } = require('../auth/service');
    await logAudit(
      'V_DEFAULT',
      actor ? actor.id : '1',
      'CUSTOMER_DEBT_SETTLED',
      'CUSTOMER',
      cleanPhone,
      {
        phone: cleanPhone,
        amount_paid: amt,
        previous_debt: currentDebtEgp,
        remaining_debt: newDebtEgp,
        payment_method: paymentMethod,
        notes
      }
    );

    return {
      success: true,
      phone: cleanPhone,
      customer_name: cust.name || 'عميل',
      amount_paid: amt,
      previous_debt: currentDebtEgp,
      remaining_debt: newDebtEgp,
      payment_method: paymentMethod,
      message: `تم سداد ${amt} ج.م من الحساب الآجل بنجاح. المتبقي: ${newDebtEgp} ج.م`
    };
  });
}

module.exports = {
  maskPhone,
  maskEmail,
  getCustomers,
  createOrUpdateCustomer,
  awardLoyaltyPoints,
  recordCustomerVisit,
  anonymizeCustomer,
  settleCustomerDebt
};
