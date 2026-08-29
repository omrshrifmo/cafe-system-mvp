/**
 * Enterprise Deterministic Fixture Service & Generator
 * Generates and deterministically resets isolated fixture databases:
 * - clean_fixture.db
 * - legacy_cafe.db
 * - concurrency_fixture.db
 * - offline_fixture.db
 * - full_day_fixture.db
 * 
 * Strict Gate: NEVER resets or mutates cafe.db or production databases.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { runMigrations } = require('../../db/migrator');
const { assertSafeMutationTarget } = require('./mutationGuard');
const { hashPin } = require('../auth/service');
const logger = require('../../observability/logger');

const ROOT_FIXTURES_DIR = path.join(__dirname, '../../../fixtures');
const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const MANIFEST_PATH = path.join(__dirname, '../../../artifacts/fixtures/fixture_manifest.json');

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Helper to run query on a specific SQLite instance with Promises
 */
function execSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!params || params.length === 0) {
      db.exec(sql, function (err) {
        if (err) return reject(err);
        resolve({ changes: this ? this.changes : 0 });
      });
    } else {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    }
  });
}

function queryAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Open fresh isolated database connection with pragmas
 */
function openFixtureDb(dbPath) {
  assertSafeMutationTarget(dbPath, 'Fixture DB Creation');
  
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch (e) {}
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      resolve(db);
    });
  });
}

function closeFixtureDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * 1. Clean Fixture (fixtures/clean.sqlite)
 */
async function generateCleanFixture(targetDir = ROOT_FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'clean.sqlite');
  logger.info('Generating Clean Fixture...', { dbPath });
  const db = await openFixtureDb(dbPath);
  await runMigrations(db);
  await execSql(db, `ALTER TABLE purchases ADD COLUMN invoice_ref TEXT NULL;`).catch(() => {});
  await execSql(db, `ALTER TABLE purchases ADD COLUMN total_cost REAL DEFAULT 0;`).catch(() => {});
  await closeFixtureDb(db);
  
  // Also create clean_fixture.db for legacy test compatibility
  if (targetDir === ROOT_FIXTURES_DIR) {
    fs.copyFileSync(dbPath, path.join(FIXTURES_DIR, 'clean_fixture.db'));
  }
  return { name: 'clean.sqlite', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 2. Legacy Fixture
 */
async function generateLegacyFixture(targetDir = FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'legacy_cafe.db');
  logger.info('Generating Legacy Fixture...', { dbPath });
  const db = await openFixtureDb(dbPath);
  await runMigrations(db);
  
  // Seed representative legacy records
  await execSql(db, `
    INSERT OR IGNORE INTO menu_categories (id, name, name_en, sort_order, is_active) VALUES 
    (1, 'مشروبات ساخنة', 'Hot Drinks', 1, 1),
    (2, 'مشروبات باردة', 'Cold Drinks', 2, 1),
    (3, 'شيشة', 'Hookah', 3, 1),
    (4, 'مأكولات', 'Food', 4, 1);
  `);
  
  await closeFixtureDb(db);
  return { name: 'legacy_cafe.db', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 3. Concurrency Fixture (fixtures/concurrency.sqlite)
 */
async function generateConcurrencyFixture(targetDir = ROOT_FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'concurrency.sqlite');
  logger.info('Generating Concurrency Fixture...', { dbPath });
  const db = await openFixtureDb(dbPath);
  await runMigrations(db);

  // Seed ample inventory and menu item for high concurrency
  await execSql(db, `
    INSERT OR IGNORE INTO inventory_items (id, name, category, unit, cost_per_unit_minor, min_limit, current_stock_microunits, is_active)
    VALUES (101, 'Coffee Beans Bulk', 'BARISTA', 'g', 50, 1000, 1000000000, 1);
    
    INSERT OR IGNORE INTO menu_categories (id, name, name_en, sort_order, is_active) VALUES (1, 'Hot Drinks', 'Hot Drinks', 1, 1);
    INSERT OR IGNORE INTO menu_items (id, category_id, name, name_en, department, is_available, lifecycle_state)
    VALUES (201, 1, 'Stress Test Espresso', 'Stress Test Espresso', 'BARISTA', 1, 'PUBLISHED');

    INSERT OR IGNORE INTO menu_prices (id, menu_item_id, amount_minor, currency, valid_from)
    VALUES (201, 201, 3500, 'EGP', '2026-01-01');

    INSERT OR IGNORE INTO recipe_versions (id, menu_item_id, version, instructions) VALUES (301, 201, 1, 'Standard shot');
    INSERT OR IGNORE INTO recipe_ingredients (id, recipe_version_id, inventory_item_id, quantity_microunits, unit)
    VALUES (401, 301, 101, 18000000, 'g');

    INSERT OR IGNORE INTO tables (id, table_number, zone, capacity, status)
    VALUES (1, 1, 'INDOOR_1', 4, 'VACANT');
  `);

  await closeFixtureDb(db);
  if (targetDir === ROOT_FIXTURES_DIR) {
    fs.copyFileSync(dbPath, path.join(FIXTURES_DIR, 'concurrency_fixture.db'));
  }
  return { name: 'concurrency.sqlite', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 4. Offline Fixture (fixtures/offline.sqlite)
 */
async function generateOfflineFixture(targetDir = ROOT_FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'offline.sqlite');
  logger.info('Generating Offline Fixture...', { dbPath });
  const db = await openFixtureDb(dbPath);
  await runMigrations(db);
  await closeFixtureDb(db);
  if (targetDir === ROOT_FIXTURES_DIR) {
    fs.copyFileSync(dbPath, path.join(FIXTURES_DIR, 'offline_fixture.db'));
  }
  return { name: 'offline.sqlite', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 5. Full Day Fixture (Comprehensive 2-Shift Golden Dataset)
 */
async function generateFullDayFixture(targetDir = FIXTURES_DIR, filename = 'full_day_fixture.db') {
  const dbPath = path.join(targetDir, filename);
  logger.info('Generating Full Day Fixture...', { dbPath });
  const db = await openFixtureDb(dbPath);
  await runMigrations(db);
  await execSql(db, `ALTER TABLE purchases ADD COLUMN invoice_ref TEXT NULL;`).catch(() => {});
  await execSql(db, `ALTER TABLE purchases ADD COLUMN total_cost REAL DEFAULT 0;`).catch(() => {});

  // A. Venues & Branches
  await execSql(db, `
    INSERT OR REPLACE INTO venues (
      id, name, legal_name, name_ar, name_en, tax_registration_number, address, contact_phone, contact_email, locale
    ) VALUES (
      'V_DEFAULT', 'كافيه مزاج الذهب', 'شركة كافيه مزاج الذهب لخدمات الضيافة ذ.م.م', 'كافيه مزاج الذهب', 'Mazaj Gold Cafe', 'EG-394857201', 'شارع التسعين الشمالي، التجمع الخامس، القاهرة', '+201009876543', 'contact@mazajcafe.eg', 'ar'
    );

    INSERT OR REPLACE INTO branches (id, venue_id, name, status)
    VALUES ('BR_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي', 'ACTIVE');
    INSERT OR REPLACE INTO branches (id, venue_id, name, status)
    VALUES ('B_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي', 'ACTIVE');
  `);

  // B. Staff Role Matrix & Users (Hashed PINs)
  const allRoles = [
    'SUPER_ADMIN', 'OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'CASHIER',
    'HEAD_CHEF', 'CHEF', 'BARISTA', 'SHISHA_WAITER', 'SHISHA', 'HEAD_WAITER', 'WAITER',
    'RUNNER', 'ACCOUNTANT', 'HALL_MANAGER', 'BOM_MANAGER', 'HR_PAYROLL', 'QA', 'READ_ONLY', 'JOKER', 'MANAGER'
  ];

  for (const r of allRoles) {
    await execSql(db, `INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [r, r]);
    await execSql(db, `INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_' || ?, 'V_DEFAULT', ?)`, [r, r]);
  }

  const pinUsers = [
    { id: '1', name: 'عمر (مدير النظام)', role: 'R_SUPER_ADMIN', pin: '9001' },
    { id: '2', name: 'فاطمة (المالك)', role: 'R_OWNER', pin: '9009' },
    { id: '3', name: 'وائل (مدير العمليات)', role: 'R_OP_MANAGER', pin: '9008' },
    { id: '4', name: 'أحمد كركر (كاشير رئيسي)', role: 'R_OP_ASSISTANT_CASHIER', pin: '9007' },
    { id: '5', name: 'سارة محمود (كاشير مسائي)', role: 'R_CASHIER', pin: '9006' },
    { id: '6', name: 'الشيف مصطفى (رئيس المطبخ)', role: 'R_CHEF', pin: '9005' },
    { id: '7', name: 'هاجر / بيبو (باريستا)', role: 'R_BARISTA', pin: '9002' },
    { id: '8', name: 'عماد فحم (معلم الشيشة)', role: 'R_SHISHA', pin: '9003' },
    { id: '9', name: 'كريم (كابتن صالة)', role: 'R_HALL_MANAGER', pin: '9004' },
    { id: '10', name: 'علي (ويتر)', role: 'R_WAITER', pin: '9010' },
    { id: '11', name: 'حسن سريع (مساعد صالة / رانر)', role: 'R_RUNNER', pin: '9011' },
    { id: '12', name: 'مدحت مالي (محاسب)', role: 'R_OP_MANAGER', pin: '9012' },

    // Mazaj Production Staff Hierarchy (PIN 1001 - 1012)
    { id: '35', name: 'أحمد (ويتر/جوكر)', role: 'R_WAITER', pin: '1001' },
    { id: '36', name: 'هاجر بيبو (باريستا)', role: 'R_BARISTA', pin: '1002' },
    { id: '37', name: 'أسماء (مسؤول شيشة)', role: 'R_SHISHA', pin: '1003' },
    { id: '38', name: 'الشيف (شيف المطبخ)', role: 'R_CHEF', pin: '1004' },
    { id: '39', name: 'أمل (ويتر)', role: 'R_WAITER', pin: '1005' },
    { id: '40', name: 'إبراهيم (مدير صالة)', role: 'R_HALL_MANAGER', pin: '1006' },
    { id: '41', name: 'أحمد كركر (كاشير)', role: 'R_OP_ASSISTANT_CASHIER', pin: '1007' },
    { id: '42', name: 'وائل (مدير عمليات)', role: 'R_OP_MANAGER', pin: '1008' },
    { id: '43', name: 'فاطمة (مالك)', role: 'R_OWNER', pin: '1009' },
    { id: '44', name: 'وائل 2 (مالك)', role: 'R_OWNER', pin: '1010' },
    { id: '45', name: 'عمر (مسؤول نظام)', role: 'R_SUPER_ADMIN', pin: '1011' },
    { id: '46', name: 'شعراوي (مدير تكاليف BOM)', role: 'R_BOM_MANAGER', pin: '1012' },

    // Role-matrix test users (PIN 8801 - 8814)
    { id: '101', name: 'سوبر أدمن', role: 'R_SUPER_ADMIN', pin: '8801' },
    { id: '102', name: 'المالك التجريبي', role: 'R_OWNER', pin: '8802' },
    { id: '103', name: 'مدير العمليات', role: 'R_OP_MANAGER', pin: '8803' },
    { id: '104', name: 'كاشير رئيسي', role: 'R_OP_ASSISTANT_CASHIER', pin: '8804' },
    { id: '105', name: 'باريستا', role: 'R_BARISTA', pin: '8805' },
    { id: '106', name: 'شيف المطبخ', role: 'R_CHEF', pin: '8806' },
    { id: '107', name: 'مسؤول الشيشة', role: 'R_SHISHA', pin: '8807' },
    { id: '108', name: 'ويتر الصالة', role: 'R_WAITER', pin: '8808' },
    { id: '109', name: 'رانر التوصيل', role: 'R_RUNNER', pin: '8809' },
    { id: '110', name: 'مدير الصالة', role: 'R_HALL_MANAGER', pin: '8810' },
    { id: '111', name: 'مدير المخزون والوصفات', role: 'R_BOM_MANAGER', pin: '8811' },
    { id: '112', name: 'مسؤول الرواتب وشؤون الموظفين', role: 'R_HR_PAYROLL', pin: '8812' },
    { id: '113', name: 'مراقب الجودة', role: 'R_QA', pin: '8813' },
    { id: '114', name: 'مستخدم تقارير للقراءة فقط', role: 'R_READ_ONLY', pin: '8814' },

    // Station test users
    { id: '201', name: 'Barista User', role: 'R_BARISTA', pin: '9201' },
    { id: '202', name: 'Chef User', role: 'R_CHEF', pin: '9202' },
    { id: '203', name: 'Runner User', role: 'R_RUNNER', pin: '9203' },
    { id: '204', name: 'Manager User', role: 'R_OP_MANAGER', pin: '9204' },

    // Shifts test users
    { id: '301', name: 'كاشير الصباح', role: 'R_OP_ASSISTANT_CASHIER', pin: '9301' },
    { id: '302', name: 'مالك الكافيه', role: 'R_OWNER', pin: '9302' }
  ];

  for (const u of pinUsers) {
    const hashed = await hashPin(u.pin);
    const numericId = parseInt(u.id, 10);
    // Legacy users table
    if (!isNaN(numericId)) {
      await execSql(db, `
        INSERT OR REPLACE INTO users (id, name, pin_hash, role, is_active)
        VALUES (?, ?, ?, ?, 1)
      `, [numericId, u.name, hashed, u.role.replace(/^R_/, '')]);
    }

    // V3 users table
    await execSql(db, `
      INSERT OR REPLACE INTO v3_users (id, venue_id, name, pin_hash, role_id, is_active)
      VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)
    `, [u.id, u.name, hashed, u.role]);
  }

  // C. Policies
  await execSql(db, `
    INSERT OR REPLACE INTO v3_policies (
      id, venue_id, version, effective_from, payload, created_by
    ) VALUES (
      'POL_DEFAULT', 'V_DEFAULT', 1, '2026-01-01',
      '{"vat_rate":0.14,"service_charge_rate":0.12,"prices_include_tax":false,"cash_drawer_auto_kick":true,"blind_cashier_mode":true}',
      '1'
    );
  `);

  // C. Verified Suppliers & Vendors
  await execSql(db, `
    INSERT OR REPLACE INTO suppliers (id, name, contact_person, phone, category, address, notes)
    VALUES 
    (1, 'شركة مطاحن البن الفاخر', 'م. حسام الشامي', '+201099887766', 'COFFEE', 'المنطقة الصناعية، 6 أكتوبر', 'sales@specialtycoffee.eg'),
    (2, 'مزارع الدلتا للألبان والمخبوزات', 'أ. سامح عبد الفتاح', '+201122334455', 'DAIRY', 'طريق مصر الإسكندرية الزراعي', 'orders@deltadairy.eg'),
    (3, 'شركة النور لمستلزمات المقاهي والشيشة', 'الحاج نور الدين', '+201233445566', 'SHISHA', 'باب الشعرية، القاهرة', 'alnoor.supplies@gmail.com');

    INSERT OR REPLACE INTO vendors (id, name, category, contact_details, status)
    VALUES
    ('VEND-1', 'شركة مطاحن البن الفاخر', 'COFFEE', 'sales@specialtycoffee.eg', 'ACTIVE'),
    ('VEND-2', 'مزارع الدلتا للألبان والمخبوزات', 'DAIRY_BAKERY', 'orders@deltadairy.eg', 'ACTIVE'),
    ('VEND-3', 'شركة النور لمستلزمات المقاهي والشيشة', 'SUPPLIES_SHISHA', 'alnoor.supplies@gmail.com', 'ACTIVE');
  `);

  // D. Raw Materials / Inventory Items
  const rawMaterials = [
    { id: 1, name: 'حبوب بن إسبريسو ممتازة', cat: 'BARISTA', unit: 'g', cost_minor: 85, reorder: 2000, stock_micro: 15000000000, supplier_id: 1 },
    { id: 2, name: 'حليب طازج كامل الدسم', cat: 'BARISTA', unit: 'ml', cost_minor: 4, reorder: 5000, stock_micro: 25000000000, supplier_id: 2 },
    { id: 3, name: 'أكواب ورقية 8 أونصة بغطاء', cat: 'BARISTA', unit: 'pcs', cost_minor: 150, reorder: 100, stock_micro: 500000000, supplier_id: 3 },
    { id: 4, name: 'أكواب زجاجية للتقديم الداخلي', cat: 'BARISTA', unit: 'pcs', cost_minor: 1500, reorder: 30, stock_micro: 150000000, supplier_id: 3 },
    { id: 5, name: 'معسل تفاحتين فاخر', cat: 'SHISHA', unit: 'g', cost_minor: 60, reorder: 1000, stock_micro: 5000000000, supplier_id: 3 },
    { id: 6, name: 'فحم طبيعي سريع الاشتعال', cat: 'SHISHA', unit: 'pcs', cost_minor: 50, reorder: 200, stock_micro: 1000000000, supplier_id: 3 },
    { id: 7, name: 'خبز توست أبيض فاخر', cat: 'KITCHEN', unit: 'pcs', cost_minor: 200, reorder: 40, stock_micro: 200000000, supplier_id: 2 },
    { id: 8, name: 'صدور دجاج متبلة جاهزة', cat: 'KITCHEN', unit: 'g', cost_minor: 22, reorder: 1500, stock_micro: 8000000000, supplier_id: 2 },
    { id: 9, name: 'سكر أبيض نقي معبأ', cat: 'BARISTA', unit: 'g', cost_minor: 3, reorder: 2000, stock_micro: 10000000000, supplier_id: 2 },
    { id: 10, name: 'سيروب فانيليا إيطالي', cat: 'BARISTA', unit: 'ml', cost_minor: 15, reorder: 500, stock_micro: 3000000000, supplier_id: 1 },
    { id: 11, name: 'بودرة كريم بروليه فرنسية', cat: 'KITCHEN', unit: 'g', cost_minor: 18, reorder: 800, stock_micro: 4000000000, supplier_id: 1 },
    { id: 12, name: 'أوراق نعناع وليمون طازج', cat: 'BARISTA', unit: 'g', cost_minor: 5, reorder: 400, stock_micro: 2000000000, supplier_id: 2 }
  ];

  for (const mat of rawMaterials) {
    await execSql(db, `
      INSERT OR REPLACE INTO inventory_items (
        id, name, category, unit, cost_per_unit_minor, min_limit, current_stock_microunits, is_active, default_supplier_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [mat.id, mat.name, mat.cat, mat.unit, mat.cost_minor, mat.reorder, mat.stock_micro, mat.supplier_id]);

    await execSql(db, `
      INSERT OR REPLACE INTO v3_inventory_items (
        id, venue_id, name, category, unit, min_limit, cost_per_unit_minor
      ) VALUES (?, 'V_DEFAULT', ?, ?, ?, ?, ?)
    `, [String(mat.id), mat.name, mat.cat, mat.unit, mat.reorder, mat.cost_minor]);

    await execSql(db, `
      INSERT OR IGNORE INTO inventory_ledger (
        inventory_item_id, event_type, quantity_delta_microunits,
        unit, unit_cost_minor, source_type, source_id, idempotency_key, actor_id, reason, cost_basis
      ) VALUES (
        ?, 'OPENING_BALANCE', ?,
        ?, ?, 'OPENING_COUNT', 'INIT', ?, 1, 'الرصيد الافتتاحي الموثق', 'ACTUAL'
      )
    `, [mat.id, mat.stock_micro, mat.unit, mat.cost_minor, `OPENING_${mat.id}`]);
  }

  // E. Canonical Menu Categories & Items
  await execSql(db, `
    INSERT OR REPLACE INTO menu_categories (id, name, name_en, icon, color, sort_order, is_active, is_quarantined) VALUES
    (1, 'مشروبات ساخنة', 'Hot Drinks', '☕', '#d97706', 1, 1, 0),
    (2, 'حلويات', 'Desserts', '🍰', '#db2777', 3, 1, 0),
    (3, 'مشروبات باردة', 'Cold Drinks', '🧊', '#0284c7', 2, 1, 0),
    (6, 'مأكولات', 'Food', '🥪', '#16a34a', 4, 1, 0),
    (7, 'شيشة', 'Shisha', '💨', '#7c3aed', 5, 1, 0);

    INSERT OR REPLACE INTO v3_menu_categories (id, venue_id, name, icon, display_order) VALUES
    ('CAT-1', 'V_DEFAULT', 'مشروبات ساخنة', '☕', 1),
    ('CAT-2', 'V_DEFAULT', 'حلويات', '🍰', 3),
    ('CAT-3', 'V_DEFAULT', 'مشروبات باردة', '🧊', 2),
    ('CAT-6', 'V_DEFAULT', 'مأكولات', '🥪', 4),
    ('CAT-7', 'V_DEFAULT', 'شيشة', '💨', 5);
  `);

  const menuItems = [
    { id: 1, cat: 1, name: 'Single Espresso', ar: 'إسبريسو سنغل', price: 3500, dept: 'BARISTA', sku: 'SKU-BEV-ESPRESSO-SGL' },
    { id: 2, cat: 1, name: 'Double Espresso', ar: 'إسبريسو دبل', price: 5000, dept: 'BARISTA', sku: 'SKU-BEV-ESPRESSO-DBL' },
    { id: 3, cat: 1, name: 'Caffe Latte', ar: 'كافيه لاتيه', price: 5000, dept: 'BARISTA', sku: 'SKU-BEV-LATTE' },
    { id: 4, cat: 1, name: 'Italian Cappuccino', ar: 'كابتشينو إيطالي', price: 5000, dept: 'BARISTA', sku: 'SKU-BEV-CAPPUCCINO' },
    { id: 5, cat: 3, name: 'Iced Vanilla Latte', ar: 'أيس فانيليا لاتيه', price: 6000, dept: 'BARISTA', sku: 'SKU-BEV-LATTE-ICE' },
    { id: 6, cat: 3, name: 'Lemon Mint Mojito', ar: 'موهيتو ليمون نعناع', price: 4500, dept: 'BARISTA', sku: 'SKU-BEV-MOJITO-MINT' },
    { id: 7, cat: 7, name: 'Double Apple Shisha', ar: 'شيشة تفاحتين فاخر', price: 6500, dept: 'SHISHA', sku: 'SKU-SHI-DOUBLE-APPLE' },
    { id: 8, cat: 7, name: 'Mint Shisha', ar: 'شيشة نعناع بارد', price: 6500, dept: 'SHISHA', sku: 'SKU-SHI-MINT' },
    { id: 9, cat: 6, name: 'Grilled Chicken Club Sandwich', ar: 'كلوب ساندوتش فراخ مشوية', price: 10000, dept: 'KITCHEN', sku: 'SKU-FOOD-CLUBSANDWICH-CHK' },
    { id: 10, cat: 6, name: 'Crispy French Fries', ar: 'طبق بطاطس مقلية مقرمشة', price: 4000, dept: 'KITCHEN', sku: 'SKU-FOOD-FRIES' },
    { id: 11, cat: 2, name: 'Crème Brûlée', ar: 'كريم بروليه فاخر', price: 3500, dept: 'KITCHEN', sku: 'SKU-DSRT-CREME-BRULEE' },
    { id: 12, cat: 2, name: 'Molten Chocolate Cake', ar: 'مولتن شوكولاتة مع آيس كريم', price: 8000, dept: 'KITCHEN', sku: 'SKU-DSRT-MOLTEN-CAKE' },
    { id: 19, cat: 6, name: 'Turkey & Cheese Club Sandwich', ar: 'كلوب ساندوتش تركي وجبن', price: 11000, dept: 'KITCHEN', sku: 'SKU-FOOD-CLUBSANDWICH-TRK' }
  ];

  for (const item of menuItems) {
    await execSql(db, `
      INSERT OR REPLACE INTO menu_items (
        id, category_id, name, name_en, department, sku, is_available, is_sellable, lifecycle_state
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'PUBLISHED')
    `, [item.id, item.cat, item.ar, item.name, item.dept, item.sku]);

    await execSql(db, `
      INSERT OR REPLACE INTO v3_menu_items (
        id, category_id, name, department, is_available
      ) VALUES (?, ?, ?, ?, 1)
    `, [String(item.id), `CAT-${item.cat}`, item.ar, item.dept]);

    // Active price snapshot in menu_prices & v3_menu_prices
    await execSql(db, `
      INSERT OR REPLACE INTO menu_prices (
        id, menu_item_id, amount_minor, currency, valid_from
      ) VALUES (?, ?, ?, 'EGP', '2026-01-01')
    `, [item.id, item.id, item.price]);

    await execSql(db, `
      INSERT OR REPLACE INTO v3_menu_prices (
        id, menu_item_id, amount_minor, currency, effective_date
      ) VALUES (?, ?, ?, 'EGP', '2026-01-01')
    `, [`PRC-${item.id}`, String(item.id), item.price]);
  }

  // F. BOM Recipes
  const recipes = [
    { id: 1, item_id: 1, lines: [{ mat: 1, qty_micro: 18000000, unit: 'g' }] },
    { id: 2, item_id: 2, lines: [{ mat: 1, qty_micro: 36000000, unit: 'g' }] },
    { id: 3, item_id: 3, lines: [{ mat: 1, qty_micro: 18000000, unit: 'g' }, { mat: 2, qty_micro: 200000000, unit: 'ml' }] },
    { id: 4, item_id: 4, lines: [{ mat: 1, qty_micro: 18000000, unit: 'g' }, { mat: 2, qty_micro: 150000000, unit: 'ml' }] },
    { id: 5, item_id: 5, lines: [{ mat: 1, qty_micro: 18000000, unit: 'g' }, { mat: 2, qty_micro: 200000000, unit: 'ml' }, { mat: 10, qty_micro: 25000000, unit: 'ml' }, { mat: 3, qty_micro: 1000000, unit: 'pcs' }] },
    { id: 6, item_id: 6, lines: [{ mat: 12, qty_micro: 50000000, unit: 'g' }, { mat: 9, qty_micro: 20000000, unit: 'g' }, { mat: 3, qty_micro: 1000000, unit: 'pcs' }] },
    { id: 7, item_id: 7, lines: [{ mat: 5, qty_micro: 25000000, unit: 'g' }, { mat: 6, qty_micro: 3000000, unit: 'pcs' }] },
    { id: 8, item_id: 8, lines: [{ mat: 5, qty_micro: 25000000, unit: 'g' }, { mat: 6, qty_micro: 3000000, unit: 'pcs' }] },
    { id: 9, item_id: 9, lines: [{ mat: 7, qty_micro: 2000000, unit: 'pcs' }, { mat: 8, qty_micro: 150000000, unit: 'g' }] },
    { id: 10, item_id: 10, lines: [{ mat: 9, qty_micro: 5000000, unit: 'g' }] },
    { id: 11, item_id: 11, lines: [{ mat: 11, qty_micro: 80000000, unit: 'g' }, { mat: 2, qty_micro: 100000000, unit: 'ml' }, { mat: 9, qty_micro: 15000000, unit: 'g' }] },
    { id: 12, item_id: 12, lines: [{ mat: 9, qty_micro: 50000000, unit: 'g' }, { mat: 2, qty_micro: 50000000, unit: 'ml' }] }
  ];

  for (const r of recipes) {
    await execSql(db, `INSERT OR REPLACE INTO recipe_versions (id, menu_item_id, version, instructions) VALUES (?, ?, 1, 'Standard preparation')`, [r.id, r.item_id]);
    for (let i = 0; i < r.lines.length; i++) {
      const line = r.lines[i];
      const lineId = r.id * 100 + (i + 1);
      await execSql(db, `
        INSERT OR REPLACE INTO recipe_ingredients (id, recipe_version_id, inventory_item_id, quantity_microunits, unit)
        VALUES (?, ?, ?, ?, ?)
      `, [lineId, r.id, line.mat, line.qty_micro, line.unit]);
    }
  }

  // G. 20+ Tables Across 4 Zones + Custom Table 99 VIP
  const tables = [
    // Indoor Hall 1
    { id: 'T-1', num: 1, name: 'طاولة 1', zone: 'Indoor Hall 1', cap: 2 },
    { id: 'T-2', num: 2, name: 'طاولة 2', zone: 'Indoor Hall 1', cap: 4 },
    { id: 'T-3', num: 3, name: 'طاولة 3', zone: 'Indoor Hall 1', cap: 4 },
    { id: 'T-4', num: 4, name: 'طاولة 4', zone: 'Indoor Hall 1', cap: 2 },
    { id: 'T-5', num: 5, name: 'طاولة 5', zone: 'Indoor Hall 1', cap: 6 },
    { id: 'T-6', num: 6, name: 'طاولة 6', zone: 'Indoor Hall 1', cap: 4 },
    // Indoor Hall 2
    { id: 'T-7', num: 7, name: 'طاولة 7', zone: 'Indoor Hall 2', cap: 4 },
    { id: 'T-8', num: 8, name: 'طاولة 8', zone: 'Indoor Hall 2', cap: 4 },
    { id: 'T-9', num: 9, name: 'طاولة 9', zone: 'Indoor Hall 2', cap: 2 },
    { id: 'T-10', num: 10, name: 'طاولة 10', zone: 'Indoor Hall 2', cap: 6 },
    { id: 'T-11', num: 11, name: 'طاولة 11', zone: 'Indoor Hall 2', cap: 4 },
    { id: 'T-12', num: 12, name: 'طاولة 12', zone: 'Indoor Hall 2', cap: 2 },
    // Outdoor Terrace
    { id: 'T-13', num: 13, name: 'طاولة 13 - تراس', zone: 'Outdoor Terrace', cap: 4 },
    { id: 'T-14', num: 14, name: 'طاولة 14 - تراس', zone: 'Outdoor Terrace', cap: 4 },
    { id: 'T-15', num: 15, name: 'طاولة 15 - تراس', zone: 'Outdoor Terrace', cap: 2 },
    { id: 'T-16', num: 16, name: 'طاولة 16 - تراس', zone: 'Outdoor Terrace', cap: 6 },
    { id: 'T-17', num: 17, name: 'طاولة 17 - تراس', zone: 'Outdoor Terrace', cap: 4 },
    { id: 'T-18', num: 18, name: 'طاولة 18 - تراس', zone: 'Outdoor Terrace', cap: 4 },
    // VIP Lounge
    { id: 'T-19', num: 19, name: 'طاولة 19 - كبار الزوار', zone: 'VIP Lounge', cap: 8 },
    { id: 'T-20', num: 20, name: 'طاولة 20 - كبار الزوار', zone: 'VIP Lounge', cap: 8 },
    // Special Custom VIP Table 99
    { id: 'T-99', num: 99, name: 'طاولة 99 - صالة كبار الشخصيات VIP', zone: 'VIP Lounge', cap: 12 }
  ];

  for (const t of tables) {
    await execSql(db, `
      INSERT OR REPLACE INTO v3_tables (
        id, branch_id, table_number, display_name, custom_name, zone, capacity, status, version
      ) VALUES (?, 'BR_DEFAULT', ?, ?, ?, ?, ?, 'AVAILABLE', 1)
    `, [t.id, t.num, t.name, t.name, t.zone, t.cap]);

    // Also populate legacy tables table
    await execSql(db, `
      INSERT OR REPLACE INTO tables (
        id, table_number, zone, capacity, custom_name, status, guest_count
      ) VALUES (?, ?, ?, ?, ?, 'VACANT', 0)
    `, [t.num, t.num, t.zone, t.cap, t.name]);
  }

  // H. Morning & Night Shifts
  const today = new Date().toISOString().split('T')[0];
  await execSql(db, `
    INSERT OR REPLACE INTO v3_shifts (
      id, venue_id, business_date, timezone, shift_type, status, opened_by, opened_at, opening_float_minor, version
    ) VALUES 
    ('SHIFT-MORN-20260823', 'V_DEFAULT', '${today}', 'Africa/Cairo', 'MORNING', 'OPEN', '4', '${today} 08:00:00', 50000, 1),
    ('SHIFT-NIGHT-20260823', 'V_DEFAULT', '${today}', 'Africa/Cairo', 'NIGHT', 'PLANNED', NULL, NULL, 50000, 1);

    -- Legacy shift table
    INSERT OR REPLACE INTO shifts (
      id, user_id, user_name, role, shift_type, clock_in, status
    ) VALUES 
    (1, 4, 'أحمد كركر (كاشير رئيسي)', 'OP_ASSISTANT_CASHIER', 'MORNING', '${today} 08:00:00', 'ACTIVE');
  `);

  // I. Expense Categories, Vendors & Expenses
  await execSql(db, `
    INSERT OR REPLACE INTO expense_categories (id, venue_id, name, type) VALUES
    ('CAT-EXP-1', 'V_DEFAULT', 'كهرباء ومياه وغاز', 'UTILITIES'),
    ('CAT-EXP-2', 'V_DEFAULT', 'مصروفات تشغيلية ونثريات', 'OPERATIONAL'),
    ('CAT-EXP-3', 'V_DEFAULT', 'اتصالات وإنترنت', 'COMMUNICATIONS');

    INSERT OR REPLACE INTO expenses (
      id, venue_id, vendor_id, category_id, amount_minor, currency, status, created_by, approved_by
    ) VALUES 
    ('EXP-001', 'V_DEFAULT', 'VEND-1', 'CAT-EXP-1', 120000, 'EGP', 'APPROVED', '3', '2'),
    ('EXP-002', 'V_DEFAULT', 'VEND-2', 'CAT-EXP-1', 35000, 'EGP', 'APPROVED', '3', '2'),
    ('EXP-003', 'V_DEFAULT', 'VEND-3', 'CAT-EXP-2', 5000, 'EGP', 'APPROVED', '3', '3'),
    ('EXP-004', 'V_DEFAULT', 'VEND-1', 'CAT-EXP-3', 40000, 'EGP', 'APPROVED', '3', '2');

    INSERT OR REPLACE INTO daily_expenses (
      id, description, amount, payment_source, created_by, expense_date
    ) VALUES 
    (1, 'فاتورة كهرباء شهر أغسطس 2026', 1200.00, 'BANK', 3, '${today}'),
    (2, 'فاتورة مياه الشرب والصرف', 350.00, 'BANK', 3, '${today}'),
    (3, 'شراء أكياس ثلج إضافية للمشروبات الباردة', 50.00, 'DRAWER', 3, '${today}'),
    (4, 'اشتراك الإنترنت وباقة خطوط الدفع الإلكتروني', 400.00, 'BANK', 3, '${today}');
  `);

  // J. Deterministic Customers & Reservations
  await execSql(db, `
    INSERT OR REPLACE INTO customers (phone, name, email, points, total_spent, credit_balance, visit_count)
    VALUES 
    ('01001234567', 'أستاذ أحمد المنشاوي', 'ahmed.minshawi@gmail.com', 250, 4500.00, 0, 15),
    ('01119876543', 'د. محمود عبد الرحيم', 'dr.mahmoud@gmail.com', 120, 2100.00, 0, 8),
    ('01223456789', 'م. سارة كمال', 'sara.kamal@gmail.com', 80, 1400.00, 0, 5);

    INSERT OR REPLACE INTO reservations (
      id, customer_name, customer_phone, table_number, guest_count, reservation_date, reservation_time, status, notes
    ) VALUES 
    (1, 'أستاذ أحمد المنشاوي', '01001234567', 99, 6, '${today}', '14:00:00', 'CONFIRMED', 'طاولة كبار الزوار VIP - غداء عمل واجتماع'),
    (2, 'د. محمود عبد الرحيم', '01119876543', 1, 2, '${today}', '19:30:00', 'CONFIRMED', 'طاولة هادئة لشخصين - عشاء');
  `);

  await closeFixtureDb(db);
  if (targetDir === ROOT_FIXTURES_DIR) {
    fs.copyFileSync(dbPath, path.join(FIXTURES_DIR, 'full_day_fixture.db'));
  }
  return { name: path.basename(dbPath), path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 6. Demo Normal Fixture (fixtures/demo-normal.sqlite)
 */
async function generateDemoNormalFixture(targetDir = ROOT_FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'demo-normal.sqlite');
  logger.info('Generating Demo Normal Fixture...', { dbPath });
  const res = await generateFullDayFixture(targetDir, 'demo-normal.sqlite');
  return { name: 'demo-normal.sqlite', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * 7. Demo Low Stock Fixture (fixtures/demo-low-stock.sqlite)
 */
async function generateDemoLowStockFixture(targetDir = ROOT_FIXTURES_DIR) {
  const dbPath = path.join(targetDir, 'demo-low-stock.sqlite');
  logger.info('Generating Demo Low Stock Fixture...', { dbPath });
  
  // Base off full day fixture
  await generateFullDayFixture(targetDir, 'demo-low-stock.sqlite');

  // Open and reduce stock for key raw materials below reorder thresholds
  const db = new sqlite3.Database(dbPath);
  await execSql(db, `
    -- Lower Milk (reorder: 5000ml) to 1200ml (1200000000 micro)
    UPDATE inventory_items SET current_stock_microunits = 1200000000 WHERE id = 2;

    -- Lower Espresso Beans (reorder: 2000g) to 300g (300000000 micro)
    UPDATE inventory_items SET current_stock_microunits = 300000000 WHERE id = 1;

    -- Lower Shisha Tobacco (reorder: 1000g) to 200g (200000000 micro)
    UPDATE inventory_items SET current_stock_microunits = 200000000 WHERE id = 5;
  `);
  await closeFixtureDb(db);

  return { name: 'demo-low-stock.sqlite', path: dbPath, checksum: getFileSha256(dbPath) };
}

/**
 * Generate All Fixtures and write Manifest
 */
async function generateAllFixtures() {
  if (!fs.existsSync(ROOT_FIXTURES_DIR)) {
    fs.mkdirSync(ROOT_FIXTURES_DIR, { recursive: true });
  }
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  const artifactsDir = path.dirname(MANIFEST_PATH);
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  logger.info('=== Starting Deterministic Fixture Generation ===');
  const clean = await generateCleanFixture(ROOT_FIXTURES_DIR);
  const demoNormal = await generateDemoNormalFixture(ROOT_FIXTURES_DIR);
  const demoLowStock = await generateDemoLowStockFixture(ROOT_FIXTURES_DIR);
  const concurrency = await generateConcurrencyFixture(ROOT_FIXTURES_DIR);
  const offline = await generateOfflineFixture(ROOT_FIXTURES_DIR);
  const legacy = await generateLegacyFixture(FIXTURES_DIR);
  const fullDay = await generateFullDayFixture(FIXTURES_DIR);

  const manifest = {
    generatedAt: new Date().toISOString(),
    generatorVersion: '2.0.0-enterprise',
    isolationEnforced: true,
    productionDatabaseProtected: 'cafe.db',
    fixtures: [
      clean,
      demoNormal,
      demoLowStock,
      concurrency,
      offline,
      legacy,
      fullDay
    ]
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  logger.info('=== Fixture Generation Complete. Manifest Saved. ===', { manifestPath: MANIFEST_PATH });
  return manifest;
}

if (require.main === module) {
  generateAllFixtures()
    .then((m) => {
      console.log('Successfully generated all fixtures:');
      console.log(JSON.stringify(m, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fixture generation failed:', err);
      process.exit(1);
    });
}

module.exports = {
  generateAllFixtures,
  generateCleanFixture,
  generateDemoNormalFixture,
  generateDemoLowStockFixture,
  generateLegacyFixture,
  generateConcurrencyFixture,
  generateOfflineFixture,
  generateFullDayFixture,
  ROOT_FIXTURES_DIR,
  FIXTURES_DIR,
  MANIFEST_PATH
};
