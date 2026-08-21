/**
 * Validated Environment Configuration
 */
const path = require('path');

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../../cafe.db'),
  SESSION_SECRET: process.env.SESSION_SECRET || 'mazaj-enterprise-session-secret-salt-2026',
  SESSION_TTL_HOURS: parseInt(process.env.SESSION_TTL_HOURS || '24', 10),
  BCRYPT_WORK_FACTOR: parseInt(process.env.BCRYPT_WORK_FACTOR || '10', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ALLOW_FACTORY_RESET: process.env.ALLOW_FACTORY_RESET === 'true' || false,
  ENABLE_MDNS: process.env.ENABLE_MDNS !== 'false'
};

module.exports = env;
