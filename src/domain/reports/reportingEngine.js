const { buildReportScope } = require('./reportDefinitionService');
const crypto = require('crypto');
const { getQuery } = require('../../db/connection');

/**
 * Validates and normalizes reporting scope parameters.
 * Rejects mismatched scopes (e.g., specific shift combined with mismatched date range).
 */
async function buildScopeCriteria(params) {
    const { venueId, startDate, endDate, timezone, shiftId } = params;

    if (!venueId) {
        const err = new Error('Scope requires venueId');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!startDate || !endDate) {
        const err = new Error('Scope requires startDate and endDate');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    
    const scope = {
        venueId,
        startDate,
        endDate,
        timezone: timezone || 'Africa/Cairo',
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString()
    };

    if (shiftId) {
        const shift = await getQuery(`SELECT * FROM v3_shifts WHERE id = ? AND venue_id = ?`, [shiftId, venueId]);
        if (!shift) {
            const err = new Error(`Shift ${shiftId} not found for venue ${venueId}`);
            err.code = 'VALIDATION_ERROR';
            err.requestId = scope.requestId;
            throw err;
        }
        
        // Assert date matches shift
        if (shift.business_date < startDate || shift.business_date > endDate) {
            const err = new Error(`Scope mismatch: Shift ${shiftId} business date ${shift.business_date} is outside requested range ${startDate} to ${endDate}`);
            err.code = 'VALIDATION_ERROR';
            err.requestId = scope.requestId;
            throw err;
        }

        scope.shiftId = shiftId;
        scope.shift = shift;
    }

    return scope;
}

module.exports = { buildScopeCriteria, buildReportScope };
