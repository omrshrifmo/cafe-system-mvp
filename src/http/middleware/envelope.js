/**
 * Standard API Envelope Formatter
 * Intercepts res.json to enforce the { success, data, error, requestId } structure.
 */
function envelopeMiddleware(req, res, next) {
  const originalJson = res.json;

  res.json = function (body) {
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;

    // If body is already an envelope object with 'success'
    if (body && typeof body === 'object' && !Array.isArray(body) && ('success' in body)) {
      if (!('requestId' in body)) body.requestId = req.id;
      if (!('data' in body)) {
        // If data field is not explicitly present, assign primary payload or body
        const { success: _s, error: _e, code: _c, requestId: _r, ...rest } = body;
        body.data = isSuccess ? (Object.keys(rest).length > 0 ? rest : null) : null;
      }
      if (!('error' in body)) {
        body.error = !isSuccess ? (body.message || 'حدث خطأ أثناء معالجة الطلب') : null;
      }
      return originalJson.call(this, body);
    }

    // Wrap bare arrays, primitives, or raw objects
    const formattedBody = {
      success: isSuccess,
      data: isSuccess ? body : null,
      error: !isSuccess ? (body && (body.error || body.message) ? (body.error || body.message) : 'حدث خطأ أثناء معالجة الطلب') : null,
      code: !isSuccess ? (body && body.code ? body.code : (res.statusCode === 404 ? 'NOT_FOUND' : (res.statusCode === 403 ? 'FORBIDDEN' : (res.statusCode === 401 ? 'AUTH_REQUIRED' : 'INTERNAL_ERROR')))) : null,
      requestId: req.id
    };

    return originalJson.call(this, formattedBody);
  };

  next();
}

module.exports = envelopeMiddleware;
