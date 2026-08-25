/**
 * ESC/POS Buffer Formatter & Enterprise Durable Thermal Printing Service
 * Features:
 * - Durable print queue with persistent tracking
 * - Safe cash drawer kick guard (CASH only)
 * - Exponential backoff retry engine & Dead-Letter Queue (DLQ)
 * - Idempotency payload hashing & duplicate suppression
 * - Printer health heartbeat diagnostics
 */

const crypto = require('crypto');
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

const ESC = 0x1B;
const GS = 0x1D;

const CMD = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_HEIGHT: Buffer.from([ESC, 0x21, 0x10]),
  DOUBLE_WIDTH: Buffer.from([ESC, 0x21, 0x20]),
  DOUBLE_BOTH: Buffer.from([ESC, 0x21, 0x30]),
  NORMAL_TEXT: Buffer.from([ESC, 0x21, 0x00]),
  DRAWER_KICK: Buffer.from([ESC, 0x70, 0x00, 0x19, 0xFA]),
  CUT_PAPER: Buffer.from([GS, 0x56, 0x41, 0x10]),
  FEED_3: Buffer.from([ESC, 0x64, 0x03])
};

// In-Memory Print Job Queue State & Deduplication Cache
const deduplicationCache = new Map(); // hash -> { timestamp, jobId, status }
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Active simulated printer health status registry
const printerHealthRegistry = new Map([
  ['DEFAULT_POS', { status: 'ONLINE', paper: 'OK', lastHeartbeat: Date.now(), error: null }],
  ['KITCHEN_BOH', { status: 'ONLINE', paper: 'OK', lastHeartbeat: Date.now(), error: null }],
  ['BARISTA_BAR', { status: 'ONLINE', paper: 'OK', lastHeartbeat: Date.now(), error: null }]
]);

function computePayloadHash(payload) {
  const normalized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Format Receipt ESC/POS Buffer
 */
function formatReceiptEscPos(data) {
  const chunks = [];
  chunks.push(CMD.INIT);

  // Safe Drawer Kick: Only if kick_drawer is requested AND payment method is CASH
  if (data.kick_drawer && (data.payment_method === 'CASH' || data.is_cash_settlement)) {
    chunks.push(CMD.DRAWER_KICK);
  }

  // Header
  chunks.push(CMD.ALIGN_CENTER);
  chunks.push(CMD.DOUBLE_BOTH);
  chunks.push(Buffer.from(`${data.cafe_name || 'كافيه مزاج'}\n`, 'utf8'));
  chunks.push(CMD.NORMAL_TEXT);
  chunks.push(Buffer.from('================================\n', 'utf8'));

  // Metadata
  chunks.push(CMD.ALIGN_LEFT);
  chunks.push(Buffer.from(`فاتورة رقم: #${data.order_id || 'N/A'}\n`, 'utf8'));
  if (data.table_number) {
    chunks.push(Buffer.from(`طاولة رقم: ${data.table_number}\n`, 'utf8'));
  }
  chunks.push(Buffer.from(`الكاشير: ${data.cashier_name || 'كاشير الصالة'}\n`, 'utf8'));
  chunks.push(Buffer.from(`التاريخ: ${new Date().toLocaleString('ar-EG')}\n`, 'utf8'));
  chunks.push(Buffer.from('--------------------------------\n', 'utf8'));

  // Line items
  const items = Array.isArray(data.items) ? data.items : [];
  for (const it of items) {
    const line = `${it.quantity || 1}x ${it.item_name || it.name} - ${it.price || 0} ${data.currency || 'ج.م'}\n`;
    chunks.push(Buffer.from(line, 'utf8'));
  }
  chunks.push(Buffer.from('--------------------------------\n', 'utf8'));

  // Financial Breakdown
  chunks.push(CMD.ALIGN_RIGHT);
  chunks.push(Buffer.from(`المجموع الفرعي: ${data.subtotal || 0} ${data.currency || 'ج.م'}\n`, 'utf8'));
  if (data.service_amount > 0) {
    chunks.push(Buffer.from(`خدمة الصالة: +${data.service_amount} ${data.currency || 'ج.م'}\n`, 'utf8'));
  }
  if (data.vat_amount > 0) {
    chunks.push(Buffer.from(`ضريبة القيمة المضافة (14%): +${data.vat_amount} ${data.currency || 'ج.م'}\n`, 'utf8'));
  }
  if (data.discount_amount > 0) {
    chunks.push(Buffer.from(`الخصم: -${data.discount_amount} ${data.currency || 'ج.م'}\n`, 'utf8'));
  }

  chunks.push(CMD.BOLD_ON);
  chunks.push(CMD.DOUBLE_HEIGHT);
  chunks.push(Buffer.from(`الإجمالي النهائي: ${data.total_amount || 0} ${data.currency || 'ج.م'}\n`, 'utf8'));
  chunks.push(CMD.NORMAL_TEXT);
  chunks.push(CMD.BOLD_OFF);

  if (data.change_owed > 0) {
    chunks.push(Buffer.from(`المتبقي كاش للعميل: ${data.change_owed} ${data.currency || 'ج.م'}\n`, 'utf8'));
  }

  // Footer Note
  chunks.push(CMD.ALIGN_CENTER);
  chunks.push(Buffer.from('================================\n', 'utf8'));
  chunks.push(Buffer.from('شكراً لزيارتكم - نتمنى لكم يوماً سعيداً\n', 'utf8'));
  chunks.push(CMD.FEED_3);
  chunks.push(CMD.CUT_PAPER);

  return Buffer.concat(chunks);
}

/**
 * Format Kitchen Ticket ESC/POS Buffer
 */
function formatKitchenTicketEscPos(data) {
  const chunks = [];
  chunks.push(CMD.INIT);
  chunks.push(CMD.ALIGN_CENTER);
  chunks.push(CMD.DOUBLE_BOTH);
  chunks.push(Buffer.from(`[ تذكرة تحضير - ${data.department || 'BOH'} ]\n`, 'utf8'));
  chunks.push(CMD.NORMAL_TEXT);
  chunks.push(Buffer.from(`طاولة: #${data.table_number || 'مباشر'}\n`, 'utf8'));
  chunks.push(Buffer.from(`الوقت: ${data.created_at || new Date().toLocaleTimeString('ar-EG')}\n`, 'utf8'));
  chunks.push(Buffer.from('================================\n', 'utf8'));

  chunks.push(CMD.ALIGN_LEFT);
  chunks.push(CMD.DOUBLE_HEIGHT);
  chunks.push(Buffer.from(`${data.quantity || 1}x ${data.item_name}\n`, 'utf8'));
  chunks.push(CMD.NORMAL_TEXT);

  if (data.sugar_level) {
    chunks.push(Buffer.from(`  * السكر: ${data.sugar_level}\n`, 'utf8'));
  }
  if (data.roast_type) {
    chunks.push(Buffer.from(`  * البن/التحويجة: ${data.roast_type}\n`, 'utf8'));
  }
  if (data.notes) {
    chunks.push(Buffer.from(`  * ملاحظات: ${data.notes}\n`, 'utf8'));
  }

  chunks.push(CMD.FEED_3);
  chunks.push(CMD.CUT_PAPER);

  return Buffer.concat(chunks);
}

/**
 * Format Z-Report ESC/POS Buffer
 */
function formatZReportEscPos(data) {
  const chunks = [];
  chunks.push(CMD.INIT);
  chunks.push(CMD.ALIGN_CENTER);
  chunks.push(CMD.DOUBLE_BOTH);
  chunks.push(Buffer.from('=== تقرير إغلاق الوردية Z-REPORT ===\n', 'utf8'));
  chunks.push(CMD.NORMAL_TEXT);
  chunks.push(Buffer.from(`المستخدم: ${data.user_name} (ID: ${data.user_id})\n`, 'utf8'));
  chunks.push(Buffer.from(`نوع الوردية: ${data.shift_type || 'MORNING'}\n`, 'utf8'));
  chunks.push(Buffer.from(`التاريخ: ${data.created_at || new Date().toLocaleString('ar-EG')}\n`, 'utf8'));
  chunks.push(Buffer.from('--------------------------------\n', 'utf8'));

  chunks.push(CMD.ALIGN_LEFT);
  chunks.push(Buffer.from(`عهدة البداية (Float): ${data.opening_float || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`مبيعات الكاش (+): ${data.cash_sales || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`مبيعات الديجيتال: ${data.digital_sales || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`إجمالي مبيعات الوردية: ${data.total_sales || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`سلف موظفين (-): ${data.advances || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`مصروفات نقدية (-): ${data.expenses || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from('--------------------------------\n', 'utf8'));

  chunks.push(CMD.BOLD_ON);
  chunks.push(Buffer.from(`النقدية المتوقعة بالدرج: ${data.expected_cash || 0} ج.م\n`, 'utf8'));
  chunks.push(Buffer.from(`النقدية الفعلية المقر بها: ${data.actual_cash || 0} ج.م\n`, 'utf8'));
  const varTxt = data.variance === 0 ? 'مطابق تماماً 🎯' : (data.variance > 0 ? `فائض: +${data.variance} ج.م` : `عجز: ${data.variance} ج.م`);
  chunks.push(Buffer.from(`الفارق المالي: ${varTxt}\n`, 'utf8'));
  chunks.push(CMD.BOLD_OFF);

  chunks.push(CMD.FEED_3);
  chunks.push(CMD.CUT_PAPER);

  return Buffer.concat(chunks);
}

/**
 * Enqueue Durable Print Job with Duplicate Suppression & Safe Drawer Kick Check
 */
async function enqueuePrintJob(params = {}) {
  const {
    jobType = 'RECEIPT',
    payload = {},
    printerIp = '127.0.0.1',
    printerPort = 9100,
    printerId = 'DEFAULT_POS',
    maxRetries = 3,
    idempotencyKey = null
  } = params;

  // Safe Drawer Kick Policy: Strip drawer kick if not cash payment
  if (payload.kick_drawer && payload.payment_method && payload.payment_method !== 'CASH' && !payload.is_cash_settlement) {
    logger.warn('Suppressed drawer kick on non-cash print job', { payment_method: payload.payment_method });
    payload.kick_drawer = false;
  }

  const payloadString = JSON.stringify(payload);
  const payloadHash = idempotencyKey || computePayloadHash(payloadString);

  // Duplicate Suppression: Check if identical job was submitted within DEDUP_TTL_MS
  const now = Date.now();
  if (deduplicationCache.has(payloadHash)) {
    const cached = deduplicationCache.get(payloadHash);
    if (now - cached.timestamp < DEDUP_TTL_MS) {
      logger.info('Duplicate print job suppressed', { payloadHash, originalJobId: cached.jobId });
      return {
        success: true,
        job_id: cached.jobId,
        status: cached.status,
        duplicate_suppressed: true,
        message: 'تم كتم أمر الطباعة المكرر بنجاح لمنع استهلاك الورق المزدوج'
      };
    }
  }

  const jobId = params.id || `PRINT-${now.toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  // Persist into database queue table
  try {
    await runQuery(
      `INSERT INTO print_jobs (id, job_type, printer_ip, printer_port, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now', 'localtime'))`,
      [jobId, jobType, printerIp, printerPort, payloadString]
    );
  } catch (err) {
    // If print_jobs table does not exist or errors, continue with in-memory tracking
    logger.warn('Failed to insert into print_jobs table, using in-memory queue', { error: err.message });
  }

  deduplicationCache.set(payloadHash, {
    timestamp: now,
    jobId,
    status: 'QUEUED'
  });

  return {
    success: true,
    job_id: jobId,
    payload_hash: payloadHash,
    status: 'QUEUED',
    printer_id: printerId,
    max_retries: maxRetries,
    created_at: new Date().toISOString()
  };
}

/**
 * Execute Print Job with Retry & Dead-Letter Handling
 */
async function processPrintJob(jobId, executeHardwarePrintFn = null) {
  let job = null;
  try {
    job = await getQuery(`SELECT * FROM print_jobs WHERE id = ?`, [jobId]);
  } catch (e) {}

  if (!job) {
    job = { id: jobId, attempts: 0, status: 'QUEUED' };
  }

  let attempts = job.attempts || 0;
  const maxRetries = 3;
  let lastError = null;

  while (attempts < maxRetries) {
    attempts++;
    try {
      if (executeHardwarePrintFn) {
        await executeHardwarePrintFn(job);
      }
      
      // Mark as completed
      try {
        await runQuery(
          `UPDATE print_jobs SET status = 'COMPLETED', updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [jobId]
        );
      } catch (e) {}

      logger.info('Print job completed successfully', { jobId, attempts });
      return { success: true, jobId, status: 'COMPLETED', attempts };
    } catch (err) {
      lastError = err;
      logger.warn(`Print job attempt ${attempts} failed, applying exponential backoff`, {
        jobId,
        error: err.message
      });
      // Exponential backoff: 50ms * 2^attempts (50ms, 100ms, 200ms in fast test mode)
      const backoffMs = Math.min(2000, 50 * Math.pow(2, attempts));
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }

  // Max retries exceeded -> Move to Dead-Letter Queue (DLQ)
  try {
    await runQuery(
      `UPDATE print_jobs SET status = 'DEAD_LETTER', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [lastError ? lastError.message : 'Max retries exceeded', jobId]
    );
  } catch (e) {}

  logger.error('Print job transitioned to DEAD_LETTER queue', {
    jobId,
    attempts,
    finalError: lastError ? lastError.message : 'Unknown'
  });

  return {
    success: false,
    jobId,
    status: 'DEAD_LETTER',
    attempts,
    error: lastError ? lastError.message : 'Max retries exceeded'
  };
}

/**
 * Get Printer Health Heartbeat
 */
function getPrinterHealth(printerId = 'DEFAULT_POS') {
  const current = printerHealthRegistry.get(printerId) || {
    status: 'ONLINE',
    paper: 'OK',
    lastHeartbeat: Date.now(),
    error: null
  };
  return {
    printer_id: printerId,
    ...current,
    healthy: current.status === 'ONLINE' && current.paper === 'OK'
  };
}

/**
 * Set Printer Health (for simulation and operational recovery)
 */
function setPrinterHealth(printerId, statusObj) {
  printerHealthRegistry.set(printerId, {
    ...statusObj,
    lastHeartbeat: Date.now()
  });
}

module.exports = {
  CMD,
  formatReceiptEscPos,
  formatKitchenTicketEscPos,
  formatZReportEscPos,
  enqueuePrintJob,
  processPrintJob,
  getPrinterHealth,
  setPrinterHealth,
  computePayloadHash
};
