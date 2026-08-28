/**
 * One-Click DEMO/TEST Lifecycle and Management HTTP Routes
 * Handles isolated DEMO activation, safe reset, status, exit, and manifest queries.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getMode, setMode, MODES, getDatabasePath } = require('../../domain/system/modeService');
const { closeDb } = require('../../db/connection');
const logger = require('../../observability/logger');

const MANIFEST_PATH = path.join(__dirname, '../../../fixtures/qa-fixture-manifest.json');
const FIXTURES_DIR = path.join(__dirname, '../../../fixtures');

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// GET /api/demo/status
router.get('/status', (req, res) => {
  const currentMode = getMode();
  const dbPath = getDatabasePath();
  const dbHash = fs.existsSync(dbPath) ? getFileSha256(dbPath) : null;
  const isDemo = currentMode === MODES.DEMO;

  res.json({
    success: true,
    data: {
      appMode: currentMode,
      isDemo,
      fixtureId: isDemo ? path.basename(dbPath) : null,
      databaseIdentity: path.basename(dbPath),
      databasePath: process.env.NODE_ENV === 'production' ? '[REDACTED]' : dbPath,
      databaseHash: dbHash,
      buildId: process.env.CAFE_BUILD_ID || 'BUILD-2026-PROD-01',
      serviceWorkerVersion: process.env.CAFE_SERVICE_WORKER_VERSION || 'cafe-os-v3.3',
      serverTime: new Date().toISOString()
    }
  });
});

// GET /api/demo/manifest
router.get('/manifest', (req, res) => {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      return res.json({ success: true, manifest });
    } catch (err) {
      logger.error('Failed reading fixture manifest', { error: err.message });
    }
  }

  // Fallback dynamic manifest
  res.json({
    success: true,
    manifest: {
      fixtures: [
        { name: 'demo-normal.sqlite', path: path.join(FIXTURES_DIR, 'demo-normal.sqlite') },
        { name: 'demo-low-stock.sqlite', path: path.join(FIXTURES_DIR, 'demo-low-stock.sqlite') },
        { name: 'clean.sqlite', path: path.join(FIXTURES_DIR, 'clean.sqlite') }
      ],
      roles: [
        { role: 'SUPER_ADMIN', primaryPin: '9999', altPin: '8801', name: 'عمر (مسؤول نظام)' },
        { role: 'OWNER', primaryPin: '8802', altPin: '1009', name: 'فاطمة (مالك)' },
        { role: 'OP_MANAGER', primaryPin: '8803', altPin: '1008', name: 'وائل (مدير عمليات)' },
        { role: 'OP_ASSISTANT_CASHIER', primaryPin: '8804', altPin: '1007', name: 'أحمد كركر (كاشير)' },
        { role: 'BARISTA', primaryPin: '8805', altPin: '1002', name: 'هاجر (باريستا)' },
        { role: 'CHEF', primaryPin: '8806', altPin: '1005', name: 'شيف المطبخ' },
        { role: 'SHISHA', primaryPin: '8807', altPin: '1003', name: 'مسؤول الشيشة' },
        { role: 'WAITER', primaryPin: '8808', altPin: '1004', name: 'ويتر الصالة' },
        { role: 'RUNNER', primaryPin: '8809', altPin: '1011', name: 'رانر التوصيل' }
      ]
    }
  });
});

// POST /api/demo/activate (or /api/demo/switch)
router.post(['/activate', '/switch'], async (req, res, next) => {
  try {
    logger.info('Switching application mode to DEMO');
    await setMode(MODES.DEMO);
    const dbPath = getDatabasePath();
    const dbHash = fs.existsSync(dbPath) ? getFileSha256(dbPath) : null;

    res.json({
      success: true,
      message: 'تم تفعيل وضع التجربة المعزول بنجاح',
      data: {
        appMode: MODES.DEMO,
        fixtureId: path.basename(dbPath),
        databaseHash: dbHash
      }
    });
  } catch (err) {
    logger.error('Failed to activate DEMO mode', { error: err.message });
    next(err);
  }
});

// POST /api/demo/reset
router.post('/reset', async (req, res, next) => {
  try {
    const currentMode = getMode();
    if (currentMode !== MODES.DEMO) {
      return res.status(403).json({
        success: false,
        error: 'إعادة الضبط متاحة فقط داخل وضع التجربة (DEMO MODE).'
      });
    }

    logger.info('Resetting DEMO environment from baseline fixture');
    await closeDb();

    const targetDemoDb = getDatabasePath();
    const baselineSource = path.join(FIXTURES_DIR, 'demo-normal.sqlite');

    if (fs.existsSync(baselineSource) && targetDemoDb !== baselineSource) {
      fs.copyFileSync(baselineSource, targetDemoDb);
    }

    await setMode(MODES.DEMO);

    const newHash = fs.existsSync(targetDemoDb) ? getFileSha256(targetDemoDb) : null;

    res.json({
      success: true,
      message: 'تمت إعادة ضبط بيئة التجربة بنجاح إلى الحالة الابتدائية',
      data: {
        appMode: MODES.DEMO,
        databasePath: process.env.NODE_ENV === 'production' ? '[REDACTED]' : targetDemoDb,
        databaseHash: newHash,
        resetAt: new Date().toISOString()
      }
    });
  } catch (err) {
    logger.error('Failed to reset DEMO environment', { error: err.message });
    next(err);
  }
});

// POST /api/demo/exit
router.post('/exit', async (req, res, next) => {
  try {
    logger.info('Exiting DEMO mode and switching to LIVE');
    await setMode(MODES.LIVE);

    res.json({
      success: true,
      message: 'تم الخروج من وضع التجربة بنجاح والعودة إلى النظام الفعلي',
      data: {
        appMode: MODES.LIVE
      }
    });
  } catch (err) {
    logger.error('Failed to exit DEMO mode', { error: err.message });
    next(err);
  }
});

module.exports = router;
