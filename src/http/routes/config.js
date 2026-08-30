/**
 * Global Configuration & Maintenance HTTP Routes
 * Strictly enforces authentication and role permissions
 */
const express = require('express');
const router = express.Router();
const { getSystemTaxConfig } = require('../../domain/payments/service');
const { verifyReauthentication } = require('../../domain/auth/service');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { runQuery, getQuery } = require('../../db/connection');
const env = require('../../config/env');

// Public non-sensitive cafe branding info & tax parameters for POS / QR
router.get('/config/public', async (req, res, next) => {
  try {
    const cafeName = await getQuery(`SELECT value FROM system_config WHERE key = 'cafe_name'`);
    const currency = await getQuery(`SELECT value FROM system_config WHERE key = 'currency'`);
    const headerNote = await getQuery(`SELECT value FROM system_config WHERE key = 'header_note'`);
    const footerNote = await getQuery(`SELECT value FROM system_config WHERE key = 'footer_note'`);
    const vatPercent = await getQuery(`SELECT value FROM system_config WHERE key = 'vat_percent'`);
    const servicePercent = await getQuery(`SELECT value FROM system_config WHERE key = 'service_percent'`);

    res.json({
      success: true,
      config: {
        cafe_name: cafeName ? cafeName.value : 'كافيه مزاج',
        currency: currency ? currency.value : 'ج.م',
        header_note: headerNote ? headerNote.value : '',
        footer_note: footerNote ? footerNote.value : '',
        vat_percent: vatPercent ? Number(vatPercent.value) : 14,
        service_percent: servicePercent ? Number(servicePercent.value) : 12,
        apply_taxes: true
      }
    });
  } catch (err) {
    next(err);
  }
});

// Full operational configuration - strictly requires system:settings
router.get('/config', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const config = await getSystemTaxConfig();
    res.json({
      success: true,
      config
    });
  } catch (err) {
    next(err);
  }
});

router.post('/config', requireAuth, requirePermission('system:settings'), async (req, res, next) => {
  try {
    const updates = req.body;
    for (const [k, v] of Object.entries(updates)) {
      await runQuery(
        `INSERT INTO system_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [k, String(v)]
      );
    }
    const updated = await getSystemTaxConfig();
    res.json({
      success: true,
      message: 'تم حفظ إعدادات النظام بنجاح ⚙️',
      config: updated
    });
  } catch (err) {
    next(err);
  }
});

router.post('/system/factory-reset', requireAuth, async (req, res, next) => {
  try {
    if (env.ALLOW_FACTORY_RESET !== 'true' && env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'إعادة ضبط المصنع معطلة بشكل افتراضي في بيئة الإنتاج لأسباب الأمان'
      });
    }

    if (!['SUPER_ADMIN', 'OWNER'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'إعادة ضبط المصنع تتطلب صلاحيات المالك أو السوبر أدمن'
      });
    }

    const pin = req.body.pin || req.body.pin_code;
    const isPinValid = await verifyReauthentication(req.user.id, pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        error: 'رمز PIN للتأكيد غير صحيح'
      });
    }

    // Safely clear transactional data while preserving schema and configuration
    await runQuery('DELETE FROM order_items');
    await runQuery('DELETE FROM payments');
    await runQuery('DELETE FROM payment_reversals');
    await runQuery('DELETE FROM order_sessions');
    await runQuery('DELETE FROM table_sessions');
    await runQuery('DELETE FROM inventory_ledger');
    await runQuery('DELETE FROM drawer_declarations');
    await runQuery('DELETE FROM shifts');
    await runQuery('DELETE FROM daily_expenses');
    await runQuery('DELETE FROM employee_advances');
    await runQuery('DELETE FROM penalties');
    await runQuery('DELETE FROM complaints');
    await runQuery('DELETE FROM print_jobs');
    await runQuery('DELETE FROM outbox_events');
    await runQuery('UPDATE tables SET status = "AVAILABLE"');

    res.json({
      success: true,
      message: 'تمت إعادة ضبط بيانات العمليات بنجاح'
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// In-App Backup & Recovery System (Safe SQLite WAL Snapshot & Full Restore)
// =========================================================================
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createHotBackup, verifyBackup } = require('../../domain/system/backupService');
const { closeDb } = require('../../db/connection');

const uploadBackup = multer({
  dest: path.join(__dirname, '../../../backups/uploads'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// GET /api/system/backup (also alias /api/backup)
router.get(['/system/backup', '/backup'], requireAuth, async (req, res, next) => {
  try {
    if (!['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح: النسخ الاحتياطي يتطلب صلاحيات المالك أو السوبر أدمن'
      });
    }

    const manifest = await createHotBackup();
    const filePath = manifest.file_path;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const downloadName = `mazaj_backup_${dateStr}.db`;

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/system/restore (also alias /api/restore)
router.post(['/system/restore', '/restore'], requireAuth, uploadBackup.single('database'), async (req, res, next) => {
  try {
    if (!['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح: استعادة النظام تتطلب صلاحيات السوبر أدمن'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'يرجى اختيار ملف قاعدة بيانات SQLite (.db / .sqlite)'
      });
    }

    const uploadedPath = req.file.path;

    // Verify integrity of the uploaded backup before touching active DB
    let verification;
    try {
      verification = await verifyBackup(uploadedPath);
    } catch (verErr) {
      try { fs.unlinkSync(uploadedPath); } catch (e) {}
      return res.status(400).json({
        success: false,
        error: 'الملف المرفوع تالف أو ليس قاعدة بيانات SQLite صالحة: ' + verErr.message
      });
    }

    if (!verification || !verification.valid) {
      try { fs.unlinkSync(uploadedPath); } catch (e) {}
      return res.status(400).json({
        success: false,
        error: 'الملف المرفوع تالف أو ليس قاعدة بيانات SQLite صالحة'
      });
    }

    // Safely close connection, flush WAL, and replace DB file
    const targetDbPath = env.DATABASE_PATH || path.join(__dirname, '../../../cafe.db');
    const walPath = `${targetDbPath}-wal`;
    const shmPath = `${targetDbPath}-shm`;

    await closeDb();

    // Copy uploaded file to target DB path
    fs.copyFileSync(uploadedPath, targetDbPath);
    try { fs.unlinkSync(uploadedPath); } catch (e) {}

    // Clean up old WAL/SHM files so new database opens cleanly
    if (fs.existsSync(walPath)) {
      try { fs.unlinkSync(walPath); } catch (e) {}
    }
    if (fs.existsSync(shmPath)) {
      try { fs.unlinkSync(shmPath); } catch (e) {}
    }

    res.json({
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح واستئناف الخدمات 🚀',
      tables_count: verification.table_count,
      checksum: verification.sha256_checksum
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    next(err);
  }
});

module.exports = router;
