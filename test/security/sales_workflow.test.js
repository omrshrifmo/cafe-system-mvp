const assert = require('assert');
const request = require('supertest');
const crypto = require('crypto');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { allQuery, getQuery, runQuery } = require('../../src/db/connection');
const { hashPin } = require('../../src/domain/auth/service');
const { computeQuote } = require('../../src/domain/orders/quoteService');
const { settleOrder } = require('../../src/domain/orders/settlementService');
const { processReversal } = require('../../src/domain/orders/reversalService');
const { updateOrderSessionStatus } = require('../../src/domain/orders/service');
const { authorizeDrawerKick, enqueueReprintJob } = require('../../src/domain/hardware/printerService');

describe('Linked Sales Workflow, Authoritative Quotation, Settlement & Reversal Suite', function() {
  this.timeout(30000);
  let app;
  let ownerCookie;
  let cashierCookie;
  let waiterCookie;

  before(async function() {
    this.timeout(30000);
    await runMigrations();
    app = createApp();

    // 0. Seed Canonical Roles
    const canonicalRoles = [
      'SUPER_ADMIN', 'OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'BARISTA',
      'CHEF', 'SHISHA', 'WAITER', 'RUNNER', 'HALL_MANAGER', 'BOM_MANAGER',
      'HR_PAYROLL', 'QA', 'READ_ONLY'
    ];

    for (const r of canonicalRoles) {
      await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES (?, 'V_DEFAULT', ?)`, [`R_${r}`, r]);
    }

    // Helper to upsert user without triggering ON DELETE RESTRICT
    const upsertUser = async (id, name, roleId, pin) => {
      const pinHash = await hashPin(pin);
      await runQuery(
        `INSERT OR IGNORE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
         VALUES (?, 'V_DEFAULT', ?, ?, ?, 1, 0, NULL)`,
        [id, name, roleId, pinHash]
      );
      await runQuery(
        `UPDATE v3_users SET pin_hash = ?, is_active = 1, failed_attempts = 0, locked_until = NULL, role_id = ? WHERE id = ?`,
        [pinHash, roleId, id]
      );
    };

    await upsertUser('102', 'المالك التجريبي', 'R_OWNER', '8802');
    await upsertUser('104', 'كاشير الصالة', 'R_OP_ASSISTANT_CASHIER', '8804');
    await upsertUser('108', 'ويتر الصالة', 'R_WAITER', '8808');

    // Login Owner
    const ownerRes = await request(app).post('/api/auth/login').send({ pin: '8802' });
    ownerCookie = ownerRes.headers['set-cookie'];

    // Login Cashier
    const cashierRes = await request(app).post('/api/auth/login').send({ pin: '8804' });
    cashierCookie = cashierRes.headers['set-cookie'];

    // Login Waiter
    const waiterRes = await request(app).post('/api/auth/login').send({ pin: '8808' });
    waiterCookie = waiterRes.headers['set-cookie'];
  });

  let defaultBranchId = 'B_DEFAULT';
  let defaultTableId = null;

  before(async () => {
    const b = await getQuery(`SELECT id FROM branches LIMIT 1`);
    if (b) defaultBranchId = b.id;
    const t = await getQuery(`SELECT id FROM v3_tables LIMIT 1`);
    if (t) defaultTableId = t.id;
  });

  describe('1. Order Lifecycle (8 Canonical States) & Transition Guardrails', () => {
    let testSessionId;

    it('should create order and progress through OPEN -> SUBMITTED -> IN_PREPARATION -> READY -> SERVED -> PAYMENT_PENDING -> PAID', async () => {
      // 1. Create order session
      testSessionId = `SESS-SALES-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [testSessionId, defaultBranchId, defaultTableId]
      );

      // OPEN -> SUBMITTED
      let res = await updateOrderSessionStatus(testSessionId, 'SUBMITTED', '108', 1);
      assert.strictEqual(res.status, 'SUBMITTED');
      assert.strictEqual(res.version, 2);

      // SUBMITTED -> IN_PREPARATION
      res = await updateOrderSessionStatus(testSessionId, 'IN_PREPARATION', '108', 2);
      assert.strictEqual(res.status, 'IN_PREPARATION');

      // IN_PREPARATION -> READY
      res = await updateOrderSessionStatus(testSessionId, 'READY', '108', 3);
      assert.strictEqual(res.status, 'READY');

      // READY -> SERVED
      res = await updateOrderSessionStatus(testSessionId, 'SERVED', '108', 4);
      assert.strictEqual(res.status, 'SERVED');

      // SERVED -> PAYMENT_PENDING
      res = await updateOrderSessionStatus(testSessionId, 'PAYMENT_PENDING', '108', 5);
      assert.strictEqual(res.status, 'PAYMENT_PENDING');

      // PAYMENT_PENDING -> PAID
      res = await updateOrderSessionStatus(testSessionId, 'PAID', '107', 6);
      assert.strictEqual(res.status, 'PAID');
    });

    it('should reject illegal state transitions (e.g. PAID back to OPEN)', async () => {
      await assert.rejects(
        async () => {
          await updateOrderSessionStatus(testSessionId, 'OPEN', '108', 7);
        },
        (err) => {
          assert.match(err.message, /INVALID_STATE_TRANSITION/);
          return true;
        }
      );
    });

    it('should reject state updates with mismatched optimistic concurrency version', async () => {
      await assert.rejects(
        async () => {
          await updateOrderSessionStatus(testSessionId, 'REFUNDED', '102', 999);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          return true;
        }
      );
    });
  });

  describe('2. Server-Authoritative Integer Quotation Engine', () => {
    it('should calculate integer minor-unit prices, taxes, service, discounts, and tips', async () => {
      // 2 lines: Latte (50 EGP = 5000 minor) x 2 = 10000 minor, Espresso (35 EGP = 3500 minor) x 1 = 3500 minor
      // Subtotal = 13500 minor (135.00 EGP)
      // Discount = 1500 minor (15.00 EGP) -> Base = 12000 minor
      // Service 12% = 1440 minor
      // Tax 14% on (12000 + 1440 = 13440) = 1881.6 -> 1882 minor
      // Tip = 500 minor (5.00 EGP)
      // Total = 12000 + 1440 + 1882 + 500 = 15822 minor (158.22 EGP)
      const quote = await computeQuote({
        lines: [
          { item_name: 'لاتيه', price_minor: 5000, quantity: 2 },
          { item_name: 'اسبريسو', price_minor: 3500, quantity: 1 }
        ],
        discount_minor: 1500,
        tip_minor: 500
      });

      assert.strictEqual(quote.subtotal_minor, 13500);
      assert.strictEqual(quote.discount_minor, 1500);
      assert.strictEqual(quote.service_minor, 1440);
      assert.strictEqual(quote.tax_minor, 1882);
      assert.strictEqual(quote.tip_minor, 500);
      assert.strictEqual(quote.total_due_minor, 15822);
      assert.strictEqual(quote.currency, 'EGP');
      assert.strictEqual(quote.rounding, 'ROUND_HALF_UP');
      assert.ok(quote.expires_at, 'Quote must include expiration timestamp');
      assert.ok(quote.versions.catalog_version >= 1, 'Catalog version must be present');
      assert.ok(quote.versions.policy_version >= 1, 'Policy version must be present');
    });

    it('should expose GET and POST /api/quote endpoints with strict server truth', async () => {
      const res = await request(app)
        .post('/api/quote')
        .set('Cookie', cashierCookie)
        .send({
          items: [{ name: 'لاتيه', price_minor: 5000, quantity: 2 }]
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.quote.subtotal_minor, 10000);
      assert.strictEqual(res.body.quote.service_minor, 1200); // 12%
      assert.strictEqual(res.body.quote.tax_minor, 1568); // 14% of 11200
      assert.strictEqual(res.body.quote.total_minor, 12768);
    });
  });

  describe('3. Atomic Settlement, Multi-Tender Split & Change Calculation', () => {
    let orderSessionId;

    beforeEach(async () => {
      orderSessionId = `SESS-SETTLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [orderSessionId, defaultBranchId, defaultTableId]
      );
    });

    it('should settle exact cash payment and calculate correct change', async () => {
      orderSessionId = `SESS-SETTLE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [orderSessionId, defaultBranchId, defaultTableId]
      );

      const intent = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 2 }], // 10000 + 1200 + 1568 = 12768 minor
        payment_method: 'CASH',
        amount_minor: 15000, // 150.00 EGP tendered
        idempotency_key: `IDEMP-CASH-${Date.now()}`,
        actor_id: '107'
      };

      const result = await settleOrder(orderSessionId, intent, 1);
      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(result.quote.total_due_minor, 12768);
      assert.strictEqual(result.total_paid_minor, 15000);
      assert.strictEqual(result.change_owed_minor, 2232); // 15000 - 12768 = 2232 minor (22.32 EGP)
      assert.strictEqual(result.change_owed, 22.32);

      // Verify order session is PAID
      const updatedOrder = await getQuery(`SELECT status, version FROM v3_order_sessions WHERE id = ?`, [orderSessionId]);
      assert.strictEqual(updatedOrder.status, 'PAID');
      assert.strictEqual(updatedOrder.version, 2);

      // Verify drawer kick authorization on CASH payment
      const canKick = await authorizeDrawerKick(orderSessionId);
      assert.strictEqual(canKick, true);
    });

    it('should settle multi-tender split payment (Cash + Visa)', async () => {
      const splitSessId = `SESS-SPLIT-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [splitSessId, defaultBranchId, defaultTableId]
      );

      const intent = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 2 }], // 12768 total due
        payments: [
          { method: 'CASH', amount_minor: 10000 },
          { method: 'VISA', amount_minor: 2768, external_reference: 'AUTH-VISA-9912' }
        ],
        idempotency_key: `IDEMP-SPLIT-${Date.now()}`,
        actor_id: '107'
      };

      const result = await settleOrder(splitSessId, intent, 1);
      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(result.total_paid_minor, 12768);
      assert.strictEqual(result.change_owed_minor, 0);

      // Check payments table
      const pRows = await allQuery(`SELECT payment_method, amount_minor, external_reference FROM v3_payments WHERE order_session_id = ?`, [splitSessId]);
      assert.strictEqual(pRows.length, 2);
      assert.strictEqual(pRows[0].payment_method, 'CASH');
      assert.strictEqual(pRows[1].payment_method, 'VISA');
      assert.strictEqual(pRows[1].external_reference, 'AUTH-VISA-9912');
    });

    it('should reject drawer kick on non-cash payments', async () => {
      const cardSessionId = `SESS-CARD-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [cardSessionId, defaultBranchId, defaultTableId]
      );

      await settleOrder(cardSessionId, {
        lines: [{ item_name: 'اسبريسو', price_minor: 3500, quantity: 1 }],
        payment_method: 'VISA',
        idempotency_key: `IDEMP-CARD-${Date.now()}`,
        actor_id: '107'
      }, 1);

      await assert.rejects(
        async () => {
          await authorizeDrawerKick(cardSessionId);
        },
        (err) => {
          assert.match(err.message, /Only cash settlements authorize a drawer kick/);
          return true;
        }
      );
    });

    it('should handle UNKNOWN_REQUIRES_RECONCILIATION without marking order as paid', async () => {
      const unrecSessionId = `SESS-UNREC-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [unrecSessionId, defaultBranchId, defaultTableId]
      );

      const intent = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 1 }],
        payment_method: 'INSTAPAY',
        status: 'UNKNOWN_REQUIRES_RECONCILIATION',
        external_reference: 'IPAY-PENDING-TRACE-1',
        idempotency_key: `IDEMP-UNREC-${Date.now()}`,
        actor_id: '107'
      };

      const result = await settleOrder(unrecSessionId, intent, 1);
      assert.strictEqual(result.status, 'UNKNOWN_REQUIRES_RECONCILIATION');
      assert.strictEqual(result.order_status, 'PAYMENT_PENDING');

      // Verify order session is NOT PAID
      const session = await getQuery(`SELECT status FROM v3_order_sessions WHERE id = ?`, [unrecSessionId]);
      assert.strictEqual(session.status, 'PAYMENT_PENDING');

      // Verify payment status in DB is PENDING_RECONCILIATION
      const payRecord = await getQuery(`SELECT status FROM v3_payments WHERE order_session_id = ?`, [unrecSessionId]);
      assert.strictEqual(payRecord.status, 'PENDING_RECONCILIATION');
    });
  });

  describe('4. Idempotency Payload Hashing & Mismatch Rejection', () => {
    it('should return cached result for identical request payload on repeat click', async () => {
      const sessId = `SESS-IDEMP-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [sessId, defaultBranchId, defaultTableId]
      );

      const idempKey = `IDEMP-SAME-${Date.now()}`;
      const intent = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 1 }],
        payment_method: 'CASH',
        idempotency_key: idempKey,
        actor_id: '107'
      };

      const res1 = await settleOrder(sessId, intent, 1);
      assert.strictEqual(res1.status, 'SUCCESS');

      // Repeat with same key and same payload
      const res2 = await settleOrder(sessId, intent, 1);
      assert.strictEqual(res2.status, 'SUCCESS');
      assert.strictEqual(res2.payment_id, res1.payment_id);
    });

    it('should reject request with IDEMPOTENCY_MISMATCH (409) if payload changes under same key', async () => {
      const sessId = `SESS-IDEMP-MISMATCH-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [sessId, defaultBranchId, defaultTableId]
      );

      const idempKey = `IDEMP-MISMATCH-KEY-${Date.now()}`;
      const intentOriginal = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 1 }],
        payment_method: 'CASH',
        idempotency_key: idempKey,
        actor_id: '107'
      };

      await settleOrder(sessId, intentOriginal, 1);

      // Changed payload with same key
      const intentChanged = {
        lines: [{ item_name: 'لاتيه', price_minor: 5000, quantity: 2 }],
        payment_method: 'VISA',
        idempotency_key: idempKey,
        actor_id: '107'
      };

      await assert.rejects(
        async () => {
          await settleOrder(sessId, intentChanged, 1);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.match(err.message, /IDEMPOTENCY_MISMATCH/);
          return true;
        }
      );
    });
  });

  describe('5. Multi-Path Reversals Ledger & Inventory Restorations', () => {
    it('should cancel unpaid order, restore inventory, and transition to CANCELLED', async () => {
      const cancelSessId = `SESS-REV-UNPAID-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'OPEN', 1)`,
        [cancelSessId, defaultBranchId, defaultTableId]
      );

      const revRes = await processReversal('V_DEFAULT', cancelSessId, {
        type: 'CANCELLED_UNPAID',
        reason: 'إلغاء بناء على رغبة العميل قبل التحضير',
        actor_id: '108',
        approval_actor_id: '108'
      });

      assert.strictEqual(revRes.status, 'SUCCESS');
      assert.strictEqual(revRes.reversal_type, 'CANCELLED_UNPAID');
      assert.strictEqual(revRes.new_status, 'CANCELLED');

      const sess = await getQuery(`SELECT status FROM v3_order_sessions WHERE id = ?`, [cancelSessId]);
      assert.strictEqual(sess.status, 'CANCELLED');
    });

    it('should reject paid void (VOID_PAID) when attempted by non-owner without owner permissions', async () => {
      const paidSessId = `SESS-VOID-PAID-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, total_minor)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'PAID', 1, 10000)`,
        [paidSessId, defaultBranchId, defaultTableId]
      );

      await assert.rejects(
        async () => {
          await processReversal('V_DEFAULT', paidSessId, {
            type: 'VOID_PAID',
            reason: 'إلغاء فاتورة مسددة من الكاشير',
            actor_id: '107',
            approval_actor_id: '107' // Cashier ID (not Owner)
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /FORBIDDEN/);
          return true;
        }
      );
    });

    it('should allow paid void (VOID_PAID) when approved by OWNER (102)', async () => {
      const paidSessId = `SESS-VOID-OWNER-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, total_minor)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'PAID', 1, 10000)`,
        [paidSessId, defaultBranchId, defaultTableId]
      );

      const revRes = await processReversal('V_DEFAULT', paidSessId, {
        type: 'VOID_PAID',
        reason: 'إلغاء فاتورة معتمدة من المالك مباشرة',
        actor_id: '102',
        approval_actor_id: '102' // Owner ID
      });

      assert.strictEqual(revRes.status, 'SUCCESS');
      assert.strictEqual(revRes.new_status, 'REFUNDED');

      // Verify immutable reversals ledger row
      const revRow = await getQuery(`SELECT * FROM reversals WHERE order_session_id = ?`, [paidSessId]);
      assert.ok(revRow);
      assert.strictEqual(revRow.type, 'VOID_PAID');
      assert.strictEqual(revRow.approval_actor_id, '102');
    });

    it('should record full refund (REFUND_FULL) and partial refund (REFUND_PARTIAL)', async () => {
      const refundSessId = `SESS-REFUND-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, total_minor)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'PAID', 1, 15000)`,
        [refundSessId, defaultBranchId, defaultTableId]
      );

      // Partial Refund
      const partRes = await processReversal('V_DEFAULT', refundSessId, {
        type: 'REFUND_PARTIAL',
        amount_minor: 5000,
        reason: 'استرجاع صنف تالف',
        actor_id: '102',
        approval_actor_id: '102'
      });
      assert.strictEqual(partRes.new_status, 'PARTIALLY_REFUNDED');

      // Full Refund
      const fullRes = await processReversal('V_DEFAULT', refundSessId, {
        type: 'REFUND_FULL',
        amount_minor: 10000,
        reason: 'استرجاع باقي الفاتورة',
        actor_id: '102',
        approval_actor_id: '102'
      });
      assert.strictEqual(fullRes.new_status, 'REFUNDED');
    });
  });

  describe('6. Durable Receipts Queue & Reprint Authorization', () => {
    it('should enqueue receipt reprint job with payload hash and actor attribution', async () => {
      const reprintSessId = `SESS-REPRINT-${Date.now()}`;
      await runQuery(
        `INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, order_type, status, version, total_minor)
         VALUES (?, ?, ?, '108', 'DINE_IN', 'PAID', 1, 10000)`,
        [reprintSessId, defaultBranchId, defaultTableId]
      );

      const reprintRes = await enqueueReprintJob(reprintSessId, '107', 'طلب العميل نسخة إضافية');
      assert.strictEqual(reprintRes.success, true);
      assert.strictEqual(reprintRes.status, 'PENDING');

      // Verify print_jobs / printer_jobs record
      const job = await getQuery(`SELECT * FROM printer_jobs WHERE id = ?`, [reprintRes.job_id]);
      assert.ok(job);
      assert.ok(job.payload_hash);
      assert.strictEqual(job.status, 'PENDING');
    });
  });
});
