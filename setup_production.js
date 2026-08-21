/**
 * setup_production.js
 * Production Initialization & Seeding Script for كافيه مزاج (Mazaj Cafe ERP)
 */

const { db, updateSystemConfig } = require('./database');

console.log('🚀 Running Mazaj Production Data Initialization...');

const staffMembers = [
  { name: 'عمر (مسؤول نظام)', role: 'SUPER_ADMIN', pin_code: '1011', hourly_rate: 100 },
  { name: 'فاطمة (مالك)', role: 'OWNER', pin_code: '1009', hourly_rate: 150 },
  { name: 'وائل 2 (مالك)', role: 'OWNER', pin_code: '1010', hourly_rate: 150 },
  { name: 'وائل (مدير عمليات)', role: 'OP_MANAGER', pin_code: '1008', hourly_rate: 80 },
  { name: 'شعراوي (مدير تكاليف BOM)', role: 'BOM_MANAGER', pin_code: '1012', hourly_rate: 75 },
  { name: 'أحمد كركر (كاشير)', role: 'OP_ASSISTANT_CASHIER', pin_code: '1007', hourly_rate: 45 },
  { name: 'إبراهيم (مدير صالة)', role: 'HALL_MANAGER', pin_code: '1006', hourly_rate: 55 },
  { name: 'أحمد (جوكر/ويتر)', role: 'JOKER', pin_code: '1001', hourly_rate: 40 },
  { name: 'هاجر/بيبو (باريستا)', role: 'BARISTA', pin_code: '1002', hourly_rate: 50 },
  { name: 'أسماء (مسؤول شيشة)', role: 'SHIASH', pin_code: '1003', hourly_rate: 45 },
  { name: 'شيف المطبخ', role: 'CHEF', pin_code: '1004', hourly_rate: 60 },
  { name: 'أمل (ويتر)', role: 'WAITER', pin_code: '1005', hourly_rate: 40 }
];

db.serialize(async () => {
  // 1. Seed & Update Staff PINs
  const stmt = db.prepare(`
    INSERT INTO users (name, role, pin_code, hourly_rate) 
    VALUES (?, ?, ?, ?) 
    ON CONFLICT(pin_code) DO UPDATE SET 
      name = excluded.name, 
      role = excluded.role, 
      hourly_rate = excluded.hourly_rate
  `);

  staffMembers.forEach(s => {
    stmt.run(s.name, s.role, s.pin_code, s.hourly_rate);
  });
  stmt.finalize();
  console.log('✅ 12 Production Staff accounts seeded & synchronized.');

  // 2. Initialize System Configuration
  await updateSystemConfig({
    cafe_name: 'كافيه مزاج',
    currency: 'ج.م',
    vat_percent: 14,
    service_percent: 12,
    apply_taxes: true,
    printer_ip: '192.168.1.100',
    printer_port: 9100,
    cash_drawer_auto_kick: true,
    header_note: 'أهلاً بكم في كافيه مزاج',
    footer_note: 'شكراً لزيارتكم - نتمنى لكم يوماً سعيداً'
  });
  console.log('✅ Global System & Taxation Configuration initialized.');

  console.log('\n🎉 Mazaj Production Setup Complete! Everything is ready for operation.');
});
