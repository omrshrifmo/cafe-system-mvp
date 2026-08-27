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
  ENABLE_MDNS: process.env.ENABLE_MDNS !== 'false',

  // Deployment / internet-boundary settings
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],

  // Secret manager / env-injection variables (NEVER hardcoded in source)
  BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY || 'MazajCafeEnterpriseSecureKey2026!',
  PACKAGE_SIGNING_KEY: process.env.PACKAGE_SIGNING_KEY || 'MazajCafeEnterprisePackageTrustSecret2026!',

  // Incident contacts
  INCIDENT_CONTACT_EMAIL: process.env.INCIDENT_CONTACT_EMAIL || 'ops@cafe.example.com',
  INCIDENT_CONTACT_PHONE: process.env.INCIDENT_CONTACT_PHONE || '',

  // Whether the full database path is exposed in /api/build-info
  // Default: false in production (only basename exposed)
  EXPOSE_DATABASE_PATH: process.env.EXPOSE_DATABASE_PATH === 'true' ? true
    : (process.env.NODE_ENV !== 'production')
};

// Production guard: warn when default secrets are in use
if (env.NODE_ENV === 'production') {
  const defaultSecrets = [
    ['BACKUP_ENCRYPTION_KEY', 'MazajCafeEnterpriseSecureKey2026!'],
    ['PACKAGE_SIGNING_KEY', 'MazajCafeEnterprisePackageTrustSecret2026!'],
    ['SESSION_SECRET', 'mazaj-enterprise-session-secret-salt-2026']
  ];
  for (const [name, defaultVal] of defaultSecrets) {
    if ((process.env[name] || defaultVal) === defaultVal) {
      console.warn(`[SECURITY WARNING] ${name} is using the default development value in production. Set a strong secret via environment variable.`);
    }
  }
}

module.exports = env;
