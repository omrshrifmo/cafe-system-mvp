const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file path
const dbPath = path.join(__dirname, 'cafe.db');

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error connecting to cafe.db:', err.message);
  } else {
    console.log('✅ Connected to SQLite database: cafe.db');
  }
});

// Enable foreign key support, WAL mode & high-concurrency memory cache in SQLite
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA cache_size = -20000');
  db.run('PRAGMA temp_store = MEMORY');
});

// Initialize database schema
db.serialize(() => {
  // Orders Table (With KDS State Machine & Waiter Customizations)
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      price REAL DEFAULT 0,
      table_number INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      waiter_id INTEGER,
      sugar_level TEXT,
      roast_type TEXT,
      kds_status TEXT DEFAULT 'PENDING',
      edit_request TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Ensure schema migrations for existing database columns
  db.run(`ALTER TABLE orders ADD COLUMN waiter_id INTEGER`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN sugar_level TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN roast_type TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN kds_status TEXT DEFAULT 'PENDING'`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN edit_request TEXT DEFAULT NULL`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN session_id INTEGER`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'DINE_IN'`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN item_notes TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN addons TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN variant TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN staff_user_id INTEGER`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN user_id INTEGER`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN user_name TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN shift_type TEXT DEFAULT 'MORNING'`, () => {});

  // System Configuration Table (Global dynamic taxation, hardware IP, currency)
  db.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, () => {
    const defaultConfig = [
      ['currency', 'ج.م'],
      ['vat_percent', '14'],
      ['service_percent', '12'],
      ['apply_taxes', 'true'],
      ['printer_ip', '192.168.1.100'],
      ['printer_port', '9100'],
      ['cafe_name', 'كافيه مزاج'],
      ['cash_drawer_auto_kick', 'true'],
      ['header_note', 'أهلاً بكم في كافيه مزاج'],
      ['footer_note', 'شكراً لزيارتكم - نتمنى لكم يوماً سعيداً']
    ];
    defaultConfig.forEach(([k, v]) => {
      db.run(`INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)`, [k, v]);
    });
  });

  // Order Payments Table (Split payment: CASH, INSTAPAY, WALLET, VISA, CREDIT, with Tips)
  db.run(`
    CREATE TABLE IF NOT EXISTS order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      method TEXT NOT NULL,
      amount REAL DEFAULT 0,
      tip_amount REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  // Performance Indexes for Database Scalability & Concurrency
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_kds_status ON orders(kds_status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON shifts(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_order_payments_created ON order_payments(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id)`);

  // Order Payments Tax Breakdown Column Migrations
  db.run(`ALTER TABLE order_payments ADD COLUMN subtotal REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE order_payments ADD COLUMN service_amount REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE order_payments ADD COLUMN vat_amount REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE order_payments ADD COLUMN discount_amount REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE order_payments ADD COLUMN total_amount REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE order_payments ADD COLUMN currency TEXT DEFAULT 'ج.م'`, () => {});

  // Universal Audit Logs Table
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target_table TEXT NOT NULL,
      record_id INTEGER,
      previous_value TEXT,
      new_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users Table (RBAC System)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      hourly_rate REAL DEFAULT 0
    )
  `);
  db.run(`ALTER TABLE users ADD COLUMN hourly_rate REAL DEFAULT 0`, () => {});

  // Safe migration: Detect legacy pin_code and migrate to bcrypt pin_hash
  db.all(`PRAGMA table_info(users)`, [], (err, cols) => {
    if (err || !cols) return;
    const colNames = cols.map(c => c.name);
    const hasPinCode = colNames.includes('pin_code');
    const hasPinHash = colNames.includes('pin_hash');

    if (hasPinCode) {
      if (!hasPinHash) {
        db.run(`ALTER TABLE users ADD COLUMN pin_hash TEXT`, (alterErr) => {
          if (!alterErr) migrateLegacyPins();
        });
      } else {
        migrateLegacyPins();
      }
    }
  });

  function migrateLegacyPins() {
    db.all(`SELECT id, pin_code, pin_hash FROM users`, [], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        try {
          db.run(`ALTER TABLE users DROP COLUMN pin_code`, () => {});
        } catch (e) {}
        return;
      }
      const stmt = db.prepare(`UPDATE users SET pin_hash = ? WHERE id = ?`);
      rows.forEach(r => {
        if (r.pin_code) {
          const isHash = r.pin_code.startsWith('$2a$') || r.pin_code.startsWith('$2b$');
          const hash = isHash ? r.pin_code : bcrypt.hashSync(String(r.pin_code).trim(), 10);
          stmt.run(hash, r.id);
        }
      });
      stmt.finalize(() => {
        try {
          db.run(`ALTER TABLE users DROP COLUMN pin_code`, () => {
            console.log('✅ Migrated legacy pin_code to bcrypt pin_hash and dropped plain-text column.');
          });
        } catch (e) {}
      });
    });
  }

  // Penalties Table (خصومات وجزاءات الموظفين)
  db.run(`
    CREATE TABLE IF NOT EXISTS penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL DEFAULT 0,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // QA Complaints Table (إدارة الجودة والشكاوى)
  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      logged_by_user_id INTEGER,
      against_user_id INTEGER,
      description TEXT NOT NULL,
      severity TEXT DEFAULT 'LOW',
      status TEXT DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(logged_by_user_id) REFERENCES users(id),
      FOREIGN KEY(against_user_id) REFERENCES users(id)
    )
  `);

  // Dynamic Tables Management Table (Custom Names, Customer Contacts, Lifecycle & Timestamps)
  db.run(`
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number INTEGER UNIQUE NOT NULL,
      custom_name TEXT DEFAULT NULL,
      customer_name TEXT DEFAULT NULL,
      customer_phone TEXT DEFAULT NULL,
      status TEXT DEFAULT 'VACANT',
      seated_at DATETIME DEFAULT NULL,
      first_ordered_at DATETIME DEFAULT NULL,
      last_ordered_at DATETIME DEFAULT NULL,
      check_requested_at DATETIME DEFAULT NULL,
      paid_at DATETIME DEFAULT NULL,
      vacated_at DATETIME DEFAULT NULL
    )
  `, () => {
    // Seed default tables 1 to 12 if not existing with realistic zones
    const defaultZones = ['INDOOR_1', 'INDOOR_1', 'INDOOR_2', 'INDOOR_2', 'INDOOR_3', 'INDOOR_3', 'OUTDOOR_RIGHT', 'OUTDOOR_RIGHT', 'OUTDOOR_LEFT', 'OUTDOOR_LEFT', 'OUTDOOR_GATE', 'OUTDOOR_GATE'];
    for (let i = 1; i <= 12; i++) {
      const zone = defaultZones[i - 1] || 'INDOOR_1';
      db.run(`INSERT OR IGNORE INTO tables (table_number) VALUES (?)`, [i]);
      db.run(`UPDATE tables SET zone = COALESCE(zone, ?) WHERE table_number = ?`, [zone, i]);
    }
  });
  db.run(`ALTER TABLE tables ADD COLUMN zone TEXT DEFAULT 'INDOOR_1'`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN capacity INTEGER DEFAULT 4`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN customer_id INTEGER`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN waiter_approached_at DATETIME`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN reapproached_at DATETIME`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN reordered_at DATETIME`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN opened_at DATETIME`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN assigned_waiter_id INTEGER`, () => {});
  db.run(`ALTER TABLE tables ADD COLUMN opened_by_user_id INTEGER`, () => {});

  // Material Transfers (إعارة وتحويل خامات بين الأقسام)
  db.run(`
    CREATE TABLE IF NOT EXISTS material_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER,
      item_name TEXT NOT NULL,
      from_department TEXT NOT NULL,
      to_department TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      notes TEXT,
      transferred_by_user_id INTEGER,
      transferred_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Staff Allowances & Quotas (وجبات ومشروبات الموظفين)
  db.run(`
    CREATE TABLE IF NOT EXISTS staff_allowances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT UNIQUE,
      daily_drink_quota INTEGER DEFAULT 2,
      daily_meal_quota INTEGER DEFAULT 1,
      monthly_budget REAL DEFAULT 500
    )
  `, () => {
    db.run(`ALTER TABLE staff_allowances ADD COLUMN role TEXT`, () => {
      db.run(`ALTER TABLE staff_allowances ADD COLUMN daily_drink_quota INTEGER DEFAULT 2`, () => {
        db.run(`ALTER TABLE staff_allowances ADD COLUMN daily_meal_quota INTEGER DEFAULT 1`, () => {
          db.run(`ALTER TABLE staff_allowances ADD COLUMN monthly_budget REAL DEFAULT 500`, () => {
            const roles = [
              { role: 'BARISTA', drinks: 3, meals: 1 },
              { role: 'SHIASH', drinks: 3, meals: 1 },
              { role: 'CHEF', drinks: 2, meals: 2 },
              { role: 'WAITER', drinks: 2, meals: 1 },
              { role: 'OP_ASSISTANT_CASHIER', drinks: 2, meals: 1 },
              { role: 'OP_MANAGER', drinks: 4, meals: 2 },
              { role: 'HALL_MANAGER', drinks: 3, meals: 1 },
              { role: 'MANAGER', drinks: 4, meals: 2 },
              { role: 'OWNER', drinks: 10, meals: 5 },
              { role: 'ADMIN', drinks: 10, meals: 5 }
            ];
            roles.forEach(r => {
              db.run(`INSERT OR IGNORE INTO staff_allowances (role, daily_drink_quota, daily_meal_quota) VALUES (?, ?, ?)`, [r.role, r.drinks, r.meals], () => {});
            });
          });
        });
      });
    });
  });

  // Purchases Table (Inventory Restocking)
  db.run(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER,
      qty_added REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
    )
  `);
  db.run(`ALTER TABLE purchases ADD COLUMN supplier_id INTEGER`, () => {});
  db.run(`ALTER TABLE purchases ADD COLUMN invoice_ref TEXT`, () => {});
  db.run(`ALTER TABLE purchases ADD COLUMN notes TEXT`, () => {});

  // Suppliers Table (موردين)
  db.run(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Order Sessions Table (parent ticket grouping)
  db.run(`
    CREATE TABLE IF NOT EXISTS order_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_ref TEXT,
      order_type TEXT DEFAULT 'DINE_IN',
      table_number INTEGER DEFAULT 0,
      customer_phone TEXT,
      delivery_address TEXT,
      delivery_fee REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      discount_reason TEXT,
      tax_rate REAL DEFAULT 0,
      service_charge REAL DEFAULT 0,
      status TEXT DEFAULT 'OPEN',
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    )
  `);

  // Menu Categories Table
  db.run(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      name_en TEXT,
      icon TEXT DEFAULT '☕',
      color TEXT DEFAULT '#f59e0b',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `);

  // Menu Items Table (proper structured menu)
  db.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      name_en TEXT,
      description TEXT,
      base_price REAL DEFAULT 0,
      image_url TEXT,
      is_available INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      department TEXT DEFAULT 'BARISTA',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES menu_categories(id) ON DELETE SET NULL
    )
  `);

  // Item Variants Table (sizes, temperatures, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS item_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price_delta REAL DEFAULT 0,
      FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
    )
  `);

  // Item Addons Table (extras, modifiers)
  db.run(`
    CREATE TABLE IF NOT EXISTS item_addons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL DEFAULT 0,
      FOREIGN KEY(menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
    )
  `);

  // Customer Feedback Table
  db.run(`
    CREATE TABLE IF NOT EXISTS customer_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT,
      session_id INTEGER,
      rating INTEGER DEFAULT 5,
      comment TEXT,
      category TEXT DEFAULT 'GENERAL',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Reservations Table
  db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      table_number INTEGER,
      party_size INTEGER DEFAULT 2,
      reserved_at DATETIME NOT NULL,
      duration_minutes INTEGER DEFAULT 90,
      status TEXT DEFAULT 'CONFIRMED',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Shifts Table (Clock In / Clock Out)
  db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      role TEXT,
      clock_in DATETIME DEFAULT CURRENT_TIMESTAMP,
      clock_out DATETIME,
      status TEXT DEFAULT 'ACTIVE',
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  db.run(`ALTER TABLE shifts ADD COLUMN shift_type TEXT DEFAULT 'MORNING'`, () => {});

  // Drawer Declarations Table (Blind Cash Declaration)
  db.run(`
    CREATE TABLE IF NOT EXISTS drawer_declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      declared_amount REAL DEFAULT 0,
      expected_amount REAL DEFAULT 0,
      variance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN opening_float REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN cash_sales REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN cash_refunds REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN cash_advances REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN cash_expenses REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN shift_type TEXT DEFAULT 'MORNING'`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN status TEXT DEFAULT 'CLOSED'`, () => {});
  db.run(`ALTER TABLE drawer_declarations ADD COLUMN manager_approved_by INTEGER`, () => {});

  // Employee Advances Table (سُلف الموظفين)
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      employee_id INTEGER,
      amount REAL DEFAULT 0,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE employee_advances ADD COLUMN employee_id INTEGER`, () => {});
  db.run(`ALTER TABLE employee_advances ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, () => {});

  // Daily Expenses Table (مصروفات اليومية)
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL DEFAULT 0,
      payment_source TEXT DEFAULT 'DRAWER',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Customers Loyalty Table (نقاط ولاء العملاء)
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      name TEXT,
      points INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE customers ADD COLUMN visit_count INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE customers ADD COLUMN last_visit DATETIME`, () => {});
  db.run(`ALTER TABLE customers ADD COLUMN preferences TEXT`, () => {});
  db.run(`ALTER TABLE customers ADD COLUMN marketing_opt_in INTEGER DEFAULT 1`, () => {});
  db.run(`ALTER TABLE customers ADD COLUMN email TEXT`, () => {});

  // Shareholder Ledger Table (جاري الشركاء وحساب الأرباح)
  db.run(`
    CREATE TABLE IF NOT EXISTS shareholder_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_name TEXT NOT NULL,
      amount REAL DEFAULT 0,
      type TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table Sessions Table
  db.run(`
    CREATE TABLE IF NOT EXISTS table_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number INTEGER UNIQUE NOT NULL,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'OPEN'
    )
  `);

  // Waste Log Table
  db.run(`
    CREATE TABLE IF NOT EXISTS waste_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER,
      item_name TEXT NOT NULL,
      quantity REAL DEFAULT 0,
      reason TEXT,
      department TEXT DEFAULT 'BARISTA',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
    )
  `);

  // Inventory Table / View (BOM Raw Materials Canonical Bridge)
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      current_stock REAL DEFAULT 0,
      unit TEXT NOT NULL,
      department TEXT DEFAULT 'BARISTA'
    )
  `);
  db.run(`ALTER TABLE inventory ADD COLUMN min_stock_level REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE inventory ADD COLUMN unit_cost REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE inventory ADD COLUMN supplier_id INTEGER`, () => {});

  // Create authoritative view bridge if inventory_items exists
  db.run(`
    CREATE VIEW IF NOT EXISTS inventory_v_bridge AS
    SELECT id, name, category as department, unit,
           (current_stock_microunits / 1000000.0) as current_stock,
           min_limit as min_stock_level,
           (cost_per_unit_minor / 100.0) as unit_cost,
           default_supplier_id as supplier_id
    FROM inventory_items
  `, () => {});

  // Recipes Table (BOM Relationships)
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_name TEXT NOT NULL,
      inventory_id INTEGER,
      quantity_required REAL DEFAULT 0,
      category TEXT DEFAULT 'BARISTA',
      price REAL DEFAULT 0,
      FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
    )
  `, () => {
    migrateDatabaseSchema();
  });
  db.run(`ALTER TABLE recipes ADD COLUMN instructions TEXT`, () => {});
  db.run(`ALTER TABLE recipes ADD COLUMN tolerance_percent REAL DEFAULT 5.0`, () => {});
});

/**
 * Migrate database schema to add missing columns
 */
function migrateDatabaseSchema() {
  // Check and migrate tip_amount column in order_payments
  db.all(`PRAGMA table_info(order_payments)`, [], (err, columns) => {
    if (!err && columns) {
      const hasTip = columns.some(col => col.name === 'tip_amount');
      if (!hasTip) {
        db.run(`ALTER TABLE order_payments ADD COLUMN tip_amount REAL DEFAULT 0`, (err) => {
          if (err) console.error('❌ Error adding tip_amount column to order_payments:', err.message);
          else console.log('✅ Added tip_amount column to order_payments table.');
        });
      }
    }
  });

  db.all(`PRAGMA table_info(recipes)`, [], (err, columns) => {
    if (err) {
      console.error('❌ Error checking recipes schema:', err.message);
      migrateInventoryDepartment();
      return;
    }
    const hasCategory = columns && columns.some(col => col.name === 'category');
    const hasPrice = columns && columns.some(col => col.name === 'price');

    const updateRecipes = () => {
      if (!hasPrice) {
        db.run(`ALTER TABLE recipes ADD COLUMN price REAL DEFAULT 0`, (err) => {
          if (err) console.error('❌ Error adding price column to recipes:', err.message);
          else console.log('✅ Added price column to recipes table.');
          migrateOrdersPriceAndTable();
        });
      } else {
        migrateOrdersPriceAndTable();
      }
    };

    if (!hasCategory) {
      db.run(`ALTER TABLE recipes ADD COLUMN category TEXT DEFAULT 'BARISTA'`, (err) => {
        if (err) console.error('❌ Error adding category column to recipes:', err.message);
        else console.log('✅ Added category column to recipes table.');
        updateRecipes();
      });
    } else {
      updateRecipes();
    }
  });
}

function migrateOrdersPriceAndTable() {
  db.all(`PRAGMA table_info(orders)`, [], (err, columns) => {
    if (err) {
      console.error('❌ Error checking orders schema:', err.message);
      migrateInventoryDepartment();
      return;
    }
    const hasPrice = columns && columns.some(col => col.name === 'price');
    const hasTable = columns && columns.some(col => col.name === 'table_number');

    const checkTable = () => {
      if (!hasTable) {
        db.run(`ALTER TABLE orders ADD COLUMN table_number INTEGER DEFAULT 0`, (err) => {
          if (err) console.error('❌ Error adding table_number column to orders:', err.message);
          else console.log('✅ Added table_number column to orders table.');
          migrateInventoryDepartment();
        });
      } else {
        migrateInventoryDepartment();
      }
    };

    if (!hasPrice) {
      db.run(`ALTER TABLE orders ADD COLUMN price REAL DEFAULT 0`, (err) => {
        if (err) console.error('❌ Error adding price column to orders:', err.message);
        else console.log('✅ Added price column to orders table.');
        checkTable();
      });
    } else {
      checkTable();
    }
  });
}

function migrateInventoryDepartment() {
  db.all(`PRAGMA table_info(inventory)`, [], (err, columns) => {
    if (err) {
      console.error('❌ Error checking inventory schema:', err.message);
      updateDataAndSeed();
      return;
    }
    const hasDepartment = columns && columns.some(col => col.name === 'department');
    if (!hasDepartment) {
      db.run(`ALTER TABLE inventory ADD COLUMN department TEXT DEFAULT 'BARISTA'`, (err) => {
        if (err) console.error('❌ Error adding department column to inventory:', err.message);
        else console.log('✅ Added department column to inventory table.');
        updateDataAndSeed();
      });
    } else {
      updateDataAndSeed();
    }
  });
}

function updateDataAndSeed() {
  db.serialize(() => {
    // Update recipe categories & default prices
    db.run(`UPDATE recipes SET category = 'BARISTA', price = 50 WHERE menu_item_name = 'لاتيه'`);
    db.run(`UPDATE recipes SET category = 'BARISTA', price = 35 WHERE menu_item_name = 'اسبريسو'`);
    db.run(`UPDATE recipes SET category = 'SHISHA', price = 100 WHERE menu_item_name = 'شيشة تفاحتين'`);
    db.run(`UPDATE recipes SET category = 'KITCHEN', price = 120 WHERE menu_item_name = 'كلوب ساندوتش'`);

    // Update inventory departments
    db.run(`UPDATE inventory SET department = 'BARISTA' WHERE name IN ('حبوب قهوة', 'حليب', 'أكواب')`);
    db.run(`UPDATE inventory SET department = 'SHISHA' WHERE name = 'معسل تفاحتين'`);
    db.run(`UPDATE inventory SET department = 'KITCHEN' WHERE name IN ('خبز', 'دجاج')`);

    seedUsersIfEmpty();
    seedDatabaseIfEmpty();
  });
}

/**
 * Helper to fetch category for a given menu item name
 */
function getItemCategory(itemName) {
  return new Promise((resolve) => {
    const sql = `SELECT category FROM recipes WHERE menu_item_name = ? LIMIT 1`;
    db.get(sql, [itemName], (err, row) => {
      if (err || !row || !row.category) {
        if (itemName && itemName.includes('شيشة')) {
          return resolve('SHISHA');
        }
        if (itemName && (itemName.includes('كلوب') || itemName.includes('ساندوتش') || itemName.includes('دجاج') || itemName.includes('وجبة'))) {
          return resolve('KITCHEN');
        }
        return resolve('BARISTA');
      }
      resolve(row.category);
    });
  });
}

/**
 * Helper to fetch price for a given menu item name
 */
function getItemPrice(itemName) {
  return new Promise((resolve) => {
    const sql = `SELECT price FROM recipes WHERE menu_item_name = ? LIMIT 1`;
    db.get(sql, [itemName], (err, row) => {
      if (err || !row || row.price === undefined || row.price === null) {
        return resolve(0);
      }
      resolve(Number(row.price) || 0);
    });
  });
}

/**
 * Seed initial inventory items and recipes if missing
 */
function seedDatabaseIfEmpty() {
  db.serialize(() => {
    const insertInvSql = `INSERT OR IGNORE INTO inventory (name, current_stock, unit, department) VALUES (?, ?, ?, ?)`;
    const stmtInv = db.prepare(insertInvSql);
    stmtInv.run('حبوب قهوة', 5000, 'g', 'BARISTA');
    stmtInv.run('حليب', 10000, 'ml', 'BARISTA');
    stmtInv.run('أكواب', 500, 'pcs', 'BARISTA');
    stmtInv.run('معسل تفاحتين', 2000, 'g', 'SHISHA');
    stmtInv.run('خبز', 100, 'pcs', 'KITCHEN');
    stmtInv.run('دجاج', 5000, 'g', 'KITCHEN');
    stmtInv.finalize(() => {
      console.log('✅ Inventory items seeded/verified.');

      db.all(`SELECT id, name FROM inventory`, [], (err, items) => {
        if (err || !items) return;

        const itemMap = {};
        items.forEach(item => { itemMap[item.name] = item.id; });

        db.get(`SELECT COUNT(*) as count FROM recipes WHERE menu_item_name = 'كلوب ساندوتش'`, [], (err, row) => {
          if (!err && (!row || row.count === 0)) {
            const stmtRec = db.prepare(`INSERT INTO recipes (menu_item_name, inventory_id, quantity_required, category, price, instructions, tolerance_percent) VALUES (?, ?, ?, ?, ?, ?, 5.0)`);
            const sandwichInstructions = '1. تحميص شرائح خبز التوست على الجريل حتى تكتسب لوناً ذهبياً مقرمشاً.\n2. شواء 150 جرام صدر دجاج متبل مع شريحة جبن شيدر.\n3. ترتيب الخس والطماطم مع المايونيز وتقطيع الساندوتش مثلثات وتثبيتها بالأعواد وتقديمها مع البطاطس.';
            if (itemMap['خبز']) stmtRec.run('كلوب ساندوتش', itemMap['خبز'], 2, 'KITCHEN', 120, sandwichInstructions);
            if (itemMap['دجاج']) stmtRec.run('كلوب ساندوتش', itemMap['دجاج'], 150, 'KITCHEN', 120, sandwichInstructions);
            stmtRec.finalize(() => {
              console.log('✅ Kitchen recipes seeded successfully.');
            });
          }
        });

        db.get(`SELECT COUNT(*) as count FROM recipes WHERE menu_item_name = 'لاتيه'`, [], (err, row) => {
          if (!err && (!row || row.count === 0)) {
            const stmtRec = db.prepare(`INSERT INTO recipes (menu_item_name, inventory_id, quantity_required, category, price, instructions, tolerance_percent) VALUES (?, ?, ?, ?, ?, ?, 5.0)`);
            const latteInstructions = '1. استخلاص 36 مل شوت اسبريسو دبل.\n2. تبخير 200 مل حليب طازج على حرارة 65 مئوية برغوة حريرية ميكروفوم.\n3. صب الحليب ببطء مع رسم لاتي آرت.';
            const espressoInstructions = '1. طحن 18 جرام بن بدرجة نعومة متساوية.\n2. تسوية وكبس البن بقوة 15 كجم في البورتافلتر.\n3. استخلاص 36 مل خلال 25-30 ثانية على حرارة 92 مئوية وضغط 9 بار.';
            const shishaInstructions = '1. غسل وتنظيف قلب الشيشة والتأكد من مستوى الماء النقي.\n2. تهوية 25 جرام معسل تفاحتين وتوزيعه بالتساوي في الحجر الفخاري دون ضغط شديد.\n3. تغطية الحجر بالسلوفان وتثقيبه بالتساوي مع وضع 3 قطع فحم متوهج.';

            if (itemMap['حبوب قهوة']) stmtRec.run('لاتيه', itemMap['حبوب قهوة'], 18, 'BARISTA', 50, latteInstructions);
            if (itemMap['حليب']) stmtRec.run('لاتيه', itemMap['حليب'], 200, 'BARISTA', 50, latteInstructions);
            if (itemMap['أكواب']) stmtRec.run('لاتيه', itemMap['أكواب'], 1, 'BARISTA', 50, latteInstructions);

            if (itemMap['حبوب قهوة']) stmtRec.run('اسبريسو', itemMap['حبوب قهوة'], 18, 'BARISTA', 35, espressoInstructions);
            if (itemMap['أكواب']) stmtRec.run('اسبريسو', itemMap['أكواب'], 1, 'BARISTA', 35, espressoInstructions);

            if (itemMap['معسل تفاحتين']) stmtRec.run('شيشة تفاحتين', itemMap['معسل تفاحتين'], 25, 'SHISHA', 100, shishaInstructions);

            stmtRec.finalize();
          }
        });

        // Ensure instructions are updated for existing recipes
        db.run(`UPDATE recipes SET instructions = '1. استخلاص 36 مل شوت اسبريسو دبل.\n2. تبخير 200 مل حليب طازج على حرارة 65 مئوية برغوة حريرية ميكروفوم.\n3. صب الحليب ببطء مع رسم لاتي آرت.' WHERE menu_item_name = 'لاتيه' AND instructions IS NULL`);
        db.run(`UPDATE recipes SET instructions = '1. طحن 18 جرام بن بدرجة نعومة متساوية.\n2. تسوية وكبس البن بقوة 15 كجم في البورتافلتر.\n3. استخلاص 36 مل خلال 25-30 ثانية على حرارة 92 مئوية وضغط 9 بار.' WHERE menu_item_name = 'اسبريسو' AND instructions IS NULL`);
        db.run(`UPDATE recipes SET instructions = '1. غسل وتنظيف قلب الشيشة والتأكد من مستوى الماء النقي.\n2. تهوية 25 جرام معسل تفاحتين وتوزيعه بالتساوي في الحجر الفخاري دون ضغط شديد.\n3. تغطية الحجر بالسلوفان وتثقيبه بالتساوي مع وضع 3 قطع فحم متوهج.' WHERE menu_item_name = 'شيشة تفاحتين' AND instructions IS NULL`);
        db.run(`UPDATE recipes SET instructions = '1. تحميص شرائح خبز التوست على الجريل حتى تكتسب لوناً ذهبياً مقرمشاً.\n2. شواء 150 جرام صدر دجاج متبل مع شريحة جبن شيدر.\n3. ترتيب الخس والطماطم مع المايونيز وتقطيع الساندوتش مثلثات وتثبيتها بالأعواد وتقديمها مع البطاطس.' WHERE menu_item_name = 'كلوب ساندوتش' AND instructions IS NULL`);
        db.run(`UPDATE recipes SET tolerance_percent = 5.0 WHERE tolerance_percent IS NULL`);
      });
    });
  });
}

/**
 * Seed initial users and standard RBAC roles (Cafe Mazaj Production Staff & Universal Defaults)
 */
function seedUsersIfEmpty() {
  const staffList = [
    // Official Cafe Mazaj Staff PINs (1001 - 1012)
    ['أحمد (ويتر/جوكر)', 'WAITER', '1001'],
    ['هاجر بيبو (باريستا)', 'BARISTA', '1002'],
    ['أسماء (مسؤول شيشة)', 'SHISHA', '1003'],
    ['الشيف (شيف المطبخ)', 'CHEF', '1004'],
    ['أمل (ويتر)', 'WAITER', '1005'],
    ['إبراهيم (مدير صالة)', 'HALL_MANAGER', '1006'],
    ['أحمد كركر (كاشير)', 'OP_ASSISTANT_CASHIER', '1007'],
    ['وائل (مدير عمليات)', 'OP_MANAGER', '1008'],
    ['فاطمة (مالك)', 'OWNER', '1009'],
    ['وائل 2 (مالك)', 'OWNER', '1010'],
    ['عمر (مسؤول نظام)', 'SUPER_ADMIN', '1011'],
    ['شعراوي (مدير تكاليف BOM)', 'BOM_MANAGER', '1012'],
    // Universal Default PINs
    ['باريستا', 'BARISTA', '1111'],
    ['معد شيشة', 'SHIASH', '2222'],
    ['شيف المطبخ', 'CHEF', '3333'],
    ['ويتر الصالة', 'WAITER', '4444'],
    ['مدير الصالة', 'HALL_MANAGER', '4400'],
    ['مساعد كاشير', 'OP_ASSISTANT_CASHIER', '5555'],
    ['مدير العمليات', 'OP_MANAGER', '6666'],
    ['المالك', 'OWNER', '7777'],
    ['مسؤول النظام', 'ADMIN', '8888']
  ];

  db.serialize(() => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO users (name, role, pin_hash) VALUES (?, ?, ?)`);
    staffList.forEach(([name, role, pin]) => {
      const hash = bcrypt.hashSync(String(pin), 10);
      stmt.run(name, role, hash);
    });
    stmt.finalize(() => {
      console.log('✅ Users table seeded with Cafe Mazaj production staff and standard RBAC roles (bcrypt hashed).');
    });
  });
}

/**
 * Table Session Helpers
 */
function getOpenTableSessions() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT table_number, opened_at, status FROM table_sessions WHERE status = 'OPEN'`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function openTableSession(tableNumber) {
  return new Promise((resolve, reject) => {
    const tNum = parseInt(tableNumber, 10);
    const sql = `INSERT OR REPLACE INTO table_sessions (table_number, opened_at, status) VALUES (?, CURRENT_TIMESTAMP, 'OPEN')`;
    db.run(sql, [tNum], function (err) {
      if (err) return reject(err);
      db.get(`SELECT table_number, opened_at, status FROM table_sessions WHERE table_number = ?`, [tNum], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  });
}

function closeTableSession(tableNumber) {
  return new Promise((resolve, reject) => {
    const tNum = parseInt(tableNumber, 10);
    const sql = `UPDATE table_sessions SET status = 'CLOSED' WHERE table_number = ?`;
    db.run(sql, [tNum], function (err) {
      if (err) return reject(err);
      resolve({ table_number: tNum, status: 'CLOSED' });
    });
  });
}

function getTableOrders(tableNumber) {
  return new Promise((resolve, reject) => {
    const tNum = parseInt(tableNumber, 10);
    const sql = `SELECT id, item_name, quantity, price, status, created_at FROM orders WHERE table_number = ? ORDER BY id DESC`;
    db.all(sql, [tNum], async (err, rows) => {
      if (err) return reject(err);
      const orders = rows || [];
      for (const order of orders) {
        order.category = await getItemCategory(order.item_name);
      }
      resolve(orders);
    });
  });
}

/**
 * Waste Logging Helper
 */
function logWaste(inventoryId, itemName, quantity, reason = '', department = 'BARISTA') {
  return new Promise((resolve, reject) => {
    const qty = Number(quantity) || 0;
    if (qty <= 0) return reject(new Error('الكمية يجب أن تكون أكبر من صفر'));

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Deduct inventory
        const updateSql = `UPDATE inventory SET current_stock = current_stock - ? WHERE id = ?`;
        db.run(updateSql, [qty, inventoryId], (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }

          // Insert waste entry
          const insertSql = `INSERT INTO waste_log (inventory_id, item_name, quantity, reason, department) VALUES (?, ?, ?, ?, ?)`;
          db.run(insertSql, [inventoryId, itemName, qty, reason, department], function (err) {
            if (err) {
              db.run('ROLLBACK');
              return reject(err);
            }
            const wasteId = this.lastID;
            db.run('COMMIT', (err) => {
              if (err) return reject(err);
              resolve({ id: wasteId, inventory_id: inventoryId, item_name: itemName, quantity: qty, reason, department });
            });
          });
        });
      });
    });
  });
}

/**
 * Fetch Waste Logs
 */
function getWasteLogs(limit = 100) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM waste_log ORDER BY created_at DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Fetch Past Orders Today for a Category
 */
function getPastOrdersToday(category) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, item_name, quantity, price, table_number, status, created_at 
      FROM orders 
      WHERE status = 'READY' AND DATE(created_at) = DATE('now', 'localtime')
      ORDER BY id DESC
      LIMIT 30
    `;
    db.all(sql, [], async (err, rows) => {
      if (err) return reject(err);
      const orders = rows || [];
      const filtered = [];
      for (const order of orders) {
        order.category = await getItemCategory(order.item_name);
        if (!category || order.category === category) {
          filtered.push(order);
        }
      }
      resolve(filtered);
    });
  });
}

/**
 * Fetch distinct menu items
 */
function getMenu() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT menu_item_name, category, MAX(price) as price 
      FROM recipes 
      GROUP BY menu_item_name 
      ORDER BY menu_item_name ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Bulk update menu items
 */
function updateMenuBulk(items) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(items) || items.length === 0) return resolve(true);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        let completed = 0;
        let updateError = null;

        items.forEach((item) => {
          const targetName = item.original_name || item.menu_item_name;
          const newName = item.menu_item_name || targetName;
          const newPrice = Number(item.price) || 0;
          const newCategory = (item.category || 'BARISTA').toUpperCase();

          const sql = `UPDATE recipes SET menu_item_name = ?, price = ?, category = ? WHERE menu_item_name = ?`;
          db.run(sql, [newName, newPrice, newCategory, targetName], (err) => {
            if (err && !updateError) updateError = err;
            completed++;

            if (completed === items.length) {
              if (updateError) {
                db.run('ROLLBACK');
                return reject(updateError);
              }
              db.run('COMMIT', (err) => {
                if (err) return reject(err);
                resolve(true);
              });
            }
          });
        });
      });
    });
  });
}

/**
 * Add a single new menu item
 */
function addMenuItem(menu_item_name, price = 0, category = 'BARISTA') {
  return new Promise((resolve, reject) => {
    const p = Number(price) || 0;
    const cat = (category || 'BARISTA').toUpperCase();
    const sql = `INSERT INTO recipes (menu_item_name, inventory_id, quantity_required, category, price) VALUES (?, NULL, 0, ?, ?)`;

    db.run(sql, [menu_item_name, cat, p], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, menu_item_name, price: p, category: cat });
    });
  });
}

/**
 * Create order with atomic BOM stock deduction transaction, 5% production tolerance buffer, and user attribution
 */
async function createOrderWithBOM(itemName, quantity = 1, inputPrice = null, tableNumber = 0, waiterId = null, sugarLevel = null, roastType = null, extra = {}) {
  let orderPrice = inputPrice;
  if (orderPrice === null || orderPrice === undefined) {
    orderPrice = await getItemPrice(itemName);
  } else {
    orderPrice = Number(orderPrice) || 0;
  }
  const tNum = parseInt(tableNumber, 10) || 0;
  const wId = waiterId ? parseInt(waiterId, 10) : null;
  const sLevel = sugarLevel ? String(sugarLevel).trim() : null;
  const rType = roastType ? String(roastType).trim() : null;

  const itemNotes = extra.item_notes || null;
  const addons = extra.addons || null;
  const variant = extra.variant || null;
  const orderType = extra.order_type || (tNum > 0 ? 'DINE_IN' : 'TAKEAWAY');
  const staffUserId = extra.staff_user_id || null;
  const userId = extra.user_id || null;
  const userName = extra.user_name || null;
  const shiftType = extra.shift_type || 'MORNING';

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Insert into orders with all attribution & customization fields
      const insertOrderSql = `
        INSERT INTO orders (
          item_name, quantity, price, table_number, waiter_id, 
          sugar_level, roast_type, kds_status, order_type, 
          item_notes, addons, variant, staff_user_id, user_id, user_name, shift_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(insertOrderSql, [
        itemName, quantity, orderPrice, tNum, wId, 
        sLevel, rType, orderType, 
        itemNotes, addons, variant, staffUserId, userId, userName, shiftType
      ], function (err) {
        if (err) return reject(err);

        const orderId = this.lastID;

        // If table_number > 0, ensure table session is OPEN and update lifecycle
        if (tNum > 0) {
          db.run(`INSERT OR IGNORE INTO table_sessions (table_number, opened_at, status) VALUES (?, CURRENT_TIMESTAMP, 'OPEN')`, [tNum]);
          db.run(`UPDATE table_sessions SET status = 'OPEN' WHERE table_number = ?`, [tNum]);
          db.run(`
            UPDATE tables 
            SET status = CASE WHEN status = 'VACANT' THEN 'ORDERED' ELSE status END,
                first_ordered_at = COALESCE(first_ordered_at, CURRENT_TIMESTAMP),
                last_ordered_at = CURRENT_TIMESTAMP
            WHERE table_number = ?
          `, [tNum]);
        }

        // 2. Fetch recipe ingredients required for this menu item with tolerance buffer
        const getRecipeSql = `
          SELECT r.inventory_id, r.quantity_required, COALESCE(r.tolerance_percent, 5.0) as tolerance_percent, r.category, i.name as inv_name
          FROM recipes r 
          LEFT JOIN inventory i ON r.inventory_id = i.id
          WHERE r.menu_item_name = ? AND r.inventory_id IS NOT NULL
        `;
        db.all(getRecipeSql, [itemName], (err, recipeRows) => {
          if (err) return reject(err);

          if (!recipeRows || recipeRows.length === 0) {
            db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], async (err, row) => {
              if (err) return reject(err);
              row.category = await getItemCategory(row.item_name);
              resolve(row);
            });
            return;
          }

          // 3. Deduct stock including accepted production tolerance buffer (e.g. 5%)
          const updateStockSql = `UPDATE inventory SET current_stock = current_stock - ? WHERE id = ?`;
          let pendingDeductions = recipeRows.length;
          let deductionError = null;

          recipeRows.forEach((ingredient) => {
            const baseRequired = ingredient.quantity_required * quantity;
            const bufferPct = parseFloat(ingredient.tolerance_percent) || 5.0;
            const bufferQty = baseRequired * (bufferPct / 100.0);
            const totalToDeduct = baseRequired + bufferQty;

            db.run(updateStockSql, [totalToDeduct, ingredient.inventory_id], (err) => {
              if (err && !deductionError) deductionError = err;

              // Log production buffer to waste_log for transparency
              if (bufferQty > 0) {
                db.run(
                  `INSERT INTO waste_log (inventory_id, item_name, quantity, reason, department) VALUES (?, ?, ?, ?, ?)`,
                  [ingredient.inventory_id, ingredient.inv_name || itemName, bufferQty, `هالك تشغيل وتشغيل آلي مسموح (${bufferPct}%)`, ingredient.category || 'BARISTA']
                );
              }

              pendingDeductions--;

              if (pendingDeductions === 0) {
                if (deductionError) return reject(deductionError);

                db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], async (err, row) => {
                  if (err) return reject(err);
                  row.category = await getItemCategory(row.item_name);
                  resolve(row);
                });
              }
            });
          });
        });
      });
    });
  });
}

/**
 * Update order status to 'READY'
 */
function completeOrder(id) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE orders SET status = 'READY' WHERE id = ?`;
    db.run(sql, [id], function (err) {
      if (err) return reject(err);
      db.get(`SELECT id, item_name, quantity, price, table_number, status, created_at FROM orders WHERE id = ?`, [id], async (err, row) => {
        if (err) return reject(err);
        if (row) {
          row.category = await getItemCategory(row.item_name);
        }
        resolve(row);
      });
    });
  });
}

/**
 * Fetch all active/pending orders with complete KDS metadata
 */
function getPendingOrders() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, item_name, quantity, price, table_number, status, kds_status, edit_request, sugar_level, roast_type, created_at 
      FROM orders 
      WHERE status != 'VOIDED' AND (kds_status IS NULL OR kds_status != 'DELIVERED') 
      ORDER BY id ASC
    `;
    db.all(sql, [], async (err, rows) => {
      if (err) return reject(err);
      const orders = rows || [];
      for (const order of orders) {
        order.category = await getItemCategory(order.item_name);
      }
      resolve(orders);
    });
  });
}

/**
 * Fetch current inventory stock levels
 */
function getInventory() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT i.id, i.name, 
             COALESCE(SUM(l.quantity_delta_microunits), i.current_stock_microunits, 0) / 1000000.0 as current_stock,
             i.unit, 
             i.category as department,
             i.cost_per_unit_minor / 100.0 as unit_cost,
             i.min_limit as min_stock_level,
             i.default_supplier_id as supplier_id
      FROM inventory_items i
      LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
      WHERE i.is_active = 1
      GROUP BY i.id
      ORDER BY i.name ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) {
        // Fallback to legacy inventory table if inventory_items does not exist
        return db.all(`SELECT id, name, current_stock, unit, department FROM inventory ORDER BY id ASC`, [], (err2, rows2) => {
          if (err2) return reject(err);
          resolve(rows2 || []);
        });
      }
      resolve(rows || []);
    });
  });
}

/**
 * Save multi-method payment splits for an order or table session, with tips and dynamic tax breakdown
 */
function saveOrderPayments(orderId, tableNumber, payments = [], tipAmount = 0, taxBreakdown = {}) {
  return new Promise((resolve, reject) => {
    // 1. Strict status check for already settled orders
    if (orderId) {
      db.get(`SELECT id, status FROM orders WHERE id = ?`, [orderId], (err, existingOrder) => {
        if (err) return reject(err);
        if (existingOrder && ['CLOSED', 'PAID', 'SETTLED', 'VOIDED', 'VOID'].includes(existingOrder.status)) {
          const conflictErr = new Error("Order already settled");
          conflictErr.statusCode = 409;
          conflictErr.code = "ORDER_ALREADY_SETTLED";
          return reject(conflictErr);
        }
        executePaymentSave();
      });
    } else {
      executePaymentSave();
    }

    function executePaymentSave() {
      db.serialize(() => {
        const subtotal = Number(taxBreakdown.subtotal) || 0;
        const serviceAmount = Number(taxBreakdown.service_amount) || 0;
        const vatAmount = Number(taxBreakdown.vat_amount) || 0;
        const discountAmount = Number(taxBreakdown.discount_amount) || 0;
        const totalAmount = Number(taxBreakdown.total_amount) || 0;
        const currency = taxBreakdown.currency || 'ج.م';

        const insertSql = `
          INSERT INTO order_payments (
            order_id, method, amount, tip_amount, 
            subtotal, service_amount, vat_amount, discount_amount, total_amount, currency
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        let pending = payments.length;
        let insertErr = null;
        const tipNum = Number(tipAmount) || 0;

        function sanitizeTableAndClose() {
          if (orderId) {
            db.run(`UPDATE orders SET status = 'CLOSED' WHERE id = ?`, [orderId]);
          }
          if (tableNumber > 0) {
            db.run(`UPDATE table_sessions SET status = 'CLOSED' WHERE table_number = ?`, [tableNumber]);
            db.run(`UPDATE orders SET status = 'CLOSED' WHERE table_number = ?`, [tableNumber]);
            db.run(`
              UPDATE tables 
              SET status = 'AVAILABLE',
                  custom_name = NULL,
                  customer_name = NULL,
                  customer_phone = NULL,
                  guest_count = 0,
                  seated_at = NULL,
                  first_ordered_at = NULL,
                  last_ordered_at = NULL,
                  check_requested_at = NULL,
                  paid_at = datetime('now', 'localtime'),
                  vacated_at = datetime('now', 'localtime')
              WHERE table_number = ?
            `, [tableNumber]);
            db.run(`
              UPDATE v3_tables 
              SET status = 'AVAILABLE',
                  active_order_id = NULL,
                  active_reservation_id = NULL,
                  customer_context_json = NULL,
                  version = version + 1,
                  updated_at = datetime('now', 'localtime')
              WHERE table_number = ?
            `, [tableNumber]);
          }
        }

        if (pending === 0) {
          sanitizeTableAndClose();
          if (tipNum > 0 || totalAmount > 0) {
            db.run(insertSql, [orderId || null, 'CASH', totalAmount, tipNum, subtotal, serviceAmount, vatAmount, discountAmount, totalAmount, currency]);
          }
          return resolve(true);
        }

        payments.forEach((p, idx) => {
          const m = (p.method || 'CASH').toUpperCase();
          const amt = Number(p.amount) || 0;
          const entryTip = (idx === 0) ? tipNum : 0;
          const entrySub = (idx === 0) ? subtotal : 0;
          const entrySrv = (idx === 0) ? serviceAmount : 0;
          const entryVat = (idx === 0) ? vatAmount : 0;
          const entryDisc = (idx === 0) ? discountAmount : 0;
          const entryTot = (idx === 0) ? (totalAmount || amt) : amt;

          db.run(insertSql, [orderId || null, m, amt, entryTip, entrySub, entrySrv, entryVat, entryDisc, entryTot, currency], (err) => {
            if (err && !insertErr) insertErr = err;
            pending--;

            if (pending === 0) {
              if (insertErr) return reject(insertErr);
              sanitizeTableAndClose();
              resolve(true);
            }
          });
        });
      });
    }
  });
}

/**
 * Log employee advance (سلفة موظف)
 */
function logEmployeeAdvance(employeeName, amount) {
  return new Promise((resolve, reject) => {
    const amt = Number(amount) || 0;
    const sql = `INSERT INTO employee_advances (employee_name, amount) VALUES (?, ?)`;
    db.run(sql, [employeeName, amt], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, employee_name: employeeName, amount: amt });
    });
  });
}

/**
 * Fetch today's employee advances
 */
function getTodayAdvances() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, employee_name, amount, issued_at FROM employee_advances WHERE date(issued_at) = date('now', 'localtime') ORDER BY id DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Log daily cafe expense
 */
function logDailyExpense(description, amount, paymentSource = 'DRAWER') {
  return new Promise((resolve, reject) => {
    const amt = Number(amount) || 0;
    const src = (paymentSource || 'DRAWER').toUpperCase();
    const sql = `INSERT INTO daily_expenses (description, amount, payment_source) VALUES (?, ?, ?)`;
    db.run(sql, [description, amt, src], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, description, amount: amt, payment_source: src });
    });
  });
}

/**
 * Fetch today's daily expenses
 */
function getTodayExpenses() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, description, amount, payment_source, created_at FROM daily_expenses WHERE date(created_at) = date('now', 'localtime') ORDER BY id DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Aggregate End-of-Day (EOD) Financial Report
 */
function getEodReport() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Total revenue & count from orders today
      const ordersSql = `SELECT COUNT(*) as total_orders, COALESCE(SUM(quantity * price), 0) as total_revenue FROM orders WHERE date(created_at) = date('now', 'localtime')`;
      
      // 2. Payments by method today
      const paymentsSql = `SELECT method, COALESCE(SUM(amount), 0) as total FROM order_payments WHERE date(created_at) = date('now', 'localtime') GROUP BY method`;

      // 3. Total advances today
      const advancesSql = `SELECT COALESCE(SUM(amount), 0) as total_advances FROM employee_advances WHERE date(issued_at) = date('now', 'localtime')`;

      // 4. Expenses by source today
      const expensesSql = `SELECT payment_source, COALESCE(SUM(amount), 0) as total FROM daily_expenses WHERE date(created_at) = date('now', 'localtime') GROUP BY payment_source`;

      db.get(ordersSql, [], (err, orderSummary) => {
        if (err) return reject(err);
        
        db.all(paymentsSql, [], (err, paymentRows) => {
          if (err) return reject(err);

          db.get(advancesSql, [], (err, advanceSummary) => {
            if (err) return reject(err);

            db.all(expensesSql, [], (err, expenseRows) => {
              if (err) return reject(err);

              const methods = { CASH: 0, INSTAPAY: 0, WALLET: 0, VISA: 0, CREDIT: 0 };
              (paymentRows || []).forEach(r => {
                if (r.method) methods[r.method.toUpperCase()] = r.total;
              });

              // If no order_payments were logged, treat total_revenue as cash default
              const totalRevenue = orderSummary ? orderSummary.total_revenue : 0;
              const loggedPaymentSum = Object.values(methods).reduce((a, b) => a + b, 0);
              let cashSales = methods.CASH;
              if (loggedPaymentSum === 0 && totalRevenue > 0) {
                cashSales = totalRevenue;
                methods.CASH = totalRevenue;
              }

              let drawerExpenses = 0;
              let digitalExpenses = 0;
              (expenseRows || []).forEach(e => {
                if (e.payment_source === 'DRAWER') drawerExpenses += e.total;
                else digitalExpenses += e.total;
              });

              const totalAdvances = advanceSummary ? advanceSummary.total_advances : 0;
              const expectedCashInDrawer = cashSales - drawerExpenses - totalAdvances;

              resolve({
                date: new Date().toISOString().split('T')[0],
                total_orders: orderSummary ? orderSummary.total_orders : 0,
                total_revenue: totalRevenue,
                payment_methods: methods,
                total_advances: totalAdvances,
                drawer_expenses: drawerExpenses,
                digital_expenses: digitalExpenses,
                total_expenses: drawerExpenses + digitalExpenses,
                expected_cash_in_drawer: expectedCashInDrawer
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Fetch or initialize customer record
 */
function getCustomer(phone) {
  return new Promise((resolve, reject) => {
    if (!phone) return resolve(null);
    const cleanPhone = String(phone).trim();
    db.get(`SELECT phone, name, points, total_spent, created_at FROM customers WHERE phone = ?`, [cleanPhone], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);
      // Auto create new customer entry
      db.run(`INSERT INTO customers (phone, name, points, total_spent) VALUES (?, ?, 0, 0)`, [cleanPhone, `عميل ${cleanPhone}`], function (err) {
        if (err) return reject(err);
        resolve({ phone: cleanPhone, name: `عميل ${cleanPhone}`, points: 0, total_spent: 0 });
      });
    });
  });
}

/**
 * Update customer loyalty points and total spent
 */
function addOrUpdateCustomer(phone, name, addPoints = 0, addSpent = 0) {
  return new Promise((resolve, reject) => {
    if (!phone) return resolve(null);
    const cleanPhone = String(phone).trim();
    getCustomer(cleanPhone).then((cust) => {
      const newPoints = Math.max(0, (cust.points || 0) + Number(addPoints));
      const newSpent = (cust.total_spent || 0) + Number(addSpent);
      const custName = name || cust.name || `عميل ${cleanPhone}`;

      db.run(`UPDATE customers SET name = ?, points = ?, total_spent = ? WHERE phone = ?`, [custName, newPoints, newSpent, cleanPhone], function (err) {
        if (err) return reject(err);
        resolve({ phone: cleanPhone, name: custName, points: newPoints, total_spent: newSpent });
      });
    }).catch(reject);
  });
}

/**
 * Move open table session to another table
 */
function moveTableSession(fromTable, toTable) {
  return new Promise((resolve, reject) => {
    const fromT = Number(fromTable);
    const toT = Number(toTable);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        // Update orders to new table
        db.run(`UPDATE orders SET table_number = ? WHERE table_number = ? AND status = 'PENDING'`, [toT, fromT], (err) => {
          if (err) { db.run('ROLLBACK'); return reject(err); }

          // Close old table session
          db.run(`UPDATE table_sessions SET status = 'CLOSED' WHERE table_number = ?`, [fromT], (err) => {
            if (err) { db.run('ROLLBACK'); return reject(err); }

            // Open new table session
            db.run(`INSERT INTO table_sessions (table_number, opened_at, status) VALUES (?, CURRENT_TIMESTAMP, 'OPEN') ON CONFLICT(table_number) DO UPDATE SET opened_at = CURRENT_TIMESTAMP, status = 'OPEN'`, [toT], (err) => {
              if (err) { db.run('ROLLBACK'); return reject(err); }

              db.run('COMMIT', (err) => {
                if (err) return reject(err);
                resolve({ fromTable: fromT, toTable: toT });
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Log shareholder transaction (INJECTION, WITHDRAWAL, EXTERNAL_EXPENSE)
 */
function logShareholderTransaction(partnerName, amount, type, description = '') {
  return new Promise((resolve, reject) => {
    const amt = Number(amount) || 0;
    const t = (type || 'INJECTION').toUpperCase();
    const sql = `INSERT INTO shareholder_ledger (partner_name, amount, type, description) VALUES (?, ?, ?, ?)`;
    db.run(sql, [partnerName, amt, t, description], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, partner_name: partnerName, amount: amt, type: t, description });
    });
  });
}

/**
 * Fetch shareholder ledger and calculated net business worth
 */
function getShareholderLedger() {
  return new Promise((resolve, reject) => {
    const ledgerSql = `SELECT id, partner_name, amount, type, description, created_at FROM shareholder_ledger ORDER BY id DESC`;
    db.all(ledgerSql, [], (err, rows) => {
      if (err) return reject(err);

      getEodReport().then((eod) => {
        let totalInjections = 0;
        let totalWithdrawals = 0;
        let totalExternalExpenses = 0;

        (rows || []).forEach(r => {
          if (r.type === 'INJECTION') totalInjections += r.amount;
          else if (r.type === 'WITHDRAWAL') totalWithdrawals += r.amount;
          else if (r.type === 'EXTERNAL_EXPENSE') totalExternalExpenses += r.amount;
        });

        // Net Business Worth = Total Revenue - (Total Expenses + External Expenses + Advances) + Capital Injections - Withdrawals
        const netWorth = (eod.total_revenue || 0) - (eod.total_expenses || 0) - totalExternalExpenses - (eod.total_advances || 0) + totalInjections - totalWithdrawals;

        resolve({
          ledger: rows || [],
          summary: {
            total_injections: totalInjections,
            total_withdrawals: totalWithdrawals,
            total_external_expenses: totalExternalExpenses,
            today_revenue: eod.total_revenue || 0,
            today_expenses: eod.total_expenses || 0,
            net_business_worth: netWorth
          }
        });
      }).catch(reject);
    });
  });
}

/**
 * Business Intelligence (BI) Aggregation Engine
 * Aggregates KPIs, hourly sales, top items, and department breakdown for dateRange ('today', 'week', 'month')
 */
function getBIData(dateRange = 'today') {
  return new Promise((resolve, reject) => {
    let dateWhere = `date(o.created_at) = date('now', 'localtime')`;
    let wasteWhere = `date(w.created_at) = date('now', 'localtime')`;

    if (dateRange === 'week') {
      dateWhere = `date(o.created_at) >= date('now', 'localtime', '-7 days')`;
      wasteWhere = `date(w.created_at) >= date('now', 'localtime', '-7 days')`;
    } else if (dateRange === 'month') {
      dateWhere = `date(o.created_at) >= date('now', 'localtime', '-30 days')`;
      wasteWhere = `date(w.created_at) >= date('now', 'localtime', '-30 days')`;
    }

    db.serialize(() => {
      // 1. KPIs: Total Revenue, Total Orders, Total Waste
      const kpiSql = `
        SELECT 
          COUNT(o.id) as total_orders, 
          COALESCE(SUM(o.price * o.quantity), 0) as total_revenue
        FROM orders o
        WHERE ${dateWhere}
      `;

      const wasteSql = `
        SELECT COALESCE(SUM(w.quantity), 0) as total_waste_count
        FROM waste_log w
        WHERE ${wasteWhere}
      `;

      // 2. Hourly Sales Trend
      const hourlySql = `
        SELECT 
          strftime('%H', o.created_at) as hour, 
          COALESCE(SUM(o.price * o.quantity), 0) as total,
          COUNT(o.id) as count
        FROM orders o
        WHERE ${dateWhere}
        GROUP BY strftime('%H', o.created_at)
        ORDER BY hour ASC
      `;

      // 3. Top 10 Selling Items
      const topItemsSql = `
        SELECT 
          o.item_name, 
          COALESCE(SUM(o.quantity), 0) as qty, 
          COALESCE(SUM(o.price * o.quantity), 0) as total
        FROM orders o
        WHERE ${dateWhere}
        GROUP BY o.item_name
        ORDER BY qty DESC
        LIMIT 10
      `;

      // 4. Department Sales (BARISTA, SHISHA, KITCHEN)
      const deptSql = `
        SELECT 
          COALESCE(r.category, 'BARISTA') as department,
          COALESCE(SUM(o.price * o.quantity), 0) as total
        FROM orders o
        LEFT JOIN recipes r ON o.item_name = r.menu_item_name
        WHERE ${dateWhere}
        GROUP BY COALESCE(r.category, 'BARISTA')
      `;

      db.get(kpiSql, [], (err, kpiRow) => {
        if (err) return reject(err);

        db.get(wasteSql, [], (err, wasteRow) => {
          if (err) return reject(err);

          db.all(hourlySql, [], (err, hourlyRows) => {
            if (err) return reject(err);

            db.all(topItemsSql, [], (err, topItemRows) => {
              if (err) return reject(err);

              db.all(deptSql, [], (err, deptRows) => {
                if (err) return reject(err);

                const totalOrders = kpiRow ? kpiRow.total_orders : 0;
                const totalRevenue = kpiRow ? kpiRow.total_revenue : 0;
                const aov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 10) / 10 : 0;
                const wasteCount = wasteRow ? wasteRow.total_waste_count : 0;

                // Department Breakdown map
                const depts = { BARISTA: 0, SHISHA: 0, KITCHEN: 0 };
                (deptRows || []).forEach(d => {
                  const deptKey = (d.department || 'BARISTA').toUpperCase();
                  depts[deptKey] = (depts[deptKey] || 0) + d.total;
                });

                resolve({
                  range: dateRange,
                  kpis: {
                    total_revenue: totalRevenue,
                    total_orders: totalOrders,
                    aov: aov,
                    total_waste_cost: wasteCount * 25 // Average unit waste cost estimation
                  },
                  hourly_sales: hourlyRows || [],
                  top_items: topItemRows || [],
                  department_sales: depts
                });
              });
            });
          });
        });
      });
    });
  });
}

/**
 * RBAC Login with PIN code
 */
function loginWithPin(pinCode) {
  return new Promise((resolve, reject) => {
    const pin = String(pinCode || '').trim();
    if (!pin) return resolve(null);
    db.all(`SELECT id, name, role, pin_hash, hourly_rate FROM users`, [], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return resolve(null);
      for (const row of rows) {
        if (row.pin_hash && bcrypt.compareSync(pin, row.pin_hash)) {
          return resolve(row);
        }
      }
      resolve(null);
    });
  });
}

/**
 * Log inventory purchase (Restock BOM item stock)
 */
function logPurchase(inventoryId, qtyAdded, totalCost) {
  return new Promise((resolve, reject) => {
    const invId = parseInt(inventoryId, 10);
    const qty = Number(qtyAdded) || 0;
    const cost = Number(totalCost) || 0;

    if (!invId || qty <= 0) {
      return reject(new Error('بيانات الشراء غير صالحة'));
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        db.run(`UPDATE inventory SET current_stock = current_stock + ? WHERE id = ?`, [qty, invId], (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }

          db.run(`INSERT INTO purchases (inventory_id, qty_added, total_cost) VALUES (?, ?, ?)`, [invId, qty, cost], function (err) {
            if (err) {
              db.run('ROLLBACK');
              return reject(err);
            }

            const purchaseId = this.lastID;
            db.run('COMMIT', (err) => {
              if (err) return reject(err);
              resolve({ id: purchaseId, inventory_id: invId, qty_added: qty, total_cost: cost });
            });
          });
        });
      });
    });
  });
}

/**
 * Fetch Purchases History
 */
function getPurchasesHistory() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT p.id, p.inventory_id, i.name as item_name, i.unit, p.qty_added, p.total_cost, p.created_at
      FROM purchases p
      LEFT JOIN inventory i ON p.inventory_id = i.id
      ORDER BY p.id DESC
      LIMIT 50
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Shift Management - Clock In User
 */
function clockInUser(userId) {
  return new Promise((resolve, reject) => {
    const uId = parseInt(userId, 10);
    if (!uId) return reject(new Error('معرف الموظف مطلوب'));

    db.get(`SELECT * FROM shifts WHERE user_id = ? AND status = 'ACTIVE'`, [uId], (err, existing) => {
      if (err) return reject(err);
      if (existing) {
        return db.get(`SELECT s.*, u.name as user_name, u.role FROM shifts s JOIN users u ON s.user_id = u.id WHERE s.id = ?`, [existing.id], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      }

      db.run(`INSERT INTO shifts (user_id, clock_in, status) VALUES (?, CURRENT_TIMESTAMP, 'ACTIVE')`, [uId], function (err) {
        if (err) return reject(err);
        const shiftId = this.lastID;
        db.get(`SELECT s.*, u.name as user_name, u.role FROM shifts s JOIN users u ON s.user_id = u.id WHERE s.id = ?`, [shiftId], (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });
    });
  });
}

/**
 * Shift Management - Clock Out User
 */
function clockOutUser(userId) {
  return new Promise((resolve, reject) => {
    const uId = parseInt(userId, 10);
    if (!uId) return reject(new Error('معرف الموظف مطلوب'));

    db.run(`UPDATE shifts SET clock_out = CURRENT_TIMESTAMP, status = 'CLOSED' WHERE user_id = ? AND status = 'ACTIVE'`, [uId], function (err) {
      if (err) return reject(err);
      resolve({ user_id: uId, status: 'CLOSED' });
    });
  });
}

/**
 * Shift Management - Get Active Shifts
 */
function getActiveShifts() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT s.id, s.user_id, u.name as user_name, u.role, s.clock_in, s.status
      FROM shifts s
      JOIN users u ON s.user_id = u.id
      WHERE s.status = 'ACTIVE'
      ORDER BY s.id DESC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Shift Management - Get User Active Shift
 */
function getUserShiftStatus(userId) {
  return new Promise((resolve, reject) => {
    const uId = parseInt(userId, 10);
    db.get(`SELECT * FROM shifts WHERE user_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`, [uId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Tips Pool Calculation
 */
function getTotalTipsPool() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT COALESCE(SUM(tip_amount), 0) as total_tips FROM order_payments WHERE date(created_at) = date('now', 'localtime')`;
    db.get(sql, [], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.total_tips : 0);
    });
  });
}

/**
 * Void/Refund an Order securely with Manager/Owner/Admin PIN validation
 */
async function voidOrder(orderId, managerPin) {
  return new Promise((resolve, reject) => {
    const checkPinSql = `SELECT * FROM users WHERE role IN ('OWNER', 'OP_MANAGER', 'MANAGER', 'ADMIN')`;
    db.all(checkPinSql, [], (err, users) => {
      if (err) return reject(err);
      const user = (users || []).find(u => u.pin_hash && bcrypt.compareSync(String(managerPin).trim(), u.pin_hash));
      if (!user) {
        return resolve({ success: false, error: 'رمز PIN غير مصرح به لإلغاء الطلبات (يلزم مدير عمليات/مالك)' });
      }

      db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
        if (err) return reject(err);
        if (!order) {
          return resolve({ success: false, error: 'الطلب غير موجود' });
        }
        if (order.status === 'VOIDED') {
          return resolve({ success: false, error: 'الطلب ملغى بالفعل' });
        }

        // Check if order is completed / paid
        db.get(`SELECT COALESCE(SUM(amount), 0) as paid FROM order_payments WHERE order_id = ?`, [orderId], (err, pRow) => {
          if (err) return reject(err);
          const isPaid = (order.status === 'CLOSED' || order.status === 'PAID' || (pRow && pRow.paid > 0));
          if (isPaid && user.role !== 'OWNER' && user.role !== 'ADMIN') {
            return resolve({ success: false, error: 'صلاحية إلغاء الفواتير المغلقة/المسددة ماليًا مقتصرة حصريًا على المالك (OWNER)' });
          }

        db.serialize(() => {
          db.run('BEGIN TRANSACTION', (err) => {
            if (err) return reject(err);

            db.run(`UPDATE orders SET status = 'VOIDED' WHERE id = ?`, [orderId], (err) => {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }

              const getRecipeSql = `SELECT inventory_id, quantity_required FROM recipes WHERE menu_item_name = ? AND inventory_id IS NOT NULL`;
              db.all(getRecipeSql, [order.item_name], (err, recipeRows) => {
                if (err) {
                  db.run('ROLLBACK');
                  return reject(err);
                }

                const processStockRestoration = () => {
                  db.run(`UPDATE order_payments SET amount = 0, tip_amount = 0 WHERE order_id = ?`, [orderId], (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return reject(err);
                    }
                    db.run('COMMIT', (err) => {
                      if (err) return reject(err);
                      resolve({
                        success: true,
                        message: 'تم إلغاء الطلب وإعادة استرجاع الخامات للمخزون وتسوية الحساب بنجاح',
                        voided_order: { ...order, status: 'VOIDED' },
                        authorized_by: user.name
                      });
                    });
                  });
                };

                if (!recipeRows || recipeRows.length === 0) {
                  processStockRestoration();
                  return;
                }

                const restoreStockSql = `UPDATE inventory SET current_stock = current_stock + ? WHERE id = ?`;
                let pendingRestores = recipeRows.length;
                let restoreError = null;

                recipeRows.forEach((ingredient) => {
                  const restoreQty = ingredient.quantity_required * order.quantity;
                  db.run(restoreStockSql, [restoreQty, ingredient.inventory_id], (err) => {
                    if (err && !restoreError) restoreError = err;
                    pendingRestores--;

                    if (pendingRestores === 0) {
                      if (restoreError) {
                        db.run('ROLLBACK');
                        return reject(restoreError);
                      }
                      processStockRestoration();
                    }
                  });
                });
                });
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Blind Cash Declaration
 */
async function declareCash(userId, declaredAmount) {
  const decAmount = parseFloat(declaredAmount) || 0;
  return new Promise((resolve, reject) => {
    db.get(`SELECT id, name FROM users WHERE id = ?`, [userId], async (err, user) => {
      if (err) return reject(err);
      const userName = user ? user.name : 'كاشير';

      try {
        const cashPaymentsSql = `SELECT COALESCE(SUM(amount), 0) as total FROM order_payments WHERE method = 'CASH' AND date(created_at) = date('now', 'localtime')`;
        const drawerExpensesSql = `SELECT COALESCE(SUM(amount), 0) as total FROM daily_expenses WHERE payment_source = 'DRAWER' AND date(created_at) = date('now', 'localtime')`;
        const advancesSql = `SELECT COALESCE(SUM(amount), 0) as total FROM employee_advances WHERE date(issued_at) = date('now', 'localtime')`;

        db.get(cashPaymentsSql, [], (err, row1) => {
          if (err) return reject(err);
          const cashSales = row1 ? row1.total : 0;

          db.get(drawerExpensesSql, [], (err, row2) => {
            if (err) return reject(err);
            const cashExp = row2 ? row2.total : 0;

            db.get(advancesSql, [], (err, row3) => {
              if (err) return reject(err);
              const cashAdv = row3 ? row3.total : 0;

              const expectedAmount = cashSales - cashExp - cashAdv;
              const variance = decAmount - expectedAmount;

              const insertSql = `INSERT INTO drawer_declarations (user_id, user_name, declared_amount, expected_amount, variance) VALUES (?, ?, ?, ?, ?)`;
              db.run(insertSql, [userId || null, userName, decAmount, expectedAmount, variance], function (err) {
                if (err) return reject(err);
                resolve({
                  id: this.lastID,
                  user_id: userId,
                  user_name: userName,
                  declared_amount: decAmount,
                  expected_amount: expectedAmount,
                  variance: variance,
                  variance_type: variance === 0 ? 'BALANCED' : (variance > 0 ? 'SURPLUS' : 'DEFICIT')
                });
              });
            });
          });
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function getDrawerDeclarations() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM drawer_declarations WHERE date(created_at) = date('now', 'localtime') ORDER BY id DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Universal Audit Logging Helper
 */
function logAudit(userId, action, targetTable, recordId = null, previousValue = null, newValue = null) {
  return new Promise((resolve, reject) => {
    const prevStr = previousValue ? (typeof previousValue === 'object' ? JSON.stringify(previousValue) : String(previousValue)) : null;
    const newStr = newValue ? (typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)) : null;
    const sql = `INSERT INTO audit_logs (user_id, action, target_table, record_id, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [userId || null, action, targetTable, recordId || null, prevStr, newStr], function (err) {
      if (err) {
        console.error('❌ Error logging audit log:', err.message);
        return resolve(null);
      }
      resolve({ id: this.lastID, user_id: userId, action, target_table: targetTable, record_id: recordId });
    });
  });
}

function getAuditLogs(limit = 100) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT a.*, u.name as user_name, u.role as user_role FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.id DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * KDS State Machine Transitions & Handshake
 * Transitions: PENDING -> ACCEPTED -> READY -> DELIVERED
 */
function updateKdsStatus(orderId, newKdsStatus, userId = null) {
  return new Promise((resolve, reject) => {
    const validStatuses = ['PENDING', 'ACCEPTED', 'READY', 'DELIVERED'];
    const statusUpper = String(newKdsStatus).toUpperCase();
    if (!validStatuses.includes(statusUpper)) {
      return reject(new Error('حالة KDS غير صالحة'));
    }

    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (err) return reject(err);
      if (!order) return reject(new Error('الطلب غير موجود'));

      const sql = `UPDATE orders SET kds_status = ? WHERE id = ?`;
      db.run(sql, [statusUpper, orderId], function (err) {
        if (err) return reject(err);
        logAudit(userId, `KDS_STATUS_${statusUpper}`, 'orders', orderId, { kds_status: order.kds_status }, { kds_status: statusUpper });
        resolve({ ...order, kds_status: statusUpper });
      });
    });
  });
}

/**
 * Handshake Cancellation Protocol:
 * If PENDING: Waiter/Cashier cancels immediately.
 * If ACCEPTED: Waiter requests cancellation (edit_request = 'CANCEL_REQUESTED').
 */
function requestOrderCancellation(orderId, waiterId = null) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (err) return reject(err);
      if (!order) return reject(new Error('الطلب غير موجود'));

      if (order.kds_status === 'PENDING') {
        // Direct cancel
        db.run(`UPDATE orders SET status = 'VOIDED', kds_status = 'DELIVERED', edit_request = NULL WHERE id = ?`, [orderId], (err) => {
          if (err) return reject(err);
          logAudit(waiterId, 'CANCEL_PENDING_ORDER', 'orders', orderId, order, { status: 'VOIDED' });
          resolve({ success: true, auto_voided: true, order: { ...order, status: 'VOIDED', kds_status: 'DELIVERED', edit_request: null } });
        });
      } else {
        // Request Barista handshake approval
        db.run(`UPDATE orders SET edit_request = 'CANCEL_REQUESTED' WHERE id = ?`, [orderId], (err) => {
          if (err) return reject(err);
          logAudit(waiterId, 'REQUEST_CANCEL_ORDER', 'orders', orderId, { edit_request: null }, { edit_request: 'CANCEL_REQUESTED' });
          resolve({ success: true, auto_voided: false, order: { ...order, edit_request: 'CANCEL_REQUESTED' }, message: 'تم تقديم طلب الإلغاء في انتظار موافقة الباريستا/الشيف' });
        });
      }
    });
  });
}

function resolveOrderCancellation(orderId, approved, managerOrBaristaId = null) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (err) return reject(err);
      if (!order) return reject(new Error('الطلب غير موجود'));

      if (approved) {
        db.run(`UPDATE orders SET status = 'VOIDED', kds_status = 'DELIVERED', edit_request = NULL WHERE id = ?`, [orderId], (err) => {
          if (err) return reject(err);
          logAudit(managerOrBaristaId, 'APPROVE_CANCEL_ORDER', 'orders', orderId, order, { status: 'VOIDED' });
          resolve({ success: true, status: 'VOIDED', order: { ...order, status: 'VOIDED', kds_status: 'DELIVERED', edit_request: null }, message: 'تمت الموافقة على طلب الإلغاء' });
        });
      } else {
        db.run(`UPDATE orders SET edit_request = NULL WHERE id = ?`, [orderId], (err) => {
          if (err) return reject(err);
          logAudit(managerOrBaristaId, 'REJECT_CANCEL_ORDER', 'orders', orderId, { edit_request: 'CANCEL_REQUESTED' }, { edit_request: null });
          resolve({ success: true, status: order.status, order: { ...order, edit_request: null }, message: 'تم رفض طلب الإلغاء ويستمر تنفيذ الطلب' });
        });
      }
    });
  });
}


/**
 * Payroll & Penalties Engine Helpers
 */
function updateUserHourlyRate(userId, hourlyRate) {
  return new Promise((resolve, reject) => {
    const uId = parseInt(userId, 10);
    const rate = parseFloat(hourlyRate) || 0;
    db.run(`UPDATE users SET hourly_rate = ? WHERE id = ?`, [rate, uId], function (err) {
      if (err) return reject(err);
      logAudit(null, 'UPDATE_HOURLY_RATE', 'users', uId, null, { hourly_rate: rate });
      resolve({ success: true, user_id: uId, hourly_rate: rate });
    });
  });
}

function logPenalty(userId, amount, reason) {
  return new Promise((resolve, reject) => {
    const uId = parseInt(userId, 10);
    const amt = parseFloat(amount) || 0;
    const rsn = String(reason || '').trim();
    if (!uId || amt <= 0) return reject(new Error('مبلغ الجزاء والموظف مطلوبان'));

    db.run(`INSERT INTO penalties (user_id, amount, reason) VALUES (?, ?, ?)`, [uId, amt, rsn], function (err) {
      if (err) return reject(err);
      const penaltyId = this.lastID;
      logAudit(null, 'LOG_PENALTY', 'penalties', penaltyId, null, { user_id: uId, amount: amt, reason: rsn });
      resolve({ id: penaltyId, user_id: uId, amount: amt, reason: rsn, success: true });
    });
  });
}

function getPenalties(userId = null) {
  return new Promise((resolve, reject) => {
    let sql = `SELECT p.*, u.name as user_name, u.role as user_role FROM penalties p LEFT JOIN users u ON p.user_id = u.id`;
    const params = [];
    if (userId) {
      sql += ` WHERE p.user_id = ?`;
      params.push(parseInt(userId, 10));
    }
    sql += ` ORDER BY p.id DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function getPayrollData(startDate = null, endDate = null) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, name, role, hourly_rate FROM users ORDER BY name ASC`, [], async (err, users) => {
      if (err) return reject(err);
      if (!users || users.length === 0) return resolve([]);

      try {
        const payrollList = [];
        for (const user of users) {
          // 1. Calculate Total Hours from Shifts (Safely bounded per shift)
          let shiftSql = `SELECT clock_in, clock_out FROM shifts WHERE user_id = ?`;
          const shiftParams = [user.id];
          if (startDate) {
            shiftSql += ` AND date(clock_in) >= date(?)`;
            shiftParams.push(startDate);
          }
          if (endDate) {
            shiftSql += ` AND date(clock_in) <= date(?)`;
            shiftParams.push(endDate);
          }

          const shifts = await new Promise((res, rej) => {
            db.all(shiftSql, shiftParams, (err, rows) => err ? rej(err) : res(rows || []));
          });

          let totalHours = 0;
          for (const s of shifts) {
            const startMs = new Date(s.clock_in).getTime();
            const endMs = s.clock_out ? new Date(s.clock_out).getTime() : Date.now();
            if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
              const rawDuration = (endMs - startMs) / (1000 * 60 * 60);
              // Cap at 24 hours max per single shift session to avoid runaway unclosed shifts
              totalHours += Math.min(24, Math.max(0, rawDuration));
            }
          }

          // 2. Base Salary
          const hourlyRate = parseFloat(user.hourly_rate) || 0;
          const baseSalary = totalHours * hourlyRate;

          // 3. Advances
          let advSql = `SELECT COALESCE(SUM(amount), 0) as total FROM employee_advances WHERE employee_name = ? OR employee_id = ?`;
          const advParams = [user.name, user.id];
          if (startDate) {
            advSql += ` AND date(issued_at) >= date(?)`;
            advParams.push(startDate);
          }
          if (endDate) {
            advSql += ` AND date(issued_at) <= date(?)`;
            advParams.push(endDate);
          }
          const advRow = await new Promise((res, rej) => {
            db.get(advSql, advParams, (err, row) => err ? rej(err) : res(row || { total: 0 }));
          });
          const totalAdvances = parseFloat(advRow.total) || 0;

          // 4. Penalties
          let penSql = `SELECT COALESCE(SUM(amount), 0) as total FROM penalties WHERE user_id = ?`;
          const penParams = [user.id];
          if (startDate) {
            penSql += ` AND date(created_at) >= date(?)`;
            penParams.push(startDate);
          }
          if (endDate) {
            penSql += ` AND date(created_at) <= date(?)`;
            penParams.push(endDate);
          }
          const penRow = await new Promise((res, rej) => {
            db.get(penSql, penParams, (err, row) => err ? rej(err) : res(row || { total: 0 }));
          });
          const totalPenalties = parseFloat(penRow.total) || 0;

          // 5. Net Salary & Carried Debt (Floored at 0 for payable net pay)
          const rawNetSalary = baseSalary - totalAdvances - totalPenalties;
          const payableNetSalary = Math.max(0, rawNetSalary);
          const carriedDebt = rawNetSalary < 0 ? Math.round(Math.abs(rawNetSalary) * 100) / 100 : 0;

          payrollList.push({
            user_id: user.id,
            name: user.name,
            role: user.role,
            hourly_rate: hourlyRate,
            total_hours: Math.round(totalHours * 100) / 100,
            base_salary: Math.round(baseSalary * 100) / 100,
            total_advances: Math.round(totalAdvances * 100) / 100,
            total_penalties: Math.round(totalPenalties * 100) / 100,
            carried_debt: carriedDebt,
            net_salary: Math.round(payableNetSalary * 100) / 100
          });
        }
        resolve(payrollList);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Quality Assurance & Complaints Helpers
 */
function logComplaint(orderId, loggedByUserId, againstUserId, description, severity = 'LOW') {
  return new Promise((resolve, reject) => {
    const oId = orderId ? parseInt(orderId, 10) : null;
    const lBy = loggedByUserId ? parseInt(loggedByUserId, 10) : null;
    const aBy = againstUserId ? parseInt(againstUserId, 10) : null;
    const desc = String(description || '').trim();
    const sev = ['LOW', 'MED', 'HIGH'].includes(String(severity).toUpperCase()) ? String(severity).toUpperCase() : 'LOW';

    if (!desc) return reject(new Error('وصف الشكوى مطلوب'));

    const sql = `INSERT INTO complaints (order_id, logged_by_user_id, against_user_id, description, severity, status) VALUES (?, ?, ?, ?, ?, 'OPEN')`;
    db.run(sql, [oId, lBy, aBy, desc, sev], function (err) {
      if (err) return reject(err);
      const complaintId = this.lastID;
      logAudit(lBy, 'LOG_COMPLAINT', 'complaints', complaintId, null, { against_user_id: aBy, severity: sev, description: desc });
      resolve({ id: complaintId, order_id: oId, logged_by_user_id: lBy, against_user_id: aBy, description: desc, severity: sev, status: 'OPEN', success: true });
    });
  });
}

function getComplaints() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT c.*, 
             u1.name as logged_by_name, 
             u2.name as against_user_name,
             u2.role as against_user_role
      FROM complaints c
      LEFT JOIN users u1 ON c.logged_by_user_id = u1.id
      LEFT JOIN users u2 ON c.against_user_id = u2.id
      ORDER BY c.id DESC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function resolveComplaint(complaintId, userId = null) {
  return new Promise((resolve, reject) => {
    const cId = parseInt(complaintId, 10);
    db.run(`UPDATE complaints SET status = 'RESOLVED' WHERE id = ?`, [cId], function (err) {
      if (err) return reject(err);
      logAudit(userId, 'RESOLVE_COMPLAINT', 'complaints', cId, { status: 'OPEN' }, { status: 'RESOLVED' });
      resolve({ success: true, id: cId, status: 'RESOLVED' });
    });
  });
}

/**
 * Table Lifecycle & Custom Naming Helpers
 */
function getAllTables() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        t.*,
        COUNT(CASE WHEN o.status != 'PAID' AND o.status != 'VOIDED' THEN o.id END) as active_items_count,
        COALESCE(SUM(CASE WHEN o.status != 'PAID' AND o.status != 'VOIDED' THEN o.quantity * o.price END), 0) as active_total_amount
      FROM tables t
      LEFT JOIN orders o ON t.table_number = o.table_number
      GROUP BY t.table_number
      ORDER BY t.table_number ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      
      const now = new Date();
      const tablesWithDurations = rows.map(tbl => {
        let seated_minutes = null;
        let check_requested_minutes = null;
        let paid_minutes = null;

        if (tbl.seated_at) {
          seated_minutes = Math.floor((now - new Date(tbl.seated_at)) / (1000 * 60));
        }
        if (tbl.check_requested_at) {
          check_requested_minutes = Math.floor((now - new Date(tbl.check_requested_at)) / (1000 * 60));
        }
        if (tbl.paid_at) {
          paid_minutes = Math.floor((now - new Date(tbl.paid_at)) / (1000 * 60));
        }

        return {
          ...tbl,
          seated_minutes,
          check_requested_minutes,
          paid_minutes
        };
      });

      resolve(tablesWithDurations);
    });
  });
}

function seatTable(table_number, custom_name = null, customer_name = null, customer_phone = null) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tables 
      SET status = 'SEATED',
          custom_name = COALESCE(?, custom_name),
          customer_name = COALESCE(?, customer_name),
          customer_phone = COALESCE(?, customer_phone),
          seated_at = COALESCE(seated_at, CURRENT_TIMESTAMP)
      WHERE table_number = ?
    `;
    db.run(sql, [custom_name, customer_name, customer_phone, table_number], function(err) {
      if (err) return reject(err);
      logAudit(1, 'SEAT_TABLE', 'tables', table_number, 'VACANT', `SEATED: ${customer_name || ''}`);
      resolve({ success: true, table_number });
    });
  });
}

function requestTableCheck(table_number) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tables
      SET status = 'CHECK_REQUESTED',
          check_requested_at = CURRENT_TIMESTAMP
      WHERE table_number = ?
    `;
    db.run(sql, [table_number], function(err) {
      if (err) return reject(err);
      logAudit(1, 'REQUEST_CHECK', 'tables', table_number, 'SEATED', 'CHECK_REQUESTED');
      resolve({ success: true, table_number });
    });
  });
}

function vacateTable(table_number) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tables
      SET status = 'VACANT',
          custom_name = NULL,
          customer_name = NULL,
          customer_phone = NULL,
          seated_at = NULL,
          first_ordered_at = NULL,
          last_ordered_at = NULL,
          check_requested_at = NULL,
          paid_at = NULL,
          vacated_at = CURRENT_TIMESTAMP
      WHERE table_number = ?
    `;
    db.run(sql, [table_number], function(err) {
      if (err) return reject(err);
      logAudit(1, 'VACATE_TABLE', 'tables', table_number, 'PAID/SEATED', 'VACANT');
      resolve({ success: true, table_number });
    });
  });
}

function updateTableTimestampsOnOrder(table_number) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tables
      SET status = CASE WHEN status = 'VACANT' THEN 'SEATED' ELSE status END,
          seated_at = COALESCE(seated_at, CURRENT_TIMESTAMP),
          first_ordered_at = COALESCE(first_ordered_at, CURRENT_TIMESTAMP),
          last_ordered_at = CURRENT_TIMESTAMP
      WHERE table_number = ?
    `;
    db.run(sql, [table_number], function(err) {
      if (err) return reject(err);
      resolve({ success: true });
    });
  });
}

function updateTableStatusOnCheckout(table_number) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tables
      SET status = 'PAID',
          paid_at = CURRENT_TIMESTAMP
      WHERE table_number = ?
    `;
    db.run(sql, [table_number], function(err) {
      if (err) return reject(err);
      logAudit(1, 'CHECKOUT_TABLE', 'tables', table_number, 'CHECK_REQUESTED/SEATED', 'PAID');
      resolve({ success: true });
    });
  });
}

// ============================================================
// SUPPLIERS CRUD
// ============================================================
function getSuppliers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM suppliers ORDER BY name ASC`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function addSupplier(name, contactName, phone, email, address, notes) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO suppliers (name, contact_name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [name, contactName || null, phone || null, email || null, address || null, notes || null], function(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, name, contact_name: contactName, phone, email, address, notes });
    });
  });
}

function updateSupplier(id, fields) {
  return new Promise((resolve, reject) => {
    const { name, contact_name, phone, email, address, notes, is_active } = fields;
    const sql = `UPDATE suppliers SET name=COALESCE(?,name), contact_name=COALESCE(?,contact_name), phone=COALESCE(?,phone), email=COALESCE(?,email), address=COALESCE(?,address), notes=COALESCE(?,notes), is_active=COALESCE(?,is_active) WHERE id=?`;
    db.run(sql, [name||null, contact_name||null, phone||null, email||null, address||null, notes||null, is_active!==undefined?is_active:null, id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

function deleteSupplier(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE suppliers SET is_active = 0 WHERE id = ?`, [id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

// ============================================================
// MENU CATEGORIES CRUD
// ============================================================
function getMenuCategories() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM menu_categories ORDER BY sort_order ASC, id ASC`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function addMenuCategory(name, nameEn, icon, color, sortOrder) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO menu_categories (name, name_en, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [name, nameEn||null, icon||'☕', color||'#f59e0b', sortOrder||0], function(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, name, name_en: nameEn, icon, color, sort_order: sortOrder });
    });
  });
}

function updateMenuCategory(id, fields) {
  return new Promise((resolve, reject) => {
    const { name, name_en, icon, color, sort_order, is_active } = fields;
    const sql = `UPDATE menu_categories SET name=COALESCE(?,name), name_en=COALESCE(?,name_en), icon=COALESCE(?,icon), color=COALESCE(?,color), sort_order=COALESCE(?,sort_order), is_active=COALESCE(?,is_active) WHERE id=?`;
    db.run(sql, [name||null, name_en||null, icon||null, color||null, sort_order!=null?sort_order:null, is_active!=null?is_active:null, id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

function deleteMenuCategory(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE menu_categories SET is_active = 0 WHERE id = ?`, [id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

// ============================================================
// MENU ITEMS CRUD (new structured table)
// ============================================================
function getMenuItems(categoryId = null) {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT mi.*, mc.name as category_name, mc.icon as category_icon, mc.color as category_color
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE 1=1
    `;
    const params = [];
    if (categoryId) { sql += ` AND mi.category_id = ?`; params.push(categoryId); }
    sql += ` ORDER BY mi.sort_order ASC, mi.id ASC`;
    db.all(sql, params, async (err, items) => {
      if (err) return reject(err);
      // Fetch variants and addons for each item
      const result = [];
      for (const item of (items || [])) {
        const variants = await new Promise((res, rej) => {
          db.all(`SELECT * FROM item_variants WHERE menu_item_id = ?`, [item.id], (e, rows) => e ? rej(e) : res(rows || []));
        });
        const addons = await new Promise((res, rej) => {
          db.all(`SELECT * FROM item_addons WHERE menu_item_id = ?`, [item.id], (e, rows) => e ? rej(e) : res(rows || []));
        });
        result.push({ ...item, variants, addons });
      }
      resolve(result);
    });
  });
}

function addMenuItemNew(categoryId, name, nameEn, description, basePrice, department, isAvailable, isFeatured, sortOrder) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO menu_items (category_id, name, name_en, description, base_price, department, is_available, is_featured, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [categoryId||null, name, nameEn||null, description||null, Number(basePrice)||0, department||'BARISTA', isAvailable!=null?isAvailable:1, isFeatured||0, sortOrder||0], function(err) {
      if (err) return reject(err);
      const itemId = this.lastID;
      // Also sync to legacy recipes table for backward compat
      db.run(`INSERT OR IGNORE INTO recipes (menu_item_name, inventory_id, quantity_required, category, price) VALUES (?, NULL, 0, ?, ?)`,
        [name, (department||'BARISTA').toUpperCase(), Number(basePrice)||0], () => {});
      resolve({ id: itemId, name, base_price: Number(basePrice)||0 });
    });
  });
}

function updateMenuItem(id, fields) {
  return new Promise((resolve, reject) => {
    const { name, name_en, description, base_price, category_id, department, is_available, is_featured, sort_order } = fields;
    const sql = `UPDATE menu_items SET 
      name=COALESCE(?,name), name_en=COALESCE(?,name_en), description=COALESCE(?,description),
      base_price=COALESCE(?,base_price), category_id=COALESCE(?,category_id),
      department=COALESCE(?,department), is_available=COALESCE(?,is_available),
      is_featured=COALESCE(?,is_featured), sort_order=COALESCE(?,sort_order)
      WHERE id=?`;
    db.run(sql, [name||null, name_en||null, description||null, base_price!=null?base_price:null,
      category_id||null, department||null, is_available!=null?is_available:null,
      is_featured!=null?is_featured:null, sort_order!=null?sort_order:null, id], function(err) {
      if (err) return reject(err);
      // Sync price to recipes for backward compat
      if (name && base_price != null) {
        db.run(`UPDATE recipes SET price=?, category=? WHERE menu_item_name=?`, [base_price, department||'BARISTA', name], () => {});
      }
      resolve({ success: true, id });
    });
  });
}

function deleteMenuItem(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT name FROM menu_items WHERE id=?`, [id], (err, row) => {
      if (err) return reject(err);
      db.run(`DELETE FROM menu_items WHERE id = ?`, [id], function(err2) {
        if (err2) return reject(err2);
        resolve({ success: true, id });
      });
    });
  });
}

// Variant and addon management
function addItemVariant(menuItemId, name, priceDelta) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO item_variants (menu_item_id, name, price_delta) VALUES (?, ?, ?)`,
      [menuItemId, name, Number(priceDelta)||0], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, menu_item_id: menuItemId, name, price_delta: Number(priceDelta)||0 });
      });
  });
}

function deleteItemVariant(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM item_variants WHERE id = ?`, [id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

function addItemAddon(menuItemId, name, price) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO item_addons (menu_item_id, name, price) VALUES (?, ?, ?)`,
      [menuItemId, name, Number(price)||0], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, menu_item_id: menuItemId, name, price: Number(price)||0 });
      });
  });
}

function deleteItemAddon(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM item_addons WHERE id = ?`, [id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

// ============================================================
// ORDER SESSIONS
// ============================================================
function createOrderSession(orderType, tableNumber, customerPhone, notes, createdBy, deliveryAddress, deliveryFee) {
  return new Promise((resolve, reject) => {
    const type = (orderType || 'DINE_IN').toUpperCase();
    const tNum = parseInt(tableNumber, 10) || 0;
    const now = new Date();
    const ref = `${type.charAt(0)}${tNum > 0 ? tNum : '0'}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(this ? this.lastID : Math.floor(Math.random()*9999)).padStart(4,'0')}`;
    const sql = `INSERT INTO order_sessions (session_ref, order_type, table_number, customer_phone, notes, created_by, delivery_address, delivery_fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [ref, type, tNum, customerPhone||null, notes||null, createdBy||null, deliveryAddress||null, Number(deliveryFee)||0], function(err) {
      if (err) return reject(err);
      const sessionId = this.lastID;
      const finalRef = `${type.charAt(0)}${tNum > 0 ? tNum : '0'}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(sessionId).padStart(4,'0')}`;
      db.run(`UPDATE order_sessions SET session_ref=? WHERE id=?`, [finalRef, sessionId], () => {});
      resolve({ id: sessionId, session_ref: finalRef, order_type: type, table_number: tNum });
    });
  });
}

function getOrderSession(sessionId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM order_sessions WHERE id=?`, [sessionId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function closeOrderSession(sessionId) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE order_sessions SET status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?`, [sessionId], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id: sessionId });
    });
  });
}

function getOpenSessionsForTable(tableNumber) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM order_sessions WHERE table_number=? AND status='OPEN' ORDER BY id DESC`, [tableNumber], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ============================================================
// RESERVATIONS
// ============================================================
function getReservations(date) {
  return new Promise((resolve, reject) => {
    let sql = `SELECT * FROM reservations WHERE status != 'CANCELLED' ORDER BY reserved_at ASC`;
    const params = [];
    if (date) {
      sql = `SELECT * FROM reservations WHERE date(reserved_at) = date(?) AND status != 'CANCELLED' ORDER BY reserved_at ASC`;
      params.push(date);
    }
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function createReservation(customerName, customerPhone, tableNumber, partySize, reservedAt, durationMinutes, notes) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO reservations (customer_name, customer_phone, table_number, party_size, reserved_at, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [customerName, customerPhone||null, tableNumber||null, partySize||2, reservedAt, durationMinutes||90, notes||null], function(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, customer_name: customerName, reserved_at: reservedAt });
    });
  });
}

function updateReservationStatus(id, status) {
  return new Promise((resolve, reject) => {
    const validStatuses = ['CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'];
    const s = String(status).toUpperCase();
    if (!validStatuses.includes(s)) return reject(new Error('حالة الحجز غير صالحة'));
    db.run(`UPDATE reservations SET status=? WHERE id=?`, [s, id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id, status: s });
    });
  });
}

// ============================================================
// CUSTOMER CRM
// ============================================================
function getAllCustomers(search) {
  return new Promise((resolve, reject) => {
    let sql = `SELECT * FROM customers ORDER BY total_spent DESC`;
    const params = [];
    if (search) {
      sql = `SELECT * FROM customers WHERE phone LIKE ? OR name LIKE ? ORDER BY total_spent DESC`;
      params.push(`%${search}%`, `%${search}%`);
    }
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function addCustomerFeedback(customerPhone, sessionId, rating, comment, category) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO customer_feedback (customer_phone, session_id, rating, comment, category) VALUES (?, ?, ?, ?, ?)`;
    const r = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));
    db.run(sql, [customerPhone||null, sessionId||null, r, comment||null, (category||'GENERAL').toUpperCase()], function(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, customer_phone: customerPhone, rating: r, comment });
    });
  });
}

function getCustomerFeedback(customerPhone) {
  return new Promise((resolve, reject) => {
    const sql = customerPhone
      ? `SELECT * FROM customer_feedback WHERE customer_phone=? ORDER BY id DESC`
      : `SELECT * FROM customer_feedback ORDER BY id DESC LIMIT 100`;
    const params = customerPhone ? [customerPhone] : [];
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ============================================================
// PROFITABILITY REPORT (COGS per item)
// ============================================================
function getProfitabilityReport(dateRange = 'today') {
  return new Promise((resolve, reject) => {
    let dateWhere = `date(o.created_at) = date('now', 'localtime')`;
    if (dateRange === 'week') dateWhere = `date(o.created_at) >= date('now', 'localtime', '-7 days')`;
    else if (dateRange === 'month') dateWhere = `date(o.created_at) >= date('now', 'localtime', '-30 days')`;

    // Revenue per item
    const revSql = `
      SELECT o.item_name, SUM(o.quantity) as total_qty, SUM(o.quantity * o.price) as total_revenue
      FROM orders o
      WHERE ${dateWhere} AND o.status != 'VOIDED'
      GROUP BY o.item_name
      ORDER BY total_revenue DESC
    `;

    db.all(revSql, [], async (err, revenueRows) => {
      if (err) return reject(err);

      // For each item, compute COGS from recipes × inventory unit_cost
      const result = [];
      for (const item of (revenueRows || [])) {
        const cogsSql = `
          SELECT SUM(r.quantity_required * COALESCE(i.unit_cost, 0)) as unit_cogs
          FROM recipes r
          LEFT JOIN inventory i ON r.inventory_id = i.id
          WHERE r.menu_item_name = ? AND r.inventory_id IS NOT NULL
        `;
        const cogsRow = await new Promise((res, rej) => {
          db.get(cogsSql, [item.item_name], (e, row) => e ? rej(e) : res(row || { unit_cogs: 0 }));
        });
        const unitCogs = parseFloat(cogsRow.unit_cogs) || 0;
        const totalCogs = unitCogs * item.total_qty;
        const grossProfit = item.total_revenue - totalCogs;
        const margin = item.total_revenue > 0 ? Math.round((grossProfit / item.total_revenue) * 100) : 0;
        result.push({
          item_name: item.item_name,
          total_qty: item.total_qty,
          total_revenue: Math.round(item.total_revenue * 100) / 100,
          unit_cogs: Math.round(unitCogs * 100) / 100,
          total_cogs: Math.round(totalCogs * 100) / 100,
          gross_profit: Math.round(grossProfit * 100) / 100,
          margin_pct: margin
        });
      }
      resolve(result);
    });
  });
}

// ============================================================
// LOW STOCK ALERTS
// ============================================================
function getLowStockItems() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, name, current_stock, min_stock_level, unit, department, unit_cost
      FROM inventory
      WHERE min_stock_level > 0 AND current_stock <= min_stock_level
      ORDER BY (current_stock / min_stock_level) ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function updateInventorySettings(id, minStockLevel, unitCost, supplierId) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE inventory SET min_stock_level=COALESCE(?,min_stock_level), unit_cost=COALESCE(?,unit_cost), supplier_id=COALESCE(?,supplier_id) WHERE id=?`;
    db.run(sql, [minStockLevel!=null?minStockLevel:null, unitCost!=null?unitCost:null, supplierId||null, id], function(err) {
      if (err) return reject(err);
      resolve({ success: true, id });
    });
  });
}

// ============================================================
// USER MANAGEMENT CRUD
// ============================================================
function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, name, role, hourly_rate FROM users ORDER BY name ASC`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function createUser(name, role, pinCode, hourlyRate) {
  return new Promise((resolve, reject) => {
    const pinHash = bcrypt.hashSync(String(pinCode).trim(), 10);
    const sql = `INSERT INTO users (name, role, pin_hash, hourly_rate) VALUES (?, ?, ?, ?)`;
    db.run(sql, [name, role, pinHash, Number(hourlyRate)||0], function(err) {
      if (err) return reject(err);
      logAudit(null, 'CREATE_USER', 'users', this.lastID, null, { name, role });
      resolve({ id: this.lastID, name, role });
    });
  });
}

function updateUser(id, fields) {
  return new Promise((resolve, reject) => {
    const { name, role, pin_code, pin_hash, hourly_rate } = fields;
    const finalHash = pin_hash || (pin_code ? bcrypt.hashSync(String(pin_code).trim(), 10) : null);
    const sql = `UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), pin_hash=COALESCE(?,pin_hash), hourly_rate=COALESCE(?,hourly_rate) WHERE id=?`;
    db.run(sql, [name||null, role||null, finalHash, hourly_rate!=null?hourly_rate:null, id], function(err) {
      if (err) return reject(err);
      logAudit(null, 'UPDATE_USER', 'users', id, null, { name, role });
      resolve({ success: true, id });
    });
  });
}

function deleteUser(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM users WHERE id = ?`, [id], function(err) {
      if (err) return reject(err);
      logAudit(null, 'DELETE_USER', 'users', id, null, null);
      resolve({ success: true, id });
    });
  });
}

// ============================================================
// DEDICATED TABLE MANAGEMENT & LIFECYCLE HELPERS
// ============================================================
function createCustomTable(tableNumber, customName = null, zone = 'INDOOR_1', capacity = 4, customerName = null, customerPhone = null, customerId = null) {
  return new Promise((resolve, reject) => {
    const tNum = parseInt(tableNumber, 10);
    if (!tNum) return reject(new Error('رقم الطاولة مطلوب'));
    const sql = `
      INSERT INTO tables (table_number, custom_name, zone, capacity, customer_name, customer_phone, customer_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'VACANT')
      ON CONFLICT(table_number) DO UPDATE SET
        custom_name = excluded.custom_name,
        zone = excluded.zone,
        capacity = excluded.capacity,
        customer_name = excluded.customer_name,
        customer_phone = excluded.customer_phone,
        customer_id = excluded.customer_id
    `;
    db.run(sql, [tNum, customName || null, zone || 'INDOOR_1', parseInt(capacity, 10) || 4, customerName || null, customerPhone || null, customerId || null], function(err) {
      if (err) return reject(err);
      resolve({ success: true, table_number: tNum, custom_name: customName, zone, capacity });
    });
  });
}

function updateTableMetadata(tableNumber, fields = {}) {
  return new Promise((resolve, reject) => {
    const { custom_name, zone, capacity, customer_name, customer_phone, customer_id } = fields;
    const sql = `
      UPDATE tables SET
        custom_name = COALESCE(?, custom_name),
        zone = COALESCE(?, zone),
        capacity = COALESCE(?, capacity),
        customer_name = COALESCE(?, customer_name),
        customer_phone = COALESCE(?, customer_phone),
        customer_id = COALESCE(?, customer_id)
      WHERE table_number = ?
    `;
    db.run(sql, [
      custom_name !== undefined ? custom_name : null,
      zone || null,
      capacity ? parseInt(capacity, 10) : null,
      customer_name !== undefined ? customer_name : null,
      customer_phone !== undefined ? customer_phone : null,
      customer_id !== undefined ? customer_id : null,
      tableNumber
    ], function(err) {
      if (err) return reject(err);
      resolve({ success: true, table_number: tableNumber });
    });
  });
}

function updateTableLifecycleStatus(tableNumber, lifecycleState, userId = null, waiterId = null) {
  return new Promise((resolve, reject) => {
    const tNum = parseInt(tableNumber, 10);
    let updateSql = '';
    const params = [];

    switch (lifecycleState) {
      case 'OPENED':
        updateSql = `
          UPDATE tables SET 
            status = 'OPEN',
            opened_at = CURRENT_TIMESTAMP,
            seated_at = COALESCE(seated_at, CURRENT_TIMESTAMP),
            opened_by_user_id = ?,
            vacated_at = NULL
          WHERE table_number = ?
        `;
        params.push(userId, tNum);
        break;

      case 'WAITER_APPROACHED':
        updateSql = `
          UPDATE tables SET 
            status = 'APPROACHED',
            waiter_approached_at = CURRENT_TIMESTAMP,
            assigned_waiter_id = COALESCE(?, assigned_waiter_id)
          WHERE table_number = ?
        `;
        params.push(waiterId || userId, tNum);
        break;

      case 'ORDERED':
        updateSql = `
          UPDATE tables SET 
            status = 'ORDERED',
            first_ordered_at = COALESCE(first_ordered_at, CURRENT_TIMESTAMP),
            last_ordered_at = CURRENT_TIMESTAMP
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      case 'REAPPROACHED':
        updateSql = `
          UPDATE tables SET 
            status = 'REAPPROACHED',
            reapproached_at = CURRENT_TIMESTAMP
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      case 'REORDERED':
        updateSql = `
          UPDATE tables SET 
            status = 'REORDERED',
            reordered_at = CURRENT_TIMESTAMP,
            last_ordered_at = CURRENT_TIMESTAMP
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      case 'BILL_REQUESTED':
        updateSql = `
          UPDATE tables SET 
            status = 'CHECK_REQUESTED',
            check_requested_at = CURRENT_TIMESTAMP
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      case 'PAID':
        updateSql = `
          UPDATE tables SET 
            status = 'PAID',
            paid_at = CURRENT_TIMESTAMP
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      case 'VACATED':
        updateSql = `
          UPDATE tables SET 
            status = 'VACANT',
            vacated_at = CURRENT_TIMESTAMP,
            seated_at = NULL,
            opened_at = NULL,
            waiter_approached_at = NULL,
            first_ordered_at = NULL,
            last_ordered_at = NULL,
            reapproached_at = NULL,
            reordered_at = NULL,
            check_requested_at = NULL,
            paid_at = NULL,
            customer_name = NULL,
            customer_phone = NULL,
            customer_id = NULL
          WHERE table_number = ?
        `;
        params.push(tNum);
        break;

      default:
        return reject(new Error('حالة الطاولة غير معروفة: ' + lifecycleState));
    }

    db.run(updateSql, params, function(err) {
      if (err) return reject(err);
      logAudit(userId, 'UPDATE_TABLE_LIFECYCLE', 'tables', tNum, null, { lifecycleState });
      resolve({ success: true, table_number: tNum, status: lifecycleState });
    });
  });
}

function getTablesByZone(zone = 'ALL') {
  return new Promise((resolve, reject) => {
    const sql = zone && zone !== 'ALL'
      ? `SELECT * FROM tables WHERE zone = ? ORDER BY table_number ASC`
      : `SELECT * FROM tables ORDER BY table_number ASC`;
    const params = zone && zone !== 'ALL' ? [zone] : [];
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ============================================================
// RECIPE DETAILS & BOM INSTRUCTIONS
// ============================================================
function getRecipeDetails(itemName) {
  return new Promise((resolve, reject) => {
    const recipeSql = `
      SELECT r.id, r.menu_item_name, r.category, r.price, r.instructions, r.tolerance_percent,
             r.inventory_id, r.quantity_required, i.name as ingredient_name, i.unit as ingredient_unit, i.current_stock
      FROM recipes r
      LEFT JOIN inventory i ON r.inventory_id = i.id
      WHERE r.menu_item_name = ?
    `;
    db.all(recipeSql, [itemName], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) {
        // Fallback default recipe details
        return resolve({
          menu_item_name: itemName,
          category: itemName.includes('شيشة') ? 'SHISHA' : (itemName.includes('ساندوتش') ? 'KITCHEN' : 'BARISTA'),
          price: 0,
          instructions: 'تحضير الصنف حسب المعايير القياسية.',
          tolerance_percent: 5.0,
          ingredients: []
        });
      }

      const first = rows[0];
      const ingredients = rows
        .filter(r => r.inventory_id !== null)
        .map(r => ({
          inventory_id: r.inventory_id,
          name: r.ingredient_name || 'خامة أساسية',
          quantity_required: r.quantity_required,
          unit: r.ingredient_unit || 'g',
          current_stock: r.current_stock || 0
        }));

      resolve({
        menu_item_name: first.menu_item_name,
        category: first.category || 'BARISTA',
        price: first.price || 0,
        instructions: first.instructions || 'تحضير الصنف وفق المعايير القياسية مع مراعاة درجة الحرارة ونظافة المحطة.',
        tolerance_percent: first.tolerance_percent !== null ? first.tolerance_percent : 5.0,
        ingredients
      });
    });
  });
}

// ============================================================
// INTER-STATION MATERIAL TRANSFERS (إعارة وتحويل خامات)
// ============================================================
function transferMaterial(inventoryId, fromDept, toDept, quantity, notes = '', userId = null, userName = null) {
  return new Promise((resolve, reject) => {
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) return reject(new Error('الكمية المحولة غير صحيحة'));

    db.get(`SELECT name, unit, current_stock FROM inventory WHERE id = ?`, [inventoryId], (err, item) => {
      if (err || !item) return reject(err || new Error('الخامة غير موجودة بالمخزون'));

      const sql = `
        INSERT INTO material_transfers (inventory_id, item_name, from_department, to_department, quantity, unit, notes, transferred_by_user_id, transferred_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(sql, [inventoryId, item.name, fromDept, toDept, qty, item.unit, notes || null, userId, userName || null], function(err2) {
        if (err2) return reject(err2);
        const transferId = this.lastID;
        logAudit(userId, 'TRANSFER_MATERIAL', 'material_transfers', transferId, null, { fromDept, toDept, item: item.name, qty });
        resolve({
          success: true,
          id: transferId,
          item_name: item.name,
          from_department: fromDept,
          to_department: toDept,
          quantity: qty,
          unit: item.unit
        });
      });
    });
  });
}

function getMaterialTransfers(limit = 50) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM material_transfers ORDER BY id DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ============================================================
// STAFF ALLOWANCES & STAFF ORDERS
// ============================================================
function getStaffAllowances() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM staff_allowances ORDER BY role ASC`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function updateStaffAllowance(role, dailyDrinks, dailyMeals, budget = 500) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO staff_allowances (role, daily_drink_quota, daily_meal_quota, monthly_budget)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(role) DO UPDATE SET
        daily_drink_quota = excluded.daily_drink_quota,
        daily_meal_quota = excluded.daily_meal_quota,
        monthly_budget = excluded.monthly_budget
    `;
    db.run(sql, [role, parseInt(dailyDrinks, 10) || 0, parseInt(dailyMeals, 10) || 0, parseFloat(budget) || 500], function(err) {
      if (err) return reject(err);
      resolve({ success: true, role });
    });
  });
}

function getStaffRemainingQuota(staffUserId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id, name, role FROM users WHERE id = ?`, [staffUserId], (err, user) => {
      if (err || !user) return reject(err || new Error('الموظف غير موجود'));

      db.get(`SELECT * FROM staff_allowances WHERE role = ?`, [user.role], (err2, allowance) => {
        const drinkLimit = allowance ? allowance.daily_drink_quota : 2;
        const mealLimit = allowance ? allowance.daily_meal_quota : 1;

        const consumedSql = `
          SELECT 
            COALESCE(SUM(CASE WHEN r.category IN ('BARISTA', 'SHISHA') THEN o.quantity ELSE 0 END), 0) as drinks_used,
            COALESCE(SUM(CASE WHEN r.category = 'KITCHEN' THEN o.quantity ELSE 0 END), 0) as meals_used
          FROM orders o
          LEFT JOIN recipes r ON o.item_name = r.menu_item_name
          WHERE o.staff_user_id = ? 
            AND o.order_type = 'STAFF'
            AND date(o.created_at) = date('now', 'localtime')
            AND o.status != 'VOIDED'
        `;
        db.get(consumedSql, [staffUserId], (err3, consumed) => {
          const drinksUsed = consumed ? consumed.drinks_used : 0;
          const mealsUsed = consumed ? consumed.meals_used : 0;

          resolve({
            user_id: user.id,
            user_name: user.name,
            role: user.role,
            drinks_limit: drinkLimit,
            drinks_used: drinksUsed,
            drinks_remaining: Math.max(0, drinkLimit - drinksUsed),
            meals_limit: mealLimit,
            meals_used: mealsUsed,
            meals_remaining: Math.max(0, mealLimit - mealsUsed)
          });
        });
      });
    });
  });
}

async function createStaffOrder(itemName, quantity = 1, staffUserId, authorizerUserId = null, notes = '', shiftType = 'MORNING') {
  const staffMember = await new Promise((res, rej) => {
    db.get(`SELECT id, name, role FROM users WHERE id = ?`, [staffUserId], (e, r) => e ? rej(e) : res(r));
  });
  if (!staffMember) throw new Error('الموظف غير موجود');

  const quota = await getStaffRemainingQuota(staffUserId);
  const category = await getItemCategory(itemName);
  const isMeal = category === 'KITCHEN';

  if (isMeal && (quota.meals_remaining < quantity)) {
    throw new Error(`تجاوز حد الوجبات اليومية المسموحة للموظف (${quota.meals_used}/${quota.meals_limit})`);
  }
  if (!isMeal && (quota.drinks_remaining < quantity)) {
    throw new Error(`تجاوز حد المشروبات اليومية المسموحة للموظف (${quota.drinks_used}/${quota.drinks_limit})`);
  }

  // Create order with 0 price for staff hospitality
  const order = await createOrderWithBOM(itemName, quantity, 0, 0, null, null, null, {
    order_type: 'STAFF',
    item_notes: `طلب موظف: ${staffMember.name} (${staffMember.role}) - ${notes || ''}`,
    staff_user_id: staffUserId,
    user_id: authorizerUserId,
    user_name: staffMember.name,
    shift_type: shiftType
  });

  logAudit(authorizerUserId, 'STAFF_ORDER', 'orders', order.id, null, { staff: staffMember.name, item: itemName, qty: quantity });
  return order;
}

// ============================================================
// EXPECTED BOM vs ACTUAL BOM RECONCILIATION
// ============================================================
function getBOMVarianceReport(period = 'today') {
  return new Promise((resolve, reject) => {
    let dateWhere = `date(o.created_at) = date('now', 'localtime')`;
    let wasteWhere = `date(w.created_at) = date('now', 'localtime')`;
    let purchWhere = `date(p.created_at) = date('now', 'localtime')`;

    if (period === 'week') {
      dateWhere = `date(o.created_at) >= date('now', 'localtime', '-7 days')`;
      wasteWhere = `date(w.created_at) >= date('now', 'localtime', '-7 days')`;
      purchWhere = `date(p.created_at) >= date('now', 'localtime', '-7 days')`;
    } else if (period === 'month') {
      dateWhere = `date(o.created_at) >= date('now', 'localtime', '-30 days')`;
      wasteWhere = `date(w.created_at) >= date('now', 'localtime', '-30 days')`;
      purchWhere = `date(p.created_at) >= date('now', 'localtime', '-30 days')`;
    }

    const sql = `
      SELECT 
        i.id as inventory_id,
        i.name as item_name,
        i.unit,
        i.department,
        i.current_stock,
        COALESCE(i.unit_cost, 0) as unit_cost,
        COALESCE(SUM(r.quantity_required * o.quantity), 0) as theoretical_usage,
        COALESCE(SUM((r.quantity_required * o.quantity) * (COALESCE(r.tolerance_percent, 5.0) / 100.0)), 0) as allowed_production_buffer
      FROM inventory i
      LEFT JOIN recipes r ON i.id = r.inventory_id
      LEFT JOIN orders o ON r.menu_item_name = o.item_name AND ${dateWhere} AND o.status != 'VOIDED'
      GROUP BY i.id, i.name
    `;

    db.all(sql, [], async (err, rows) => {
      if (err) return reject(err);

      const result = [];
      for (const row of (rows || [])) {
        // Fetch logged waste for this item in period
        const wasteRow = await new Promise((res) => {
          db.get(`SELECT COALESCE(SUM(quantity), 0) as waste_qty FROM waste_log w WHERE w.inventory_id = ? AND ${wasteWhere}`, [row.inventory_id], (e, r) => res(r || { waste_qty: 0 }));
        });
        const wasteQty = parseFloat(wasteRow.waste_qty) || 0;

        // Fetch purchases for this item in period
        const purchRow = await new Promise((res) => {
          db.get(`SELECT COALESCE(SUM(qty_added), 0) as purch_qty FROM purchases p WHERE p.inventory_id = ? AND ${purchWhere}`, [row.inventory_id], (e, r) => res(r || { purch_qty: 0 }));
        });
        const purchQty = parseFloat(purchRow.purch_qty) || 0;

        const theoUsage = parseFloat(row.theoretical_usage) || 0;
        const allowedBuffer = parseFloat(row.allowed_production_buffer) || 0;
        const expectedTotalConsumption = theoUsage + allowedBuffer;
        const varianceQty = wasteQty > allowedBuffer ? (wasteQty - allowedBuffer) : 0;
        const varianceCost = varianceQty * row.unit_cost;

        result.push({
          inventory_id: row.inventory_id,
          name: row.item_name,
          unit: row.unit,
          department: row.department,
          unit_cost: row.unit_cost,
          current_stock: row.current_stock,
          purchased_in_period: Math.round(purchQty * 100) / 100,
          theoretical_usage: Math.round(theoUsage * 100) / 100,
          allowed_production_buffer: Math.round(allowedBuffer * 100) / 100,
          logged_waste: Math.round(wasteQty * 100) / 100,
          expected_total_deduction: Math.round(expectedTotalConsumption * 100) / 100,
          variance_qty: Math.round(varianceQty * 100) / 100,
          variance_cost: Math.round(varianceCost * 100) / 100,
          efficiency_pct: expectedTotalConsumption > 0 ? Math.min(100, Math.round((theoUsage / (theoUsage + wasteQty || 1)) * 100)) : 100
        });
      }

      resolve(result);
    });
  });
}

// ============================================================
// EXPECTED CASH DRAWER vs ACTUAL RECONCILIATION
// ============================================================
function getExpectedCashForShift(shiftType = 'MORNING', date = null) {
  return new Promise((resolve, reject) => {
    const dateFilter = date ? `date('${date}')` : `date('now', 'localtime')`;

    // 1. Cash sales in shift
    const cashSalesSql = `
      SELECT COALESCE(SUM(op.amount), 0) as total_cash_sales
      FROM order_payments op
      JOIN orders o ON op.order_id = o.id
      WHERE op.method = 'CASH' 
        AND date(op.created_at) = ${dateFilter}
        AND (o.shift_type = ? OR ? = 'ALL')
        AND o.status != 'VOIDED'
    `;

    // 2. Advances & expenses in shift
    const advancesSql = `SELECT COALESCE(SUM(amount), 0) as total_advances FROM employee_advances WHERE date(issued_at) = ${dateFilter}`;
    const expensesSql = `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM daily_expenses WHERE date(expense_date) = ${dateFilter}`;

    db.get(cashSalesSql, [shiftType, shiftType], (err, salesRow) => {
      if (err) return reject(err);
      const cashSales = parseFloat(salesRow ? salesRow.total_cash_sales : 0);

      db.get(advancesSql, [], (err2, advRow) => {
        const advances = parseFloat(advRow ? advRow.total_advances : 0);

        db.get(expensesSql, [], (err3, expRow) => {
          const expenses = parseFloat(expRow ? expRow.total_expenses : 0);
          const openingFloat = shiftType === 'MORNING' ? 500 : 1000; // Standard float
          const expectedCash = openingFloat + cashSales - advances - expenses;

          resolve({
            shift_type: shiftType,
            date: date || new Date().toISOString().slice(0, 10),
            opening_float: openingFloat,
            cash_sales: cashSales,
            cash_advances: advances,
            cash_expenses: expenses,
            expected_cash_drawer: expectedCash
          });
        });
      });
    });
  });
}

function declareCashExtended(userId, userName, shiftType, declaredCash, openingFloat = 500, managerPin = null, notes = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const calc = await getExpectedCashForShift(shiftType);
      const expectedAmount = calc.expected_cash_drawer;
      const declared = parseFloat(declaredCash) || 0;
      const variance = declared - expectedAmount;

      let managerApproved = null;
      if (managerPin) {
        const mgr = await loginWithPin(managerPin);
        if (mgr && (mgr.role === 'MANAGER' || mgr.role === 'OP_MANAGER' || mgr.role === 'OWNER' || mgr.role === 'ADMIN')) {
          managerApproved = mgr.id;
        }
      }

      const sql = `
        INSERT INTO drawer_declarations (
          user_id, user_name, declared_amount, expected_amount, variance, 
          opening_float, cash_sales, cash_advances, cash_expenses, shift_type, status, manager_approved_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?)
      `;
      db.run(sql, [
        userId, userName, declared, expectedAmount, variance,
        calc.opening_float, calc.cash_sales, calc.cash_advances, calc.cash_expenses, shiftType, managerApproved
      ], function(err) {
        if (err) return reject(err);
        const declId = this.lastID;
        logAudit(userId, 'EXTENDED_DRAWER_CLOSE', 'drawer_declarations', declId, null, {
          shiftType, declared, expectedAmount, variance
        });
        resolve({
          id: declId,
          shift_type: shiftType,
          declared_amount: declared,
          expected_amount: expectedAmount,
          variance: variance,
          variance_status: variance === 0 ? 'MATCH' : (variance > 0 ? 'OVER' : 'SHORT'),
          manager_approved: !!managerApproved
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

function getSystemConfig() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT key, value FROM system_config`, [], (err, rows) => {
      if (err) return reject(err);
      const config = {
        currency: 'ج.م',
        vat_percent: 14,
        service_percent: 12,
        apply_taxes: true,
        printer_ip: '192.168.1.100',
        printer_port: 9100,
        cafe_name: 'كافيه مزاج',
        cash_drawer_auto_kick: true,
        header_note: 'أهلاً بكم في كافيه مزاج',
        footer_note: 'شكراً لزيارتكم - نتمنى لكم يوماً سعيداً'
      };
      (rows || []).forEach(r => {
        if (r.key === 'vat_percent' || r.key === 'service_percent' || r.key === 'printer_port') {
          config[r.key] = parseFloat(r.value) || 0;
        } else if (r.key === 'apply_taxes' || r.key === 'cash_drawer_auto_kick') {
          config[r.key] = r.value === 'true' || r.value === '1';
        } else {
          config[r.key] = r.value;
        }
      });
      resolve(config);
    });
  });
}

function updateSystemConfig(configObj = {}) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const stmt = db.prepare(`INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`);
      for (const [key, value] of Object.entries(configObj)) {
        if (value !== undefined && value !== null) {
          stmt.run(String(key), String(value));
        }
      }
      stmt.finalize((err) => {
        if (err) return reject(err);
        getSystemConfig().then(resolve).catch(reject);
      });
    });
  });
}

function factoryResetDatabase(adminPin) {
  return new Promise(async (resolve, reject) => {
    try {
      const user = await loginWithPin(adminPin);
      if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
        return reject(new Error('رمز PIN غير مصرح به لإجراء إعادة ضبط المصنع'));
      }

      db.serialize(() => {
        db.run('DELETE FROM orders');
        db.run('DELETE FROM order_payments');
        db.run('DELETE FROM table_sessions');
        db.run('DELETE FROM waste_log');
        db.run('DELETE FROM material_transfers');
        db.run('DELETE FROM penalties');
        db.run('DELETE FROM complaints');
        db.run('DELETE FROM drawer_declarations');
        db.run('DELETE FROM employee_advances');
        db.run('DELETE FROM daily_expenses');
        db.run('DELETE FROM shifts');
        db.run('DELETE FROM customer_feedback');
        db.run('DELETE FROM customers');
        db.run('DELETE FROM purchases');
        db.run('DELETE FROM reservations');
        db.run('DELETE FROM shareholder_transactions');
        db.run(`UPDATE tables SET status = 'VACANT', custom_name = NULL, customer_name = NULL, customer_phone = NULL`);
        db.run(`UPDATE inventory SET current_stock = 1000`);
        
        logAudit(user.id, 'FACTORY_RESET', 'system', 0, null, { reset_by: user.name, timestamp: new Date().toISOString() });
        resolve({ success: true, message: 'تمت إعادة ضبط المصنع ومسح كافة البيانات بنجاح' });
      });
    } catch (e) {
      reject(e);
    }
  });
}

function getUserShiftReport(userId, shiftType = 'MORNING') {
  return new Promise((resolve, reject) => {
    // 1. Fetch user info
    db.get(`SELECT id, name, role FROM users WHERE id = ?`, [userId], (err, user) => {
      if (err) return reject(err);
      if (!user) return reject(new Error('المستخدم غير موجود'));

      // 2. Fetch latest active or today's shift clock-in
      db.get(
        `SELECT id, clock_in, clock_out, shift_type FROM shifts WHERE user_id = ? AND date(clock_in) = date('now', 'localtime') ORDER BY id DESC LIMIT 1`,
        [userId],
        (err, shiftRow) => {
          if (err) return reject(err);

          const clockInTime = shiftRow?.clock_in || (new Date().toISOString().split('T')[0] + ' 00:00:00');
          const clockOutTime = shiftRow?.clock_out || null;
          const activeShift = shiftType || shiftRow?.shift_type || 'MORNING';

          // 3. Aggregate cash & digital sales specifically for orders handled by this user since clockInTime
          const salesSql = `
            SELECT 
              COALESCE(SUM(CASE WHEN op.method = 'CASH' THEN op.amount ELSE 0 END), 0) as cash_sales,
              COALESCE(SUM(CASE WHEN op.method != 'CASH' THEN op.amount ELSE 0 END), 0) as digital_sales,
              COALESCE(SUM(op.amount), 0) as total_sales,
              COALESCE(SUM(op.tip_amount), 0) as total_tips,
              COUNT(DISTINCT o.id) as order_count
            FROM order_payments op
            JOIN orders o ON op.order_id = o.id
            WHERE (o.user_id = ? OR o.waiter_id = ? OR (o.user_name = ? AND o.user_name IS NOT NULL))
              AND op.created_at >= ?
          `;
          db.get(salesSql, [userId, userId, user.name, clockInTime], (err, salesRow) => {
            if (err) return reject(err);

            const cashSales = salesRow?.cash_sales || 0;
            const digitalSales = salesRow?.digital_sales || 0;
            const totalSales = salesRow?.total_sales || 0;
            const totalTips = salesRow?.total_tips || 0;
            const orderCount = salesRow?.order_count || 0;

            // 4. Advances and expenses logged today
            const advSql = `SELECT COALESCE(SUM(amount), 0) as total_advances FROM employee_advances WHERE (employee_name = ? OR (employee_id IS NOT NULL AND employee_id = ?)) AND date(issued_at) = date('now', 'localtime')`;
            db.get(advSql, [user.name, userId], (err, advRow) => {
              if (err) return reject(err);
              const cashAdvances = advRow?.total_advances || 0;

              const expSql = `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM daily_expenses WHERE date(created_at) = date('now', 'localtime')`;
              db.get(expSql, [], (err, expRow) => {
                if (err) return reject(err);
                const cashExpenses = expRow?.total_expenses || 0;

                const openingFloat = 500.0;
                const expectedCash = openingFloat + cashSales - cashAdvances - cashExpenses;

                resolve({
                  user_id: user.id,
                  user_name: user.name,
                  user_role: user.role,
                  shift_id: shiftRow?.id || null,
                  clock_in: clockInTime,
                  clock_out: clockOutTime,
                  shift_type: activeShift,
                  opening_float: openingFloat,
                  cash_sales: cashSales,
                  digital_sales: digitalSales,
                  total_sales: totalSales,
                  total_tips: totalTips,
                  cash_advances: cashAdvances,
                  cash_expenses: cashExpenses,
                  expected_cash: Math.max(0, expectedCash),
                  order_count: orderCount,
                  generated_at: new Date().toLocaleString('ar-EG')
                });
              });
            });
          });
        }
      );
    });
  });
}

module.exports = {
  db,
  getSystemConfig,
  updateSystemConfig,
  factoryResetDatabase,
  getUserShiftReport,
  getMenu,
  addMenuItem,
  updateMenuBulk,
  getPendingOrders,
  createOrderWithBOM,
  completeOrder,
  getInventory,
  getItemCategory,
  getOpenTableSessions,
  openTableSession,
  closeTableSession,
  getTableOrders,
  logWaste,
  getPastOrdersToday,
  saveOrderPayments,
  logEmployeeAdvance,
  getTodayAdvances,
  logDailyExpense,
  getTodayExpenses,
  getEodReport,
  getCustomer,
  addOrUpdateCustomer,
  moveTableSession,
  logShareholderTransaction,
  getShareholderLedger,
  getBIData,
  loginWithPin,
  logPurchase,
  getPurchasesHistory,
  clockInUser,
  clockOutUser,
  getActiveShifts,
  getUserShiftStatus,
  getTotalTipsPool,
  voidOrder,
  declareCash,
  declareCashExtended,
  getDrawerDeclarations,
  logAudit,
  getAuditLogs,
  updateKdsStatus,
  requestOrderCancellation,
  resolveOrderCancellation,
  updateUserHourlyRate,
  logPenalty,
  getPenalties,
  getPayrollData,
  logComplaint,
  getComplaints,
  resolveComplaint,
  getAllTables,
  createCustomTable,
  updateTableMetadata,
  updateTableLifecycleStatus,
  getTablesByZone,
  seatTable,
  requestTableCheck,
  vacateTable,
  updateTableTimestampsOnOrder,
  updateTableStatusOnCheckout,
  getRecipeDetails,
  transferMaterial,
  getMaterialTransfers,
  getStaffAllowances,
  updateStaffAllowance,
  getStaffRemainingQuota,
  createStaffOrder,
  getBOMVarianceReport,
  getExpectedCashForShift,
  // Existing exports
  getWasteLogs,
  getSuppliers, addSupplier, updateSupplier, deleteSupplier,
  getMenuCategories, addMenuCategory, updateMenuCategory, deleteMenuCategory,
  getMenuItems, addMenuItemNew, updateMenuItem, deleteMenuItem,
  addItemVariant, deleteItemVariant, addItemAddon, deleteItemAddon,
  createOrderSession, getOrderSession, closeOrderSession, getOpenSessionsForTable,
  getReservations, createReservation, updateReservationStatus,
  getAllCustomers, addCustomerFeedback, getCustomerFeedback,
  getProfitabilityReport, getLowStockItems, updateInventorySettings,
  getAllUsers, createUser, updateUser, deleteUser
};




