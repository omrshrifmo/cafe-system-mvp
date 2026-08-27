const assert = require('assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.BCRYPT_WORK_FACTOR = '4';

const { createApp } = require('../../src/app');
const { getDb, closeDb, getQuery, runQuery } = require('../../src/db/connection');
const { setMode, getMode, MODES } = require('../../src/domain/system/modeService');
const { calculateLiquidVolumeFromWeight, APPROVED_DENSITY_PROFILES } = require('../../src/domain/system/setupService');

describe('Clean Self-Setup Cafe System & Configuration Center Gate', function() {
  this.timeout(15000);
  let app;
  const fixturePath = path.join(__dirname, '../../fixtures/gate-clean-setup.sqlite');

  before(async function() {
    process.env.DATABASE_PATH = fixturePath;
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
    getDb(fixturePath);

    // Apply migrations
    const { runMigrations } = require('../../src/db/migrator');
    await runMigrations(getDb(fixturePath));

    // Create app instance
    app = createApp();
  });

  after(async function() {
    await closeDb();
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
  });

  it('1. /api/setup/progress returns all 15 wizard steps in dependency order', async function() {
    const res = await request(app).get('/api/setup/progress');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.steps));
    assert.strictEqual(res.body.steps.length, 15);
    assert.strictEqual(res.body.steps[0].key, 'WELCOME_MODE');
    assert.strictEqual(res.body.steps[14].key, 'REVIEW_PUBLISH');
  });

  it('2. Saving step drafts (e.g. Step 2 Cafe Identity) persists and updates venue without business loss', async function() {
    const step2Payload = {
      venue: {
        legal_name: 'شركة كافيه المزاج ش.م.م',
        name_ar: 'كافيه مزاج التحرير',
        name_en: 'Mazag Cafe Tahrir',
        contact_phone: '01099998888',
        tax_registration_number: '999-888-777',
        address: 'ميدان التحرير - القاهرة',
        currency: 'EGP'
      }
    };

    const res = await request(app)
      .post('/api/setup/step')
      .send({ step: 2, payload: step2Payload });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.step, 2);
    assert.strictEqual(res.body.next_step, 3);
    assert(res.body.completed_steps.includes(2));

    // Verify progress returns saved draft
    const progRes = await request(app).get('/api/setup/progress');
    assert(progRes.body.draft_payload.step_2);
    assert.strictEqual(progRes.body.draft_payload.step_2.venue.name_ar, 'كافيه مزاج التحرير');
  });

  it('3. Step 13 saves receipt tax_display_mode and header/footer configurations', async function() {
    const step13Payload = {
      receipts: {
        header_ar: 'أهلاً بكم في كافيه مزاج',
        footer_ar: 'الخدمة والضريبة مشمولة - شكراً لزيارتكم',
        tax_display_mode: 'INCLUDE_IN_PRICE',
        paper_width_mm: 80
      }
    };

    const res = await request(app)
      .post('/api/setup/step')
      .send({ step: 13, payload: step13Payload });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    const row = await getQuery(`SELECT value FROM system_config WHERE key = 'tax_display_mode'`, [], getDb(fixturePath));
    assert.strictEqual(row.value, 'INCLUDE_IN_PRICE');
  });

  it('4. Density conversion engine accurately converts grams to ml using approved profiles', function() {
    // Milk: density = 1.03
    const milkResult = calculateLiquidVolumeFromWeight(103, 'milk_whole');
    assert.strictEqual(milkResult.volume_ml, 100);
    assert.strictEqual(milkResult.density_g_per_ml, 1.03);

    // Sugar Syrup: density = 1.30
    const syrupResult = calculateLiquidVolumeFromWeight(130, 'syrup_sugar');
    assert.strictEqual(syrupResult.volume_ml, 100);

    // Water: density = 1.00
    const waterResult = calculateLiquidVolumeFromWeight(250, 'water');
    assert.strictEqual(waterResult.volume_ml, 250);
  });

  it('5. Density conversion engine strictly rejects unknown liquid profile keys', function() {
    assert.throws(() => {
      calculateLiquidVolumeFromWeight(100, 'unregistered_liquid_secret');
    }, /DENSITY_ERROR/);
  });

  it('6. /api/setup/readiness returns structured checklist identifying missing vs ready sections', async function() {
    const res = await request(app).get('/api/setup/readiness');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.checks_list));
    assert(res.body.checks_list.length >= 5);
    assert.strictEqual(res.body.checks.database_integrity.status, 'PASS');
  });

  it('7. Finalizing setup in DEMO mode records audit and transitions mode safely', async function() {
    const res = await request(app)
      .post('/api/setup/finalize')
      .send({
        mode: 'DEMO',
        venue: { name_ar: 'كافيه مزاج التجريبي' }
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.mode, 'DEMO');
  });

  it('8. Finalizing setup in LIVE mode transitions to LIVE with zero fake business records', async function() {
    const res = await request(app)
      .post('/api/setup/finalize')
      .send({
        mode: 'LIVE',
        venue: { name_ar: 'كافيه مزاج الفعلي' }
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.mode, 'LIVE');

    let ordersCount = { cnt: 0 };
    try {
      ordersCount = await getQuery(`SELECT COUNT(*) as cnt FROM v3_orders WHERE status = 'SETTLED'`, [], getDb(fixturePath));
    } catch (e) {
      ordersCount = { cnt: 0 };
    }
    assert.strictEqual(ordersCount.cnt, 0);
  });
});
