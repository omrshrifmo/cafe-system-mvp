/**
 * Structured Logger with automatic sensitive data redaction
 */
const SENSITIVE_KEYS = new Set([
  'pin', 'pin_code', 'password', 'token', 'session_id', 'session_hash',
  'cookie', 'authorization', 'card_number', 'secret'
]);

function redact(obj, depth = 0) {
  if (!obj || depth > 4) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redact(item, depth + 1));
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = redact(value, depth + 1);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...redact(meta)
  });
}

const logger = {
  debug(message, meta) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatLog('debug', message, meta));
    }
  },
  info(message, meta) {
    console.log(formatLog('info', message, meta));
  },
  warn(message, meta) {
    console.warn(formatLog('warn', message, meta));
  },
  error(message, meta) {
    console.error(formatLog('error', message, meta));
  }
};

module.exports = logger;
