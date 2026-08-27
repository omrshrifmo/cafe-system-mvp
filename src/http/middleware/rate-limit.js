/**
 * Rate Limiting Middleware for Auth, API, Admin, Health, and Update Routes
 */
const rateLimit = require('express-rate-limit');

/**
 * Auth limiter — 15 attempts per minute per IP
 */
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

/**
 * General API limiter — 300 requests per minute per IP
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Admin route limiter — 10 requests per minute per IP (stricter)
 * Applied to /api/admin/* including session management and system config
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_REQUESTS: حد طلبات المسؤول مُتجاوَز. انتظر دقيقة قبل المحاولة مجدداً.',
    code: 'ADMIN_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * Health endpoint limiter — 60 requests per minute per IP
 * Prevents flood from mis-configured monitoring scrapers
 */
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_REQUESTS: Health check rate limit exceeded.',
    code: 'HEALTH_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * Update application limiter — 5 requests per 5 minutes per IP
 * Prevents rapid-fire automated update attempts
 */
const updateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_REQUESTS: حد محاولات التحديث مُتجاوَز. انتظر 5 دقائق.',
    code: 'UPDATE_RATE_LIMIT_EXCEEDED'
  }
});

module.exports = {
  authLimiter,
  apiLimiter,
  adminLimiter,
  healthLimiter,
  updateLimiter
};
