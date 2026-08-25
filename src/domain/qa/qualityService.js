const { runTransaction } = require('../../db/transaction');
const { getQuery, allQuery } = require('../../db/connection');

// Privacy Masking Helpers
function maskPhone(phone) {
  if (!phone || phone.length < 4) return '****';
  const clean = phone.trim();
  if (clean.length <= 6) return clean.slice(0, 2) + '****' + clean.slice(-2);
  return clean.slice(0, 3) + '****' + clean.slice(-4);
}

function maskName(name) {
  if (!name || name.trim() === '') return 'عميل';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1) + '***';
  return parts[0] + ' ' + parts[parts.length - 1].slice(0, 1) + '.';
}

const VALID_SEVERITIES = ['LOW', 'MED', 'HIGH'];
const VALID_STATUSES = ['OPEN', 'INVESTIGATING', 'CORRECTIVE_ACTION_PENDING', 'RESOLVED', 'DISMISSED'];

/**
 * Creates an audited quality complaint with privacy masking.
 */
async function createComplaint({
  venueId = 'V_DEFAULT',
  orderSessionId = null,
  loggedByUserId,
  againstUserId = null,
  customerName = 'عميل',
  customerPhone = null,
  severity = 'LOW',
  description,
  evidence = [],
  ownerUserId = null,
  dueDate = null
}) {
  return runTransaction(async (tx) => {
    if (!loggedByUserId) throw new Error('مُسجل البلاغ إلزامي (logged_by_user_id is required).');
    if (!description || description.trim() === '') throw new Error('وصف الشكوى أو ملاحظة الجودة إلزامي.');
    if (!VALID_SEVERITIES.includes(severity)) {
      throw new Error(`مستوى الخطورة غير معتمد: ${severity}. الخيارات المتاحة: ${VALID_SEVERITIES.join(', ')}`);
    }

    const complaintId = `QC-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const initialAudit = [{
      action: 'CREATED',
      actor_id: loggedByUserId,
      timestamp: new Date().toISOString(),
      details: { severity, against_user_id: againstUserId, order_session_id: orderSessionId }
    }];

    const maskedName = maskName(customerName);
    const maskedPhone = customerPhone ? maskPhone(customerPhone) : null;

    await tx.run(`
      INSERT INTO quality_complaints (
        id, venue_id, order_session_id, logged_by_user_id, against_user_id,
        customer_name_masked, customer_phone_masked, severity, status,
        description, evidence_json, owner_user_id, due_date, audit_trail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `, [
      complaintId, venueId, orderSessionId, loggedByUserId, againstUserId,
      maskedName, maskedPhone, severity,
      description.trim(), JSON.stringify(evidence), ownerUserId, dueDate, JSON.stringify(initialAudit)
    ]);

    return { status: 'SUCCESS', complaint_id: complaintId, severity, masked_customer_name: maskedName };
  });
}

/**
 * Updates complaint status, investigation root-cause, or corrective action.
 */
async function updateComplaint(complaintId, {
  actorId,
  status = null,
  ownerUserId = null,
  rootCause = null,
  correctiveAction = null,
  dueDate = null,
  resolutionNotes = null
}) {
  return runTransaction(async (tx) => {
    const complaint = await getQuery(`SELECT * FROM quality_complaints WHERE id = ?`, [complaintId]);
    if (!complaint) throw new Error('سجل الشكوى غير موجود.');

    if (status && !VALID_STATUSES.includes(status)) {
      throw new Error(`حالة الشكوى غير صالحة: ${status}. الحالات المتاحة: ${VALID_STATUSES.join(', ')}`);
    }

    const auditTrail = JSON.parse(complaint.audit_trail_json || '[]');
    const changeEntry = {
      action: status ? `STATUS_CHANGED_TO_${status}` : 'UPDATED',
      actor_id: actorId,
      timestamp: new Date().toISOString(),
      changes: {
        status: status || complaint.status,
        owner_user_id: ownerUserId !== undefined ? ownerUserId : complaint.owner_user_id,
        root_cause: rootCause !== undefined ? rootCause : complaint.root_cause,
        corrective_action: correctiveAction !== undefined ? correctiveAction : complaint.corrective_action,
        resolution_notes: resolutionNotes !== undefined ? resolutionNotes : complaint.resolution_notes
      }
    };
    auditTrail.push(changeEntry);

    const isResolving = status === 'RESOLVED';

    await tx.run(`
      UPDATE quality_complaints
      SET status = COALESCE(?, status),
          owner_user_id = COALESCE(?, owner_user_id),
          root_cause = COALESCE(?, root_cause),
          corrective_action = COALESCE(?, corrective_action),
          due_date = COALESCE(?, due_date),
          resolution_notes = COALESCE(?, resolution_notes),
          resolved_at = CASE WHEN ? = 1 THEN datetime('now', 'localtime') ELSE resolved_at END,
          resolved_by = CASE WHEN ? = 1 THEN ? ELSE resolved_by END,
          audit_trail_json = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [
      status, ownerUserId, rootCause, correctiveAction, dueDate, resolutionNotes,
      isResolving ? 1 : 0, isResolving ? 1 : 0, actorId,
      JSON.stringify(auditTrail), complaintId
    ]);

    return { status: 'SUCCESS', complaint_id: complaintId, new_status: status || complaint.status };
  });
}

/**
 * Resolves a complaint.
 */
async function resolveComplaint(complaintId, actorId, resolutionNotes = 'تم حل الشكوى وتطبيق الإجراء التصحيحي.') {
  return updateComplaint(complaintId, {
    actorId,
    status: 'RESOLVED',
    resolutionNotes
  });
}

/**
 * Lists complaints with privacy protection and joined employee names.
 */
async function getComplaints(filter = {}, allowFullView = false) {
  let query = `
    SELECT c.*,
           u_against.name as against_user_name, u_against.role_id as against_user_role,
           u_logged.name as logged_by_user_name,
           u_owner.name as owner_user_name,
           u_res.name as resolved_by_user_name
    FROM quality_complaints c
    LEFT JOIN v3_users u_against ON c.against_user_id = u_against.id
    LEFT JOIN v3_users u_logged ON c.logged_by_user_id = u_logged.id
    LEFT JOIN v3_users u_owner ON c.owner_user_id = u_owner.id
    LEFT JOIN v3_users u_res ON c.resolved_by = u_res.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.venueId) {
    query += ` AND c.venue_id = ?`;
    params.push(filter.venueId);
  }
  if (filter.status) {
    query += ` AND c.status = ?`;
    params.push(filter.status);
  }
  if (filter.severity) {
    query += ` AND c.severity = ?`;
    params.push(filter.severity);
  }
  if (filter.againstUserId) {
    query += ` AND c.against_user_id = ?`;
    params.push(filter.againstUserId);
  }

  query += ` ORDER BY c.created_at DESC LIMIT 100`;

  const rows = await allQuery(query, params);

  return rows.map(r => ({
    ...r,
    evidence: JSON.parse(r.evidence_json || '[]'),
    audit_trail: JSON.parse(r.audit_trail_json || '[]')
  }));
}

async function getComplaintDetails(complaintId) {
  const rows = await getComplaints({});
  const found = rows.find(r => r.id === complaintId);
  return found || null;
}

module.exports = {
  createComplaint,
  updateComplaint,
  resolveComplaint,
  getComplaints,
  getComplaintDetails,
  maskPhone,
  maskName
};
