/**
 * Entertainment, Gaming Consoles & Rentable Resources Domain Service
 * Manages PlayStation, Xbox, Billiards sessions, and MikroTik Hotspot WiFi Vouchers.
 */
'use strict';

const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');
const logger = require('../../observability/logger');

/**
 * Get all rentable resources with active session status
 */
async function getRentableResources() {
  const resources = await allQuery(`
    SELECT r.*, 
           s.id as active_session_id,
           s.started_at as session_started_at,
           s.player_mode,
           s.table_number,
           s.hourly_rate as current_hourly_rate
    FROM rentable_resources r
    LEFT JOIN entertainment_sessions s ON r.current_session_id = s.id AND s.status = 'ACTIVE'
    ORDER BY r.id ASC
  `);

  return resources.map(res => {
    let elapsedMinutes = 0;
    let currentCost = 0;
    if (res.active_session_id && res.session_started_at) {
      const start = new Date(res.session_started_at).getTime();
      const now = Date.now();
      elapsedMinutes = Math.max(1, Math.round((now - start) / 60000));
      const rate = res.current_hourly_rate || (res.player_mode === 'MULTI' ? res.hourly_rate_multi : res.hourly_rate_single);
      currentCost = Math.round((elapsedMinutes / 60) * rate * 100) / 100;
    }

    return {
      ...res,
      elapsed_minutes: elapsedMinutes,
      current_cost: currentCost
    };
  });
}

/**
 * Start a new entertainment rental session
 */
async function startEntertainmentSession(resourceId, { table_number, player_mode = 'SINGLE', notes }, actor = null) {
  return runTransaction(async (tx) => {
    const resource = await tx.get(`SELECT * FROM rentable_resources WHERE id = ?`, [resourceId]);
    if (!resource) throw new Error('NOT_FOUND: جهاز الترفيه غير موجود');
    if (resource.status === 'IN_USE') throw new Error('CONFLICT: الجهاز قيد الاستخدام حالياً');

    const hourlyRate = player_mode.toUpperCase() === 'MULTI' ? resource.hourly_rate_multi : resource.hourly_rate_single;

    const sessionId = `ENT-${Date.now()}`;

    await tx.run(
      `INSERT INTO entertainment_sessions (id, resource_id, table_number, player_mode, started_at, hourly_rate, status, created_by, notes)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'), ?, 'ACTIVE', ?, ?)`,
      [sessionId, resourceId, table_number || null, player_mode.toUpperCase(), hourlyRate, actor ? actor.id : null, notes || null]
    );

    await tx.run(
      `UPDATE rentable_resources SET status = 'IN_USE', current_session_id = ? WHERE id = ?`,
      [sessionId, resourceId]
    );

    logger.info('Entertainment session started', { resourceId, sessionId, table_number, player_mode });

    return {
      success: true,
      message: `تم بدء تشغيل ${resource.name} بنجاح 🎮`,
      session_id: sessionId,
      resource_name: resource.name,
      hourly_rate: hourlyRate,
      started_at: new Date().toISOString()
    };
  });
}

/**
 * Stop entertainment rental session, compute billable amount, and link to table/order
 */
async function stopEntertainmentSession(sessionId, actor = null) {
  return runTransaction(async (tx) => {
    const session = await tx.get(`SELECT * FROM entertainment_sessions WHERE id = ?`, [sessionId]);
    if (!session) throw new Error('NOT_FOUND: جلسة الترفيه غير موجودة');
    if (session.status !== 'ACTIVE') throw new Error('CONFLICT: الجلسة منتهية بالفعل');

    const resource = await tx.get(`SELECT * FROM rentable_resources WHERE id = ?`, [session.resource_id]);

    const start = new Date(session.started_at).getTime();
    const now = Date.now();
    const elapsedMinutes = Math.max(1, Math.round((now - start) / 60000));
    
    // Minimum 15 minutes calculation or exact pro-rata
    const billableMinutes = Math.max(15, elapsedMinutes);
    const totalAmount = Math.round((billableMinutes / 60) * session.hourly_rate * 100) / 100;

    await tx.run(
      `UPDATE entertainment_sessions 
       SET ended_at = datetime('now', 'localtime'),
           duration_minutes = ?,
           total_amount = ?,
           status = 'ENDED'
       WHERE id = ?`,
      [elapsedMinutes, totalAmount, sessionId]
    );

    await tx.run(
      `UPDATE rentable_resources SET status = 'AVAILABLE', current_session_id = NULL WHERE id = ?`,
      [session.resource_id]
    );

    // If linked to a table, inject item into table order
    if (session.table_number) {
      const orderSession = await tx.get(
        `SELECT id FROM order_sessions WHERE table_id = (SELECT id FROM tables WHERE table_number = ?) AND status = 'OPEN' ORDER BY id DESC LIMIT 1`,
        [session.table_number]
      );

      if (orderSession) {
        await tx.run(
          `INSERT INTO order_items (session_id, item_name_snapshot, unit_price_minor, quantity, department, status, created_at)
           VALUES (?, ?, ?, 1, 'BARISTA', 'ACTIVE', datetime('now', 'localtime'))`,
          [orderSession.id, `إيجار ${resource ? resource.name : 'ألعاب'} (${elapsedMinutes} دقيقة)`, Math.round(totalAmount * 100)]
        );
      }
    }

    logger.info('Entertainment session ended', { sessionId, elapsedMinutes, totalAmount });

    return {
      success: true,
      message: `تم إنهاء جلسة ${resource ? resource.name : 'الترفيه'} بنجاح. المدة: ${elapsedMinutes} دقيقة، الإجمالي: ${totalAmount} ج.م`,
      session_id: sessionId,
      duration_minutes: elapsedMinutes,
      billable_minutes: billableMinutes,
      total_amount: totalAmount
    };
  });
}

/**
 * Generate MikroTik Hotspot WiFi Vouchers
 */
async function generateWifiVoucher({ profile = '1_HOUR', custom_code = null, price = 10 }, actor = null) {
  const profileDurations = {
    '1_HOUR': 60,
    '3_HOURS': 180,
    'DAY_PASS': 1440,
    '2GB_DATA': 1440
  };

  const durationMinutes = profileDurations[profile] || 60;
  const voucherCode = custom_code || `MZJ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const res = await runQuery(
    `INSERT INTO wifi_vouchers (code, profile, duration_minutes, price, status, expires_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now', 'localtime', '+${durationMinutes} minutes'))`,
    [voucherCode, profile, durationMinutes, Number(price) || 10]
  );

  return {
    success: true,
    message: `تم توليد كود واي فاي بنجاح: ${voucherCode}`,
    voucher: {
      id: res.lastID,
      code: voucherCode,
      profile,
      duration_minutes: durationMinutes,
      price: Number(price) || 10,
      status: 'ACTIVE',
      mikrotik_hotspot_command: `/ip hotspot user add name="${voucherCode}" password="${voucherCode}" profile="${profile}" limit-uptime="${durationMinutes}m"`
    }
  };
}

module.exports = {
  getRentableResources,
  startEntertainmentSession,
  stopEntertainmentSession,
  generateWifiVoucher
};
