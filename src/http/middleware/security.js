/**
 * Enterprise Security Hardening Middleware
 * Enforces CSP, HSTS, Strict CORS, CSRF Guards, CSV Sanitization,
 * Path Traversal Protection, Debug Endpoint Blocking, and Production HTTPS enforcement.
 */
const crypto = require('crypto');

/**
 * Security Headers Middleware (CSP, HSTS, FrameGuard, NoSniff, ReferrerPolicy)
 */
function securityHeaders(req, res, next) {
  // Content Security Policy (CSP)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' ws: wss: https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );

  // Prevent Clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict Powerful Web Features
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');

  // HTTP Strict Transport Security (HSTS) - Enabled for secure contexts only
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Remove server fingerprinting header
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * Strict CORS Configuration
 */
function strictCors(req, res, next) {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  if (origin) {
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Idempotency-Key');
    } else {
      // Reject unauthorized cross-origin request
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ success: false, error: 'CORS_VIOLATION: Origin not allowed by policy' });
      }
    }
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
}

/**
 * CSRF Protection for Cookie-Authenticated Mutations
 */
function csrfProtection(req, res, next) {
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!mutatingMethods.includes(req.method)) {
    return next();
  }

  // Exempt public auth login, logout, or setup endpoints that establish/destroy a session
  if (req.path === '/api/auth/login' || req.path === '/api/auth/logout' || req.path === '/api/setup/initialize' || req.path === '/api/system/initialize' || req.path.startsWith('/api/qr/')) {
    return next();
  }

  // If request uses cookie session auth, require custom header or token to prove non-simple request
  const hasSessionCookie = req.cookies && (req.cookies.session_token || req.cookies.mazaj_session);
  if (hasSessionCookie) {
    // A pure cross-site HTML form cannot send custom JSON content-type without preflight
    const isJson = req.is('application/json');
    const isMultipart = req.is('multipart/form-data') || req.headers['content-type']?.includes('multipart/form-data');
    const isCustomHeader = req.headers['x-csrf-token'] || req.headers['x-requested-with'] || req.headers['x-device-id'];

    if (!isJson && !isMultipart && !isCustomHeader) {
      return res.status(403).json({
        success: false,
        error: 'CSRF_BLOCKED: State-mutating requests must provide application/json Content-Type or X-CSRF-Token header.',
        code: 'CSRF_VIOLATION'
      });
    }
  }

  next();
}

/**
 * Block Debug Endpoints, Source Maps, Raw Logs, and Sensitive Paths
 * Should be mounted BEFORE static file serving.
 */
function blockDebugEndpoints(req, res, next) {
  const blockedPatterns = [
    /^\/__debug/i,
    /^\/api\/health\/internal/i,
    /\.map$/i,                           // JS/CSS source maps
    /\.log$/i,                           // Raw log files
    /^\/server\.log/i,                   // Explicit server log
    /^\/backups\//i,                     // Backup directory
    /\.(sqlite|db|sqlite3|db-wal|db-shm)$/i, // SQLite files
    /^\/uploads\/.*\.(sql|sh|py|exe|bin)$/i,  // Dangerous upload file types
    /^\/src\//i,                         // Source code directory
    /^\/node_modules\//i,                // Node modules
    /^\/\.git\//i,                       // Git directory
    /^\/fixtures\//i,                    // Test fixtures
    /^\/test\//i,                        // Test directory
    /^\/scripts\//i,                     // Scripts directory
    /^\/debug_auth/i,                    // Debug auth file
    /^\/data\.db/i,                      // Alternative db name
    /^\/database\.js/i                   // Root-level DB dump
  ];

  const { pathname } = require('url').parse(req.url);

  for (const pattern of blockedPatterns) {
    if (pattern.test(pathname)) {
      return res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        code: 'NOT_FOUND'
      });
    }
  }

  next();
}

/**
 * Enforce HTTPS in production contexts.
 * When behind a reverse proxy, checks X-Forwarded-Proto.
 */
function requireHttps(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Exempt health checks that load balancers call over HTTP
  if (req.path === '/healthz' || req.path === '/api/health/liveness') {
    return next();
  }

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (!isHttps) {
    const httpsUrl = `https://${req.headers.host}${req.originalUrl}`;
    return res.redirect(301, httpsUrl);
  }

  next();
}

/**
 * CSV Formula Injection Sanitizer
 * Strips or prefixes dangerous formula triggers (=, +, -, @, \t, \r) in exported cell values
 */
function sanitizeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  if (dangerousPrefixes.some(prefix => str.startsWith(prefix))) {
    str = "'" + str; // Prefix with single quote to escape spreadsheet formulas
  }
  return str.replace(/"/g, '""');
}

/**
 * Path Traversal Sanitizer
 */
function sanitizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return '';
  return inputPath.replace(/(\.\.[\\/])+/g, '').replace(/[<>:"|?*]/g, '');
}

module.exports = {
  securityHeaders,
  strictCors,
  csrfProtection,
  blockDebugEndpoints,
  requireHttps,
  sanitizeCsvValue,
  sanitizePath
};
