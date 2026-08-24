/**
 * Rate Limiting Middleware for Auth and Sensitive Routes
 */
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_REQUESTS: تم تجاوز عدد محاولات الدخول المسموح بها، يرجى الانتظار دقيقة واحدة',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  authLimiter,
  apiLimiter
};
