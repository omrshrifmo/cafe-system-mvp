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

// ─────────────────────────────────────────────────────────────────────────────
// First-Boot Setup & System Initialization (Zero-Touch Self-Serve SaaS)
// ─────────────────────────────────────────────────────────────────────────────
router.post(['/system/initialize', '/setup/initialize'], async (req, res, next) => {
  try {
    const { 
      admin_name, 
      admin_pin, 
      cafe_name, 
      currency, 
      vat_percent, 
      service_percent, 
      load_demo_data, 
      seed_mode 
    } = req.body;

    const pin = admin_pin || req.body.pin || '8801';
    const name = admin_name || req.body.name || 'سوبر أدمن';
    const cleanPin = String(pin).trim();

    if (cleanPin.length < 4) {
      return res.status(400).json({
        success: false,
        error: 'رمز PIN الخاص بالمسؤول يجب أن يتكون من 4 أرقام على الأقل'
      });
    }

    const { hashPin } = require('../../domain/auth/service');

    // 1. Hash admin PIN and create SUPER_ADMIN user
    const pinHash = await hashPin(cleanPin);

    // Ensure roles exist
    const canonicalRoles = [
      'SUPER_ADMIN', 'OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'BARISTA',
      'CHEF', 'SHISHA', 'WAITER', 'RUNNER', 'HALL_MANAGER', 'BOM_MANAGER',
      'HR_PAYROLL', 'QA', 'READ_ONLY', 'CASHIER'
    ];
    for (const r of canonicalRoles) {
      await runQuery(`INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [`R_${r}`, r]);
    }

    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
       VALUES ('101', 'V_DEFAULT', ?, 'R_SUPER_ADMIN', ?, 1, 0, NULL)`,
      [name, pinHash]
    );

    // 2. Save global config in system_config
    const shouldLoadDemo = load_demo_data === true || load_demo_data === 'true' || seed_mode === 'DEMO';
    const configs = [
      { key: 'cafe_name', value: cafe_name || 'كافيه مزاج' },
      { key: 'currency', value: currency || 'ج.م' },
      { key: 'vat_percent', value: String(vat_percent !== undefined ? vat_percent : 14) },
      { key: 'service_percent', value: String(service_percent !== undefined ? service_percent : 12) },
      { key: 'onboarding_state', value: 'COMPLETE' },
      { key: 'app_mode', value: shouldLoadDemo ? 'DEMO' : 'LIVE' },
      { key: 'setup_completed_at', value: new Date().toISOString() }
    ];

    for (const c of configs) {
      await runQuery(
        `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))`,
        [c.key, c.value]
      );
    }

    // 3. If load_demo_data is true, seed initial demo catalog & inventory
    if (shouldLoadDemo) {
      // Seed Demo Categories
      await runQuery(`INSERT OR IGNORE INTO menu_categories (id, name, icon, is_active) VALUES (1, 'مشروبات ساخنة', '☕', 1)`);
      await runQuery(`INSERT OR IGNORE INTO menu_categories (id, name, icon, is_active) VALUES (2, 'مشروبات باردة', '🥤', 1)`);
      await runQuery(`INSERT OR IGNORE INTO menu_categories (id, name, icon, is_active) VALUES (3, 'مأكولات وسندوتشات', '🥪', 1)`);
      await runQuery(`INSERT OR IGNORE INTO menu_categories (id, name, icon, is_active) VALUES (4, 'شيشة ومعسلات', '💨', 1)`);

      // Seed Demo Menu Items & Prices
      const demoItems = [
        { id: 1, cat: 1, name: 'إسبريسو سينجل', dept: 'BARISTA', price: 3000 },
        { id: 2, cat: 1, name: 'كابتشينو كلاسيك', dept: 'BARISTA', price: 5500 },
        { id: 3, cat: 1, name: 'لاتيه كراميل', dept: 'BARISTA', price: 6500 },
        { id: 4, cat: 2, name: 'مياه معدنية', dept: 'BARISTA', price: 1500 },
        { id: 5, cat: 3, name: 'ساندوتش تركي بالجبنة', dept: 'KITCHEN', price: 7500 },
        { id: 6, cat: 4, name: 'شيشة تفاحتين فاخر', dept: 'SHISHA', price: 8000 }
      ];

      for (const item of demoItems) {
        await runQuery(
          `INSERT OR IGNORE INTO menu_items (id, category_id, name, department, is_available, is_sellable, lifecycle_state)
           VALUES (?, ?, ?, ?, 1, 1, 'PUBLISHED')`,
          [item.id, item.cat, item.name, item.dept]
        );
        await runQuery(
          `INSERT OR REPLACE INTO menu_prices (menu_item_id, amount_minor, currency)
           VALUES (?, ?, ?)`,
          [item.id, item.price, currency || 'ج.م']
        );
      }

      // Seed Demo Inventory Items
      const demoInventory = [
        { id: 1, name: 'بن حبوب إسبريسو', cat: 'بن', unit: 'kg', min: 5, cost: 45000, stock: 25000000 },
        { id: 2, name: 'حليب كامل الدسم', cat: 'ألبان', unit: 'L', min: 10, cost: 3500, stock: 50000000 },
        { id: 3, name: 'سيرب كراميل', cat: 'سيرب', unit: 'bottle', min: 2, cost: 12000, stock: 10000000 },
        { id: 4, name: 'معسل تفاحتين', cat: 'معسل', unit: 'kg', min: 3, cost: 35000, stock: 15000000 },
        { id: 5, name: 'فحم شيشة طبيعي', cat: 'فحم', unit: 'kg', min: 10, cost: 4500, stock: 40000000 }
      ];

      for (const inv of demoInventory) {
        await runQuery(
          `INSERT OR IGNORE INTO inventory_items (id, name, category, unit, min_limit, cost_per_unit_minor, current_stock_microunits, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [inv.id, inv.name, inv.cat, inv.unit, inv.min, inv.cost, inv.stock]
        );
      }
    }

    res.json({
      success: true,
      message: 'تم تهيئة النظام بنجاح وتجهيز حساب المسؤول',
      admin_id: '101',
      mode: shouldLoadDemo ? 'DEMO' : 'LIVE'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
