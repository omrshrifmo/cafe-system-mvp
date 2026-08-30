/**
 * Remote Licensing & Kill-Switch Enforcement Middleware
 * Verifies host hardware ID against remote Supabase/Licensing server every 24 hours.
 * Issues a 7-day offline JWT grace cache when active.
 * Rejects with HTTP 402 (Payment Required) when subscription expires or is revoked.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../observability/logger');

const LICENSE_CACHE_FILE = path.join(
  process.env.APPDATA || process.env.HOME || '.',
  '.mazaj_license_cache.jwt'
);

const LOCAL_SIGN_SECRET = env.SESSION_SECRET || 'MAZAJ_ENTERPRISE_DEVICE_SECRET_KEY_9988';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let lastCheckTime = 0;
let cachedLicenseStatus = { active: true, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 };

/**
 * Get Primary MAC Address as unique hardware fingerprint
 */
function getMachineHardwareId() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac.toLowerCase();
        }
      }
    }
  } catch (e) { }
  return crypto.createHash('sha256').update(os.hostname() + os.arch()).digest('hex').slice(0, 17);
}

/**
 * Load offline cached license token from disk
 */
function loadCachedToken() {
  try {
    if (fs.existsSync(LICENSE_CACHE_FILE)) {
      const rawJwt = fs.readFileSync(LICENSE_CACHE_FILE, 'utf8').trim();
      const decoded = jwt.verify(rawJwt, LOCAL_SIGN_SECRET);
      if (decoded && decoded.active && decoded.exp * 1000 > Date.now()) {
        return {
          active: true,
          expiresAt: decoded.exp * 1000,
          hardwareId: decoded.hardwareId
        };
      }
    }
  } catch (err) {
    // JWT expired or invalid
  }
  return null;
}

/**
 * Save offline license cache to disk
 */
function saveCachedToken(hardwareId) {
  try {
    const token = jwt.sign(
      {
        active: true,
        hardwareId,
        issuedAt: Date.now()
      },
      LOCAL_SIGN_SECRET,
      { expiresIn: '7d' }
    );
    fs.writeFileSync(LICENSE_CACHE_FILE, token, 'utf8');
  } catch (err) {
    logger.warn('Failed to persist license cache:', err.message);
  }
}

/**
 * Perform remote ping check to licensing server
 */
async function checkRemoteLicense() {
  const hardwareId = getMachineHardwareId();
  const remoteUrl = process.env.LICENSE_SERVER_URL || 'https://license.mazajcafe.com/v1/check-license';

  try {
    const response = await axios.post(
      remoteUrl,
      {
        hardware_id: hardwareId,
        app: 'Mazaj OS',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      },
      { timeout: 5000 }
    );

    if (response.data && response.data.active === true) {
      cachedLicenseStatus = { active: true, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 };
      saveCachedToken(hardwareId);
      lastCheckTime = Date.now();
      logger.info('Remote license validated successfully', { hardwareId, active: true });
      return true;
    } else if (response.data && response.data.active === false) {
      cachedLicenseStatus = { active: false, expiresAt: 0, reason: response.data.message || 'Subscription Expired' };
      try { if (fs.existsSync(LICENSE_CACHE_FILE)) fs.unlinkSync(LICENSE_CACHE_FILE); } catch (e) {}
      logger.warn('🚨 REMOTE KILL-SWITCH: License revoked by server', { hardwareId });
      return false;
    }
  } catch (err) {
    // Remote unreachable -> rely on 7-day offline JWT grace cache
    const offlineCache = loadCachedToken();
    if (offlineCache && offlineCache.active) {
      cachedLicenseStatus = offlineCache;
      logger.info('Licensing server unreachable; running on valid 7-day offline grace cache');
      return true;
    }
  }
  return false;
}

// Initial bootstrap check
const diskCache = loadCachedToken();
if (diskCache) {
  cachedLicenseStatus = diskCache;
}

/**
 * Express Licensing Enforcement Middleware
 */
function licenseMiddleware(req, res, next) {
  // Allow health checks, status ping, and public assets
  if (!req.path.startsWith('/api/') || req.path === '/api/build-info' || req.path === '/api/healthz') {
    return next();
  }

  const now = Date.now();

  // Trigger background ping if 24 hours elapsed
  if (now - lastCheckTime > CHECK_INTERVAL_MS) {
    checkRemoteLicense().catch(() => {});
    lastCheckTime = now;
  }

  // Check current status against grace expiration
  const isGraceValid = cachedLicenseStatus.active && cachedLicenseStatus.expiresAt > now;

  if (!isGraceValid) {
    logger.warn('API blocked by License Enforcement (402 Payment Required)', {
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    return res.status(402).json({
      success: false,
      code: 'PAYMENT_REQUIRED',
      error: 'انتهت صلاحية الاشتراك - يرجى التواصل مع الدعم الفني لتجديد الترخيص',
      error_en: 'Subscription Expired - Please Contact Support to Renew License',
      hardware_id: getMachineHardwareId()
    });
  }

  next();
}

module.exports = {
  licenseMiddleware,
  checkRemoteLicense,
  getMachineHardwareId,
  cachedLicenseStatus
};
