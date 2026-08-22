/**
 * Standard API Envelope Formatter
 * Intercepts res.json to enforce the { success, data, error, requestId } structure.
 */
function envelopeMiddleware(req, res, next) {
  const originalJson = res.json;

  res.json = function (body) {
    // If it already has 'success', assume it's formatted for legacy compatibility
    if (body && typeof body === 'object' && ('success' in body)) {
      if (!('requestId' in body)) body.requestId = req.id;
      return originalJson.call(this, body);
    }

    // Determine success based on status code
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
    
    let formattedBody = {
      success: isSuccess,
      data: isSuccess ? body : null,
      error: !isSuccess ? (body.error || body.message || 'An error occurred') : null,
      requestId: req.id
    };

    // Maintain stable error codes if provided
    if (!isSuccess && body.code) {
      formattedBody.code = body.code;
    }

    return originalJson.call(this, formattedBody);
  };

  next();
}

module.exports = envelopeMiddleware;
