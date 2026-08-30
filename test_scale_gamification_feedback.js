const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./src/app');
const { getQuery, runQuery, allQuery } = require('./src/db/connection');
const { runMigrations } = require('./src/db/migrator');

describe('Digital Scale Hardware, HR Gamification & Guest Experience Suite', function () {
  this.timeout(10000);

  let app;
  let ownerCookie = '';

  before(async () => {
    await runMigrations();
    app = createApp();

    // 1. Authenticate Cashier/Staff
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1007' });
    
    if (loginRes.headers['set-cookie']) {
      ownerCookie = loginRes.headers['set-cookie'];
    }

    // 2. Insert test user if needed
    const cashier = await getQuery(`SELECT id FROM users WHERE role = 'OP_ASSISTANT_CASHIER' LIMIT 1`);
    if (!cashier) {
      await runQuery(`INSERT INTO users (name, pin, role, is_active) VALUES ('كاشير الاختبار', '1111', 'OP_ASSISTANT_CASHIER', 1)`);
    }
  });

  describe('1. Digital Scale Hardware UI Integration (WebSerial API)', () => {
    it('should have readFromDigitalScale and scale buttons in stocktake.html', () => {
      const stocktakeHtml = fs.readFileSync(path.join(__dirname, 'public', 'stocktake.html'), 'utf8');
      assert.ok(stocktakeHtml.includes('readFromDigitalScale'), 'stocktake.html must define readFromDigitalScale');
      assert.ok(stocktakeHtml.includes('navigator.serial'), 'stocktake.html must use WebSerial navigator.serial');
      assert.ok(stocktakeHtml.includes('baudRate: 9600'), 'stocktake.html must configure standard 9600 baud');
    });

    it('should have readFromDigitalScale and scale buttons in kds.html waste logging', () => {
      const kdsHtml = fs.readFileSync(path.join(__dirname, 'public', 'kds.html'), 'utf8');
      assert.ok(kdsHtml.includes('readFromDigitalScale'), 'kds.html must define readFromDigitalScale');
      assert.ok(kdsHtml.includes('قراءة من الميزان'), 'kds.html must have scale button');
      assert.ok(kdsHtml.includes('navigator.serial'), 'kds.html must use WebSerial navigator.serial');
    });
  });

  describe('2. HR Gamification & Leaderboard (GET /api/hr/leaderboard)', () => {
    it('should return 200 and ranked staff with gold, silver, and bronze badges', async () => {
      const res = await request(app)
        .get('/api/hr/leaderboard')
        .set('Cookie', ownerCookie)
        .set('x-user-role', 'OWNER');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.leaderboard), 'leaderboard must be an array');
      assert.ok(res.body.leaderboard.length > 0, 'leaderboard should have active staff');

      const top1 = res.body.leaderboard[0];
      assert.strictEqual(top1.rank, 1);
      assert.strictEqual(top1.badge, '🥇');
      assert.ok(top1.score >= 0, 'score must be non-negative');
      assert.ok('has_zero_penalties' in top1, 'should report penalty status');
      assert.ok('avg_variance' in top1, 'should report cash variance');

      if (res.body.leaderboard.length > 1) {
        assert.strictEqual(res.body.leaderboard[1].rank, 2);
        assert.strictEqual(res.body.leaderboard[1].badge, '🥈');
      }
      if (res.body.leaderboard.length > 2) {
        assert.strictEqual(res.body.leaderboard[2].rank, 3);
        assert.strictEqual(res.body.leaderboard[2].badge, '🥉');
      }
    });

    it('public/hr.html should contain the Leaderboard & Gamification UI section', () => {
      const hrHtml = fs.readFileSync(path.join(__dirname, 'public', 'hr.html'), 'utf8');
      assert.ok(hrHtml.includes('لوحة الشرف والأداء'), 'hr.html must include Leaderboard header');
      assert.ok(hrHtml.includes('/api/hr/leaderboard'), 'hr.html must call leaderboard endpoint');
      assert.ok(hrHtml.includes('loadLeaderboard'), 'hr.html must define loadLeaderboard function');
    });
  });

  describe('3. Guest Experience Feedback & Automated QA Flagging', () => {
    it('should accept 5-star positive feedback without QA escalation', async () => {
      const res = await request(app)
        .post('/api/public/feedback')
        .send({
          table_number: '7',
          rating_1_to_5: 5,
          comment: 'القهوة رائعة جداً والخدمة سريعة وممتازة!'
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.is_flagged, false);
      assert.ok(res.body.feedback_id, 'feedback_id must be generated');

      const saved = await getQuery(`SELECT * FROM customer_feedback WHERE id = ?`, [res.body.feedback_id]);
      assert.ok(saved);
      assert.strictEqual(saved.rating, 5);
      assert.strictEqual(saved.table_number, '7');
      assert.strictEqual(saved.is_flagged, 0);
    });

    it('should accept low rating (<= 3 stars) and automatically flag a HIGH severity QA complaint', async () => {
      const res = await request(app)
        .post('/api/public/feedback')
        .send({
          table_number: '12',
          rating_1_to_5: 2,
          comment: 'تأخر الطلب أكثر من 25 دقيقة وكان الكابتشينو بارداً'
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.is_flagged, true);

      // Verify customer_feedback record
      const saved = await getQuery(`SELECT * FROM customer_feedback WHERE id = ?`, [res.body.feedback_id]);
      assert.ok(saved);
      assert.strictEqual(saved.rating, 2);
      assert.strictEqual(saved.table_number, '12');
      assert.strictEqual(saved.is_flagged, 1);

      // Verify quality_complaints table has high severity entry
      const complaint = await getQuery(
        `SELECT * FROM quality_complaints WHERE description LIKE '%طاولة: 12%' ORDER BY created_at DESC LIMIT 1`
      );
      assert.ok(complaint, 'Quality complaint must be created for low rating');
      assert.strictEqual(complaint.severity, 'HIGH');
      assert.ok(complaint.description.includes('2/5 نجوم'));
    });

    it('public/qr-menu.html should contain 5-star interactive rating UI and conditional comment box', () => {
      const qrHtml = fs.readFileSync(path.join(__dirname, 'public', 'qr-menu.html'), 'utf8');
      assert.ok(qrHtml.includes('كيف كانت تجربتك؟'), 'qr-menu.html must have experience feedback title');
      assert.ok(qrHtml.includes('star-btn'), 'qr-menu.html must have star buttons');
      assert.ok(qrHtml.includes('setStarRating'), 'qr-menu.html must define setStarRating function');
      assert.ok(qrHtml.includes('submitGuestFeedback'), 'qr-menu.html must define submitGuestFeedback function');
      assert.ok(qrHtml.includes('/api/public/feedback'), 'qr-menu.html must post to /api/public/feedback');
    });
  });
});
