/**
 * ESC/POS Buffer Formatter & Thermal Printing Service
 */

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

function formatReceiptEscPos(data) {
  const chunks = [];
  chunks.push(CMD.INIT);

  if (data.kick_drawer) {
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

module.exports = {
  CMD,
  formatReceiptEscPos,
  formatKitchenTicketEscPos,
  formatZReportEscPos
};
