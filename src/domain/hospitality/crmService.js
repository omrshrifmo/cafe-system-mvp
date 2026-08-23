const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');
const crypto = require('crypto');

function maskString(str, visibleStart = 2, visibleEnd = 2) {
  if (!str || str.length <= visibleStart + visibleEnd) return '***';
  const start = str.substring(0, visibleStart);
  const end = str.substring(str.length - visibleEnd);
  const masked = '*'.repeat(str.length - visibleStart - visibleEnd);
  return `${start}${masked}${end}`;
}

async function createOrUpdateCustomer(customerData) {
  return runTransaction(async (tx) => {
    // Masking logic for privacy
    const maskedPhone = maskString(customerData.phone, 3, 2);
    const maskedEmail = customerData.email ? maskString(customerData.email, 2, 4) : null;

    const existing = await getQuery(`SELECT id FROM v3_customers WHERE id = ?`, [customerData.id]);
    
    if (existing) {
      await tx.run(
        `UPDATE v3_customers SET name = ?, phone = ?, masked_phone = ?, email = ?, masked_email = ?, consent_status = ?, tags = ?, notes = ? WHERE id = ?`,
        [
          customerData.name,
          customerData.phone,
          maskedPhone,
          customerData.email || null,
          maskedEmail,
          customerData.consent_status || 'PENDING',
          customerData.tags ? JSON.stringify(customerData.tags) : null,
          customerData.notes || null,
          customerData.id
        ]
      );
    } else {
      await tx.run(
        `INSERT INTO v3_customers (id, venue_id, name, phone, masked_phone, email, masked_email, consent_status, tags, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerData.id,
          customerData.venue_id,
          customerData.name,
          customerData.phone,
          maskedPhone,
          customerData.email || null,
          maskedEmail,
          customerData.consent_status || 'PENDING',
          customerData.tags ? JSON.stringify(customerData.tags) : null,
          customerData.notes || null
        ]
      );
    }
  });
}

async function anonymizeCustomer(customerId) {
  return runTransaction(async (tx) => {
    // We overwrite PII with 'ANONYMIZED' to ensure simple, robust un-linkability 
    // while retaining financial data.
    await tx.run(
      `UPDATE v3_customers 
       SET name = 'ANONYMIZED', phone = NULL, masked_phone = '***', email = NULL, masked_email = '***', notes = NULL, consent_status = 'REVOKED'
       WHERE id = ?`,
      [customerId]
    );
  });
}

async function awardLoyaltyPoints(customerId, points, referenceType, referenceId) {
  return runTransaction(async (tx) => {
    const customer = await getQuery(`SELECT loyalty_balance FROM v3_customers WHERE id = ?`, [customerId]);
    if (!customer) throw new Error('Customer not found');

    const newBalance = customer.loyalty_balance + points;

    await tx.run(
      `INSERT INTO loyalty_ledger (id, customer_id, change_points, balance_points, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`LL-${Date.now()}-${Math.floor(Math.random()*1000)}`, customerId, points, newBalance, referenceType, referenceId]
    );

    await tx.run(`UPDATE v3_customers SET loyalty_balance = ? WHERE id = ?`, [newBalance, customerId]);
  });
}

module.exports = {
  createOrUpdateCustomer,
  anonymizeCustomer,
  awardLoyaltyPoints
};
