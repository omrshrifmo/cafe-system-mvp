const http = require('http');

function request(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: method,
      headers: reqHeaders
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting Comprehensive MENA Cafe ERP Architecture Test Suite...\n');
  await new Promise(r => setTimeout(r, 1500));
  let passed = 0;
  let total = 0;

  async function assert(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`❌ [FAIL] ${name}:`, e.message);
    }
  }

  // 1. Test GET & POST /api/config
  await assert('Global Configuration GET /api/config', async () => {
    const res = await request('GET', '/api/config');
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    const c = res.json.config;
    if (c.currency === undefined || c.vat_percent === undefined || c.service_percent === undefined) {
      throw new Error('Config missing core keys: ' + JSON.stringify(c));
    }
  });

  await assert('Global Configuration POST /api/config', async () => {
    const res = await request('POST', '/api/config', {
      cafe_name: 'كافيه مزاج الذهب',
      currency: 'ج.م',
      vat_percent: 14,
      service_percent: 12,
      apply_taxes: true,
      printer_ip: '192.168.1.100',
      printer_port: 9100,
      cash_drawer_auto_kick: true
    });
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    if (res.json.config.cafe_name !== 'كافيه مزاج الذهب') throw new Error('Config not updated');
  });

  // 2. Test Dynamic Taxation Engine in POST /api/checkout
  await assert('Dynamic Taxation Engine in POST /api/checkout', async () => {
    // Checkout with Subtotal = 100
    // Service = 12% -> 12
    // Taxable Base = 112
    // VAT = 14% on 112 -> 15.68
    // Total = 127.68
    const res = await request('POST', '/api/checkout', {
      table_number: 1,
      subtotal: 100,
      payments: [{ method: 'CASH', amount: 127.68 }],
      customer_phone: '01012345678',
      points_redeemed: 0,
      tip_amount: 0,
      cashier_name: 'كاشير التجربة'
    });
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    const tb = res.json.tax_breakdown;
    if (!tb) throw new Error('Missing tax_breakdown in checkout response');
    if (tb.subtotal !== 100) throw new Error(`Expected subtotal 100, got ${tb.subtotal}`);
    if (tb.service_amount !== 12) throw new Error(`Expected service 12, got ${tb.service_amount}`);
    if (tb.vat_amount !== 15.68) throw new Error(`Expected VAT 15.68, got ${tb.vat_amount}`);
  });

  // 3. Test Hardware Print Bridge
  await assert('Hardware Print Bridge: POST /api/print/receipt', async () => {
    const res = await request('POST', '/api/print/receipt', {
      order_id: 101,
      table_number: 1,
      cashier_name: 'أحمد الكاشير',
      subtotal: 100,
      service_amount: 12,
      vat_amount: 15.68,
      total_amount: 127.68,
      items: [{ item_name: 'قهوة اسبريسو', quantity: 2, price: 50 }],
      payments: [{ method: 'CASH', amount: 127.68 }]
    });
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    if (!res.json.result) throw new Error('Missing print result');
  });

  await assert('Hardware Print Bridge: POST /api/print/kitchen', async () => {
    const res = await request('POST', '/api/print/kitchen', {
      order_id: 102,
      table_number: 3,
      department: 'البار والقهوة',
      items: [{ item_name: 'قهوة تركي محوج', quantity: 1, sugar_level: 'مظبوط', roast_type: 'محوج' }]
    });
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
  });

  await assert('Hardware Print Bridge: POST /api/print/test', async () => {
    const res = await request('POST', '/api/print/test');
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
  });

  // 4. Test Shift Z-Reports vs. Day EOD
  await assert('Shift Z-Report Endpoint: GET /api/shifts/z-report/:userId', async () => {
    const res = await request('GET', '/api/shifts/z-report/1?shift_type=MORNING');
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    const r = res.json.report;
    if (r.opening_float === undefined || r.cash_sales === undefined || r.expected_cash === undefined) {
      throw new Error('Incomplete Shift Z-Report data: ' + JSON.stringify(r));
    }
  });

  await assert('Shift Close with Extended Drawer & Auto Z-Report: POST /api/drawer/declare-extended', async () => {
    const res = await request('POST', '/api/drawer/declare-extended', {
      user_id: 1,
      user_name: 'كاشير وردية الصباح',
      shift_type: 'MORNING',
      actual_cash: 627.68,
      opening_float: 500
    });
    if (res.status !== 200 || !res.json.success) throw new Error(`HTTP ${res.status}: ${res.body}`);
    if (res.json.declaration.variance === undefined) throw new Error('Missing variance in declaration response');
  });

  // 5. Test PWA Files and Static Assets
  await assert('PWA Manifest: GET /manifest.json', async () => {
    const res = await request('GET', '/manifest.json');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (!res.json.name || res.json.display !== 'standalone') throw new Error('Invalid manifest content');
  });

  await assert('PWA Service Worker: GET /sw.js', async () => {
    const res = await request('GET', '/sw.js');
    if (res.status !== 200 || !res.body.includes('CACHE_NAME')) throw new Error(`HTTP ${res.status}: invalid sw.js`);
  });

  await assert('Owner Settings Panel: GET /settings.html', async () => {
    const res = await request('GET', '/settings.html');
    if (res.status !== 200 || !res.body.includes('إعدادات النظام والضرائب')) throw new Error(`HTTP ${res.status}: settings page not loaded`);
  });

  // 6. Test Database Indexes
  await assert('Database Performance Indexes Verification', async () => {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const db = new sqlite3.Database(path.join(__dirname, '../cafe.db'));
    
    await new Promise((resolve, reject) => {
      db.all(`SELECT name FROM sqlite_master WHERE type='index'`, [], (err, rows) => {
        if (err) return reject(err);
        const indexNames = rows.map(r => r.name);
        const expected = ['idx_orders_created_at', 'idx_orders_kds_status', 'idx_audit_logs_created_at', 'idx_shifts_user_id'];
        for (const exp of expected) {
          if (!indexNames.includes(exp)) {
            return reject(new Error(`Index ${exp} missing from database`));
          }
        }
        resolve();
      });
    });
  });

  console.log(`\n========================================`);
  console.log(`🎯 Test Results: ${passed} / ${total} Passed (${Math.round((passed/total)*100)}%)`);
  console.log(`========================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Fatal Test Runner Error:', e);
  process.exit(1);
});
