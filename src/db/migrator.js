/**
 * Versioned Database Migration Engine
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, runQuery, getQuery, allQuery } = require('./connection');
const { runTransaction } = require('./transaction');
const logger = require('../observability/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function getFileChecksum(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

async function initMigrationTable(db = null) {
  const sql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      status TEXT NOT NULL DEFAULT 'SUCCESS'
    )
  `;
  await runQuery(sql, [], db);
}

async function ensureTableColumn(db, table, column, definition) {
  try {
    const tableExists = await getQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table], db);
    if (!tableExists) return;
    const columns = await allQuery(`PRAGMA table_info(${table})`, [], db);
    const hasCol = columns.some(c => c.name.toLowerCase() === column.toLowerCase());
    if (!hasCol) {
      await runQuery(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, [], db);
    }
  } catch (e) {
    logger.warn(`Notice during column check for ${table}.${column}:`, { error: e.message });
  }
}

async function runMigrations(customDb = null) {
  const db = customDb || getDb();
  await initMigrationTable(db);

  // Harmonize known legacy tables before running versioned migrations
  await ensureTableColumn(db, 'users', 'pin_hash', 'TEXT');
  await ensureTableColumn(db, 'users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  await ensureTableColumn(db, 'users', 'hourly_rate', 'REAL NOT NULL DEFAULT 0');
  await ensureTableColumn(db, 'users', 'department', 'TEXT');
  await ensureTableColumn(db, 'daily_expenses', 'expense_date', 'TEXT');
  await runQuery(`UPDATE daily_expenses SET expense_date = date(created_at) WHERE expense_date IS NULL`, [], db).catch(() => {});
  await ensureTableColumn(db, 'customers', 'credit_balance', 'REAL NOT NULL DEFAULT 0');
  await ensureTableColumn(db, 'tables', 'guest_count', 'INTEGER NOT NULL DEFAULT 2');
  await ensureTableColumn(db, 'tables', 'custom_name', 'TEXT');
  await ensureTableColumn(db, 'tables', 'customer_name', 'TEXT');
  await ensureTableColumn(db, 'tables', 'customer_phone', 'TEXT');
  await ensureTableColumn(db, 'tables', 'seated_at', 'TEXT');
  await ensureTableColumn(db, 'tables', 'first_ordered_at', 'TEXT');
  await ensureTableColumn(db, 'tables', 'last_ordered_at', 'TEXT');
  await ensureTableColumn(db, 'tables', 'check_requested_at', 'TEXT');
  await ensureTableColumn(db, 'tables', 'paid_at', 'TEXT');
  await ensureTableColumn(db, 'tables', 'vacated_at', 'TEXT');
  await ensureTableColumn(db, 'table_sessions', 'guest_count', 'INTEGER NOT NULL DEFAULT 2');
  await ensureTableColumn(db, 'order_payments', 'total_amount', 'REAL DEFAULT 0');
  await ensureTableColumn(db, 'order_payments', 'currency', "TEXT DEFAULT 'ج.م'");
  await ensureTableColumn(db, 'employee_advances', 'employee_id', 'INTEGER');
  await ensureTableColumn(db, 'order_sessions', 'table_id', 'INTEGER');
  await ensureTableColumn(db, 'order_sessions', 'customer_id', 'TEXT');
  await ensureTableColumn(db, 'order_sessions', 'public_ref', 'TEXT');
  await ensureTableColumn(db, 'order_sessions', 'order_type', "TEXT DEFAULT 'DINE_IN'");
  await ensureTableColumn(db, 'order_sessions', 'currency', "TEXT DEFAULT 'ج.م'");
  await ensureTableColumn(db, 'order_sessions', 'subtotal_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'service_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'tax_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'discount_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'tip_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'total_minor', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'version', 'INTEGER DEFAULT 0');
  await ensureTableColumn(db, 'order_sessions', 'created_by', 'INTEGER');
  await ensureTableColumn(db, 'shifts', 'user_name', 'TEXT');
  await ensureTableColumn(db, 'shifts', 'role', 'TEXT');
  await ensureTableColumn(db, 'shifts', 'shift_type', "TEXT DEFAULT 'MORNING'");
  await ensureTableColumn(db, 'shifts', 'status', "TEXT DEFAULT 'ACTIVE'");

  const appliedRows = await allQuery(`SELECT version, checksum FROM schema_migrations WHERE status = 'SUCCESS'`, [], db);
  const appliedMap = new Map(appliedRows.map(r => [r.version, r.checksum]));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const migrationResults = [];

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const checksum = getFileChecksum(content);
    const version = file;

    if (appliedMap.has(version)) {
      const existingChecksum = appliedMap.get(version);
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${version}! Expected ${existingChecksum}, got ${checksum}. Migration history has been altered.`);
      }
      continue;
    }

    logger.info(`Applying migration: ${version}`);
    const startTime = Date.now();

    // Execute migration SQL inside transaction
    await runTransaction(async (tx) => {
      // Split statements by semicolon, ignoring inside comments
      const cleanSql = content
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of cleanSql) {
        await tx.run(statement);
      }

      const duration = Date.now() - startTime;
      await tx.run(
        `INSERT INTO schema_migrations (version, checksum, execution_time_ms, status) VALUES (?, ?, ?, 'SUCCESS')`,
        [version, checksum, duration]
      );
      migrationResults.push({ version, duration, status: 'SUCCESS' });
    }, db);

    logger.info(`Successfully applied migration: ${version} in ${Date.now() - startTime}ms`);
  }

  // Run legacy data migration & synchronization adapter if needed
  await migrateLegacyDataIfPresent(db);

  return migrationResults;
}

/**
 * Safely migrate legacy tables (inventory, recipes, users plaintext PINs, old orders, etc.)
 */
async function migrateLegacyDataIfPresent(customDb = null) {
  const db = customDb || getDb();
  const bcrypt = require('bcryptjs');

  // 1. Migrate legacy inventory to canonical inventory_items
  const legacyInventoryExists = await getQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='inventory'`, [], db);
  if (legacyInventoryExists) {
    const legacyInv = await allQuery(`SELECT * FROM inventory`, [], db);
    for (const inv of legacyInv) {
      const stockMicro = Math.round((Number(inv.current_stock) || 0) * 1000000);
      const costMinor = Math.round((Number(inv.unit_cost) || 0) * 100);
      const minLimit = Number(inv.min_stock_level) || 5;
      await runQuery(
        `INSERT INTO inventory_items (id, name, category, unit, min_limit, cost_per_unit_minor, current_stock_microunits)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           unit = excluded.unit,
           min_limit = excluded.min_limit,
           current_stock_microunits = excluded.current_stock_microunits`,
        [inv.id, inv.name, inv.department || 'GENERAL', inv.unit || 'g', minLimit, costMinor, stockMicro],
        db
      );
    }
  }

  // 2. Check if legacy users have plaintext PINs that need hashing
  const users = await allQuery(`SELECT id, name, role, pin_hash, pin_code FROM users`, [], db).catch(() => []);
  if (users.length > 0) {
    for (const u of users) {
      if (u.pin_code && (!u.pin_hash || !u.pin_hash.startsWith('$2'))) {
        const hash = await bcrypt.hash(String(u.pin_code).trim(), 10);
        await runQuery(`UPDATE users SET pin_hash = ? WHERE id = ?`, [hash, u.id], db);
      }
    }
  }

  // 3. Check if legacy `recipes` table exists and migrate into canonical catalog
  const legacyRecipesExists = await getQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'`, [], db);
  if (legacyRecipesExists) {
    const legacyRecipes = await allQuery(`SELECT * FROM recipes`, [], db);
    
    // Group recipe rows by unique menu_item_name
    const itemsMap = new Map();
    for (const r of legacyRecipes) {
      const itemName = r.menu_item_name || r.item_name || r.name;
      if (!itemName) continue;
      if (!itemsMap.has(itemName)) {
        itemsMap.set(itemName, []);
      }
      itemsMap.get(itemName).push(r);
    }

    for (const [itemName, rows] of itemsMap.entries()) {
      const first = rows[0];
      const catName = first.category || 'مشروبات عامة';
      let cat = await getQuery(`SELECT id FROM menu_categories WHERE name = ?`, [catName], db);
      if (!cat) {
        const catRes = await runQuery(`INSERT INTO menu_categories (name, icon) VALUES (?, '☕')`, [catName], db);
        cat = { id: catRes.lastID };
      }

      let item = await getQuery(`SELECT id FROM menu_items WHERE name = ?`, [itemName], db);
      if (!item) {
        const dept = (catName.includes('شيشة') || catName.includes('SHISHA')) ? 'SHISHA' 
          : (catName.includes('مطبخ') || catName.includes('KITCHEN') || catName.includes('طعام')) ? 'KITCHEN' 
          : 'BARISTA';
        const itemRes = await runQuery(
          `INSERT INTO menu_items (category_id, name, department, is_available) VALUES (?, ?, ?, 1)`,
          [cat.id, itemName, dept],
          db
        );
        item = { id: itemRes.lastID };

        // Insert active price in minor units
        const priceMinor = Math.round((Number(first.price) || 0) * 100);
        await runQuery(`INSERT INTO menu_prices (menu_item_id, amount_minor, currency) VALUES (?, ?, 'ج.م')`, [item.id, priceMinor], db);

        // Insert recipe version
        const tolBasisPoints = Math.round((Number(first.tolerance_percent) || 0) * 100);
        const rVer = await runQuery(
          `INSERT INTO recipe_versions (menu_item_id, version, instructions, tolerance_basis, tolerance_percent_basis_points) VALUES (?, 1, ?, 'PERCENT', ?)`,
          [item.id, first.instructions || '', tolBasisPoints],
          db
        );

        // Insert ingredients
        for (const row of rows) {
          if (row.inventory_id && row.quantity_required) {
            const qtyMicro = Math.round((Number(row.quantity_required) || 0) * 1000000);
            const invItem = await getQuery(`SELECT id, unit FROM inventory_items WHERE id = ?`, [row.inventory_id], db);
            if (invItem) {
              await runQuery(
                `INSERT INTO recipe_ingredients (recipe_version_id, inventory_item_id, quantity_microunits, unit) VALUES (?, ?, ?, ?)`,
                [rVer.lastID, invItem.id, qtyMicro, invItem.unit || 'g'],
                db
              );
            }
          }
        }
      }
    }
  }

  // 3. Ensure system_config is initialized with default values if empty
  const configKeys = [
    ['cafe_name', 'كافيه مزاج'],
    ['currency', 'ج.م'],
    ['vat_percent', '14'],
    ['service_percent', '12'],
    ['apply_taxes', 'true'],
    ['printer_ip', '192.168.1.100'],
    ['printer_port', '9100'],
    ['cash_drawer_auto_kick', 'true'],
    ['header_note', 'أهلاً بكم في كافيه مزاج'],
    ['footer_note', 'شكراً لزيارتكم - نتمنى لكم يوماً سعيداً']
  ];

  for (const [k, v] of configKeys) {
    await runQuery(`INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)`, [k, v], db);
  }

  // 4. Ensure default tables 1-12 exist
  for (let i = 1; i <= 12; i++) {
    await runQuery(`INSERT OR IGNORE INTO tables (table_number, zone, capacity, status) VALUES (?, 'INDOOR_1', 4, 'VACANT')`, [i], db);
  }
}

module.exports = {
  runMigrations,
  initMigrationTable
};
