/**
 * Mazaj Cafe ERP — Production Database & Staff Seeding Script
 * Seeds the exact Mazaj staff hierarchy (PIN 1001-1012), venue defaults, and system configuration.
 */
'use strict';
const path = require('path');
const { getDb, runQuery, allQuery } = require('../src/db/connection');
const { runMigrations } = require('../src/db/migrator');
const { hashPin } = require('../src/domain/auth/service');
const logger = require('../src/observability/logger');

const MAZAJ_STAFF = [
  { id: '35', name: 'أحمد (ويتر/جوكر)', role: 'R_WAITER', legacyRole: 'JOKER', pin: '1001', hourly_rate: 25 },
  { id: '36', name: 'هاجر بيبو (باريستا)', role: 'R_BARISTA', legacyRole: 'BARISTA', pin: '1002', hourly_rate: 30 },
  { id: '37', name: 'أسماء (مسؤول شيشة)', role: 'R_SHISHA', legacyRole: 'SHIASH', pin: '1003', hourly_rate: 25 },
  { id: '38', name: 'الشيف (شيف المطبخ)', role: 'R_CHEF', legacyRole: 'CHEF', pin: '1004', hourly_rate: 35 },
  { id: '39', name: 'أمل (ويتر)', role: 'R_WAITER', legacyRole: 'WAITER', pin: '1005', hourly_rate: 25 },
  { id: '40', name: 'إبراهيم (مدير صالة)', role: 'R_HALL_MANAGER', legacyRole: 'HALL_MANAGER', pin: '1006', hourly_rate: 35 },
  { id: '41', name: 'أحمد كركر (كاشير ومساعد مدير عمليات)', role: 'R_OP_ASSISTANT_CASHIER', legacyRole: 'OP_ASSISTANT_CASHIER', pin: '1007', hourly_rate: 40 },
  { id: '42', name: 'وائل (مدير عمليات)', role: 'R_OP_MANAGER', legacyRole: 'OP_MANAGER', pin: '1008', hourly_rate: 50 },
  { id: '43', name: 'فاطمة (مالك)', role: 'R_OWNER', legacyRole: 'OWNER', pin: '1009', hourly_rate: 0 },
  { id: '44', name: 'وائل 2 (مالك)', role: 'R_OWNER', legacyRole: 'OWNER', pin: '1010', hourly_rate: 0 },
  { id: '45', name: 'عمر (مسؤول نظام)', role: 'R_SUPER_ADMIN', legacyRole: 'SUPER_ADMIN', pin: '1011', hourly_rate: 0 },
  { id: '46', name: 'شعراوي (مدير تكاليف BOM)', role: 'R_BOM_MANAGER', legacyRole: 'BOM_MANAGER', pin: '1012', hourly_rate: 45 }
];

async function setupProduction() {
  console.log('🚀 Initializing Mazaj OS Production Setup...');
  
  // 1. Run all SQLite Migrations
  await runMigrations();
  console.log('✅ Migrations applied cleanly.');

  // 2. Deactivate obsolete dummy test fixtures
  const dummyHash = await hashPin('999999');
  await runQuery(`UPDATE v3_users SET is_active = 0, pin_hash = ? WHERE id IN ('1','2','3','4','5','6','7','8','9','10','11','12','201','202','203','204','301','302')`, [dummyHash]);
  await runQuery(`UPDATE users SET is_active = 0, pin_hash = ? WHERE id IN (1,2,3,4,5,6,7,8,9,10,11,12,201,202,203,204,301,302)`, [dummyHash]);

  // 3. Seed exact 12 staff members
  console.log('👥 Seeding Mazaj Staff Hierarchy (1001-1012)...');
  for (const staff of MAZAJ_STAFF) {
    const pinHash = await hashPin(staff.pin);
    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
       VALUES (?, 'V_DEFAULT', ?, ?, ?, 1)`,
      [staff.id, staff.name, staff.role, pinHash]
    );
    await runQuery(
      `INSERT OR REPLACE INTO users (id, name, role, pin_hash, hourly_rate, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [parseInt(staff.id, 10), staff.name, staff.legacyRole, pinHash, staff.hourly_rate]
    );
  }
  console.log('✅ 12 Staff members seeded with bcrypt PIN hashes.');

  // 4. Seed system configuration
  await runQuery(
    `INSERT OR REPLACE INTO system_config (key, value) VALUES 
     ('cafe_name', 'كافيه مزاج'),
     ('onboarding_state', 'COMPLETE'),
     ('vat_rate', '14'),
     ('service_rate', '12'),
     ('currency', 'ج.م'),
     ('printer_ip', '192.168.1.200'),
     ('printer_port', '9100'),
     ('printer_interface', 'network'),
     ('cash_drawer_auto_kick', 'true'),
     ('inactivity_limit_ms', '15000')`
  );
  console.log('✅ System configuration set (VAT 14%, Service 12%, Currency ج.م, Auto-Lock 15s).');

  // 5. Ensure tables exist
  const existingTables = await allQuery(`SELECT COUNT(*) as count FROM tables`);
  if (!existingTables || existingTables[0].count === 0) {
    for (let i = 1; i <= 20; i++) {
      const zone = i <= 6 ? 'Indoor Hall 1' : i <= 12 ? 'Indoor Hall 2' : 'Outdoor Terrace';
      await runQuery(
        `INSERT INTO tables (table_number, custom_name, zone, capacity, status, guest_count)
         VALUES (?, ?, ?, 4, 'AVAILABLE', 0)`,
        [i, `طاولة ${i}`, zone]
      );
    }
    await runQuery(
      `INSERT INTO tables (table_number, custom_name, zone, capacity, status, guest_count)
       VALUES (99, 'طاولة 99 - صالة كبار الشخصيات VIP', 'VIP Lounge', 12, 'AVAILABLE', 0)`
    );
    console.log('✅ 21 Hospitality Tables seeded.');
  }

  console.log('🎯 Production Setup Complete! Mazaj OS is 100% operational.');
}

if (require.main === module) {
  setupProduction()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Production Setup Failed:', err);
      process.exit(1);
    });
}

module.exports = { setupProduction, MAZAJ_STAFF };
