const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { runMigrations } = require('../src/db/migrator');
const { hashPin } = require('../src/domain/auth/service');

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function openDb(dbPath) {
  if (fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch (e) {}
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      resolve(db);
    });
  });
}

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

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

const ROLES = [
  { id: 'SUPER_ADMIN', name: 'SUPER_ADMIN', pin: '8801', name_ar: 'مسؤول النظام' },
  { id: 'OWNER', name: 'OWNER', pin: '8802', altPin: '1009', name_ar: 'فاطمة (مالك)' },
  { id: 'OP_MANAGER', name: 'OP_MANAGER', pin: '8803', altPin: '1008', name_ar: 'وائل (مدير عمليات)' },
  { id: 'OP_ASSISTANT_CASHIER', name: 'OP_ASSISTANT_CASHIER', pin: '8804', altPin: '1007', name_ar: 'أحمد كركر (كاشير)' },
  { id: 'BARISTA', name: 'BARISTA', pin: '8805', altPin: '1002', name_ar: 'هاجر (باريستا)' },
  { id: 'CHEF', name: 'CHEF', pin: '8806', name_ar: 'الشيف حسام' },
  { id: 'SHISHA', name: 'SHISHA', pin: '8807', name_ar: 'معد الشيشة' },
  { id: 'WAITER', name: 'WAITER', pin: '8808', name_ar: 'ويتر الصالة' },
  { id: 'RUNNER', name: 'RUNNER', pin: '8809', name_ar: 'رانر التوصيل' },
  { id: 'HALL_MANAGER', name: 'HALL_MANAGER', pin: '8810', name_ar: 'مدير الصالة' },
  { id: 'INVENTORY_SPECIALIST', name: 'INVENTORY_SPECIALIST', pin: '8811', name_ar: 'أخصائي المخزون' },
  { id: 'HR_PAYROLL', name: 'HR_PAYROLL', pin: '8812', name_ar: 'مسؤول الموارد البشرية' },
  { id: 'QA_AUDITOR', name: 'QA_AUDITOR', pin: '8813', name_ar: 'مراقب الجودة والشكاوى' },
  { id: 'READ_ONLY', name: 'READ_ONLY', pin: '8814', name_ar: 'مدقق خارجي (قراءة فقط)' },
  { id: 'SHAREHOLDER_INVESTOR', name: 'SHAREHOLDER_INVESTOR', pin: '8815', name_ar: 'شريك مستثمر' },
  { id: 'ACCOUNTANT_CONTROLLER', name: 'ACCOUNTANT_CONTROLLER', pin: '8816', name_ar: 'المحاسب المالي' }
];

async function seedRolesAndUsers(db) {
  for (const r of ROLES) {
    await execSql(db, `INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [r.id, r.name]);
    await execSql(db, `INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, ['R_' + r.id, r.name]);

    const hashedPin = await hashPin(r.pin);
    const userId = `U_${r.id}`;
    await execSql(db, `
      INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
      VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)
    `, [userId, r.name_ar, r.id, hashedPin]);

    await execSql(db, `
      INSERT INTO users (name, role, pin_hash, is_active)
      VALUES (?, ?, ?, 1)
    `, [r.name_ar, r.id, hashedPin]);

    if (r.altPin) {
      const altHashed = await hashPin(r.altPin);
      const altUserId = `U_ALT_${r.id}`;
      await execSql(db, `
        INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
        VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)
      `, [altUserId, r.name_ar, r.id, altHashed]);
      await execSql(db, `
        INSERT INTO users (name, role, pin_hash, is_active)
        VALUES (?, ?, ?, 1)
      `, [r.name_ar, r.id, altHashed]);
    }
  }
}

async function createCleanLiveFixture() {
  const dbPath = path.join(FIXTURES_DIR, 'qa-clean-live.sqlite');
  const db = await openDb(dbPath);
  await runMigrations(db);

  await execSql(db, `
    INSERT OR REPLACE INTO venues (id, name, legal_name, name_ar, name_en, tax_registration_number, address, contact_phone, locale, currency)
    VALUES ('V_DEFAULT', 'كافيه تجريبي جديد', 'شركة تجريبية', 'كافيه تجريبي جديد', 'New Cafe', '', '', '', 'ar', 'EGP');

    INSERT OR REPLACE INTO branches (id, venue_id, name, status)
    VALUES ('BR_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي', 'ACTIVE');
  `);

  await seedRolesAndUsers(db);

  await execSql(db, `
    INSERT OR REPLACE INTO v3_policies (id, venue_id, version, effective_from, payload, created_by)
    VALUES ('POL_CLEAN_1', 'V_DEFAULT', 1, datetime('now', 'localtime'), '{"currency":"EGP","vat_percent":14,"service_percent":12,"apply_taxes":true}', 'U_SUPER_ADMIN');

    INSERT OR REPLACE INTO onboarding_progress (id, current_step, completed_steps, draft_payload, mode)
    VALUES ('WIZARD_DEFAULT', 1, '[]', '{"mode":"LIVE"}', 'ONBOARDING');
  `);

  await closeDb(db);
  return { name: 'qa-clean-live.sqlite', path: dbPath, sha256: getFileSha256(dbPath) };
}

async function createDemoFixture() {
  const dbPath = path.join(FIXTURES_DIR, 'qa-demo.sqlite');
  const db = await openDb(dbPath);
  await runMigrations(db);

  await execSql(db, `
    INSERT OR REPLACE INTO venues (id, name, legal_name, name_ar, name_en, tax_registration_number, address, contact_phone, locale, currency)
    VALUES ('V_DEFAULT', 'كافيه مزاج التجريبي (DEMO)', 'شركة كافيه مزاج ذ.م.م', 'كافيه مزاج التجريبي', 'Mazag Demo Cafe', '300-999-888', 'شارع 9 المعادي', '01099887766', 'ar', 'EGP');

    INSERT OR REPLACE INTO branches (id, venue_id, name, status)
    VALUES ('BR_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي (DEMO)', 'ACTIVE');
  `);

  await seedRolesAndUsers(db);

  await execSql(db, `
    INSERT OR REPLACE INTO v3_policies (id, venue_id, version, effective_from, payload, created_by)
    VALUES ('POL_DEMO_1', 'V_DEFAULT', 1, datetime('now', 'localtime'), '{"currency":"EGP","vat_percent":14,"service_percent":12,"apply_taxes":true}', 'U_SUPER_ADMIN');

    INSERT OR REPLACE INTO onboarding_progress (id, current_step, completed_steps, draft_payload, mode, completed_at)
    VALUES ('WIZARD_DEFAULT', 7, '[1,2,3,4,5,6,7]', '{"mode":"DEMO"}', 'DEMO', datetime('now', 'localtime'));

    INSERT OR IGNORE INTO menu_categories (id, name, name_en, sort_order, is_active) VALUES
    (1, 'مشروبات ساخنة', 'Hot Beverages', 1, 1),
    (2, 'مشروبات باردة', 'Cold Beverages', 2, 1),
    (3, 'مأكولات وخفايف', 'Food & Snacks', 3, 1),
    (4, 'حلويات', 'Desserts', 4, 1),
    (5, 'شيشة', 'Hookah', 5, 1);

    INSERT OR IGNORE INTO menu_items (id, category_id, name, name_en, department, is_available, lifecycle_state) VALUES
    (1, 1, 'إسبريسو سينجل', 'Single Espresso', 'BARISTA', 1, 'PUBLISHED'),
    (2, 1, 'كابتشينو إيطالي', 'Italian Cappuccino', 'BARISTA', 1, 'PUBLISHED'),
    (3, 2, 'أيس لاتيه كراميل', 'Iced Caramel Latte', 'BARISTA', 1, 'PUBLISHED'),
    (4, 3, 'كلوب ساندوتش دجاج', 'Chicken Club Sandwich', 'KITCHEN', 1, 'PUBLISHED'),
    (5, 4, 'كريم بروليه فاخر', 'Creme Brulee', 'KITCHEN', 1, 'PUBLISHED'),
    (6, 5, 'شيشة تفاحتين فاخر', 'Double Apple Shisha', 'SHISHA', 1, 'PUBLISHED');

    INSERT OR IGNORE INTO menu_prices (id, menu_item_id, amount_minor, currency, valid_from) VALUES
    (1, 1, 3500, 'EGP', '2026-01-01'),
    (2, 2, 5000, 'EGP', '2026-01-01'),
    (3, 3, 6000, 'EGP', '2026-01-01'),
    (4, 4, 12000, 'EGP', '2026-01-01'),
    (5, 5, 4500, 'EGP', '2026-01-01'),
    (6, 6, 8000, 'EGP', '2026-01-01');

    INSERT OR IGNORE INTO inventory_items (id, name, category, unit, cost_per_unit_minor, min_limit, current_stock_microunits, is_active) VALUES
    (1, 'حبوب إسبريسو برازيلي', 'BARISTA', 'g', 60, 1000, 5000000000, 1),
    (2, 'حليب طازج كامل الدسم', 'BARISTA', 'ml', 4, 5000, 20000000000, 1),
    (3, 'خبز توست أبيض', 'KITCHEN', 'pcs', 200, 20, 100000000, 1),
    (4, 'صدور دجاج متبلة', 'KITCHEN', 'g', 25, 2000, 8000000000, 1),
    (5, 'معسل تفاحتين نخلة', 'SHISHA', 'g', 40, 500, 3000000000, 1),
    (6, 'أكواب ورقية دبل 12 أونص', 'BARISTA', 'pcs', 150, 100, 500000000, 1);

    INSERT OR IGNORE INTO tables (id, table_number, zone, capacity, status) VALUES
    (1, 1, 'INDOOR_1', 4, 'VACANT'),
    (2, 2, 'INDOOR_1', 4, 'VACANT'),
    (3, 3, 'INDOOR_1', 2, 'VACANT'),
    (4, 4, 'OUTDOOR_1', 6, 'VACANT'),
    (5, 5, 'OUTDOOR_1', 4, 'VACANT');
  `);

  await closeDb(db);
  return { name: 'qa-demo.sqlite', path: dbPath, sha256: getFileSha256(dbPath) };
}

async function createAuthFixture() {
  const dbPath = path.join(FIXTURES_DIR, 'qa-auth.sqlite');
  const db = await openDb(dbPath);
  await runMigrations(db);

  await execSql(db, `
    INSERT OR REPLACE INTO venues (id, name, legal_name, name_ar, name_en, tax_registration_number, address, contact_phone, locale, currency)
    VALUES ('V_DEFAULT', 'كافيه بوابة التحقق (AUTH_GATE)', 'شركة اختبار المصادقة', 'كافيه بوابة التحقق', 'Auth Gate Cafe', '300-111-222', 'المعادي', '0100000000', 'ar', 'EGP');

    INSERT OR REPLACE INTO branches (id, venue_id, name, status)
    VALUES ('BR_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي', 'ACTIVE');
  `);

  await seedRolesAndUsers(db);
  await closeDb(db);
  return { name: 'qa-auth.sqlite', path: dbPath, sha256: getFileSha256(dbPath) };
}

async function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log('Generating QA Fixtures...');
  const cleanLive = await createCleanLiveFixture();
  const demo = await createDemoFixture();
  const auth = await createAuthFixture();

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'generate_release_gate_fixtures.js',
    fixtures: [cleanLive, demo, auth],
    roles: ROLES.map(r => ({ role: r.id, primaryPin: r.pin, altPin: r.altPin || null, name: r.name_ar }))
  };

  const manifestPath = path.join(FIXTURES_DIR, 'qa-fixture-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('QA Fixtures Generated Successfully:');
  console.log(JSON.stringify(manifest, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  createCleanLiveFixture,
  createDemoFixture,
  createAuthFixture,
  ROLES
};
