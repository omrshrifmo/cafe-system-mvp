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

  let statusCode = err.status || err.statusCode || 500;
  let errorCode = err.code || (statusCode === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
  let clientMessage = err.message || 'حدث خطأ داخلي في النظام';

  // Map raw SQLite errors to safe public HTTP errors
  if (err.message && err.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
    statusCode = 409;
    errorCode = 'CONFLICT';
    clientMessage = 'هذا السجل موجود مسبقاً.';
  } else if (err.message && err.message.includes('SQLITE_CONSTRAINT_FOREIGNKEY')) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    clientMessage = 'البيانات المرتبطة غير صحيحة أو غير موجودة.';
  } else if (err.message && err.message.includes('SQLITE_CONSTRAINT_NOTNULL')) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    clientMessage = 'يرجى إدخال جميع الحقول المطلوبة.';
  } else if (err.message && (err.message.includes('SQLITE_') || errorCode.toString().includes('SQLITE'))) {
    statusCode = 500;
    errorCode = 'INTERNAL_ERROR';
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
