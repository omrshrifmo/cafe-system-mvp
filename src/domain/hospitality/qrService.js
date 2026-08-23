const crypto = require('crypto');
const { getQuery } = require('../../db/connection');

// In production, this would be process.env.QR_SECRET
const QR_SECRET = process.env.QR_SECRET || 'dev_secret_key_12345'; 

function generateTableToken(venueId, tableId, expiresInMinutes = 120) {
  const payload = {
    venue_id: venueId,
    table_id: tableId,
    exp: Date.now() + expiresInMinutes * 60000
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(payloadBase64);
  const signature = hmac.digest('base64url');

  return `${payloadBase64}.${signature}`;
}

async function validateTableToken(token) {
  if (!token || typeof token !== 'string') throw new Error('Invalid token format');

  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Malformed token');

  const [payloadBase64, signature] = parts;

  // Verify signature
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(payloadBase64);
  const expectedSignature = hmac.digest('base64url');

  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }

  // Decode and check expiry
  const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  
  if (Date.now() > payload.exp) {
    throw new Error('Token has expired');
  }

  // Check table status
  const table = await getQuery(
    `SELECT status, qr_token_ref FROM v3_tables WHERE id = ? AND branch_id IN (SELECT id FROM branches WHERE venue_id = ?)`,
    [payload.table_id, payload.venue_id]
  );

  if (!table) {
    throw new Error('Table not found or venue mismatch');
  }

  if (table.status === 'OUT_OF_SERVICE') {
    throw new Error('Table is currently out of service');
  }

  return {
    venue_id: payload.venue_id,
    table_id: payload.table_id,
    table_status: table.status
  };
}

module.exports = {
  generateTableToken,
  validateTableToken
};
