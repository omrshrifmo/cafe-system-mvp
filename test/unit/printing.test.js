const assert = require('assert');
const { formatReceiptEscPos, formatKitchenTicketEscPos, formatZReportEscPos, CMD } = require('../../src/domain/printing/service');

describe('Printing ESC/POS Formatter Unit Tests', () => {
  it('should generate valid receipt buffer with drawer kick and cut commands', () => {
    const receiptData = {
      order_id: 101,
      table_number: 5,
      cashier_name: 'أحمد',
      items: [{ item_name: 'لاتيه', quantity: 2, price: 50 }],
      subtotal: 100,
      service_amount: 12,
      vat_amount: 15.68,
      total_amount: 127.68,
      currency: 'ج.م',
      kick_drawer: true
    };

    const buffer = formatReceiptEscPos(receiptData);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 50);

    // Verify ESC/POS commands exist in buffer
    assert.ok(buffer.includes(CMD.INIT));
    assert.ok(buffer.includes(CMD.DRAWER_KICK));
    assert.ok(buffer.includes(CMD.CUT_PAPER));
  });

  it('should generate valid kitchen ticket buffer', () => {
    const ticketData = {
      order_id: 42,
      table_number: 3,
      item_name: 'اسبريسو دبل',
      quantity: 1,
      department: 'BARISTA',
      sugar_level: 'بدون سكر',
      roast_type: 'فاتح'
    };

    const buffer = formatKitchenTicketEscPos(ticketData);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.includes(CMD.CUT_PAPER));
  });

  it('should format Z-Report buffer with variance', () => {
    const zReportData = {
      user_id: 5,
      user_name: 'أحمد كركور',
      shift_type: 'MORNING',
      opening_float: 500,
      cash_sales: 1200,
      digital_sales: 300,
      total_sales: 1500,
      advances: 100,
      expenses: 50,
      expected_cash: 1550,
      actual_cash: 1550,
      variance: 0
    };

    const buffer = formatZReportEscPos(zReportData);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.includes(CMD.CUT_PAPER));
  });
});
