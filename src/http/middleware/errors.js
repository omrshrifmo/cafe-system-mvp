/**
 * Global Error Handling Middleware
 */
const logger = require('../../observability/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled API Exception', {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    requestId: req.id,
    userId: req.user ? req.user.id : null
  });

  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || (statusCode === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');

  let clientMessage = err.message || 'حدث خطأ غير متوقع أثناء معالجة الطلب';
  
  // Prevent SQL implementation details from leaking to the client
  if (clientMessage.includes('SQLITE_') || errorCode.toString().includes('SQLITE')) {
    clientMessage = 'حدث خطأ في قاعدة البيانات، يرجى المحاولة مرة أخرى أو مراجعة الدعم الفني.';
  }

  res.status(statusCode).json({
    success: false,
    error: clientMessage,
    code: errorCode,
    requestId: req.id,
    data: null
  });
}

module.exports = errorHandler;
