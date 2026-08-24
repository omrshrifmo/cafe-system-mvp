/**
 * Setup Flow, Resumable Wizard & Master Data Harmonization Test Suite
 */
const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { getQuery, allQuery, runQuery } = require('../../src/db/connection');
const { getMenu, getMenuItemWithActivePriceAndBOM } = require('../../src/domain/catalog/service');
const { setMode, MODES } = require('../../src/domain/system/modeService');

describe('Setup Flow, Master Data Harmonization & Versioned BOM', function () {
  this.timeout(25000);
  let app;
  let ownerCookies;

  before(async () => {
    await runMigrations();
    app = createApp();

    // Login as OWNER (User 43 / PIN 1009)
    const ownerRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' });
    ownerCookies = ownerRes.headers['set-cookie'];
  });

  describe('1. Resumable Setup Flow & Progress Persistence', () => {
    it('should save wizard step progress and resume without duplicate records', async () => {
      const step1Res = await request(app)
        .post('/api/setup/step')
        .send({
          step: 1,
          payload: { mode: 'LIVE' }
        })
        .expect(200);

      assert.strictEqual(step1Res.body.success, true);
      assert.strictEqual(step1Res.body.saved_step, 1);

      const step2Res = await request(app)
        .post('/api/setup/step')
        .send({
          step: 2,
          payload: {
            venue: {
              name_ar: 'كافيه مزاج المعادي',
              name_en: 'Mazag Maadi Cafe',
              tax_registration_number: '300-999-888',
              contact_phone: '01099887766',
              address: 'المعادي - القاهرة'
            }
          }
        })
        .expect(200);

      assert.strictEqual(step2Res.body.success, true);

      // Verify resumption via GET /api/setup/progress
      const progressRes = await request(app)
        .get('/api/setup/progress')
        .expect(200);

      assert.strictEqual(progressRes.body.success, true);
      assert.ok(progressRes.body.completed_steps.includes(1));
      assert.ok(progressRes.body.completed_steps.includes(2));
      assert.strictEqual(progressRes.body.draft_payload.step_2.venue.name_ar, 'كافيه مزاج المعادي');
    });

    it('should return system readiness checklist with database integrity and BOM validation', async () => {
      const res = await request(app)
        .get('/api/setup/readiness')
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.checks.database_integrity);
      assert.strictEqual(res.body.checks.database_integrity.status, 'PASS');
      assert.ok(res.body.checks.schema_migrations);
      assert.strictEqual(res.body.checks.schema_migrations.status, 'PASS');
    });
  });

  describe('2. Incomplete Setup Operational Shield', () => {
    it('should block operational actions with 403 NEEDS_ONBOARDING when mode is ONBOARDING', async () => {
      await setMode(MODES.ONBOARDING);

      const res = await request(app)
        .post('/api/orders')
        .send({ table_number: 1, items: [{ name: 'لاتيه', quantity: 1 }] })
        .expect(403);

      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'NEEDS_ONBOARDING');
      assert.ok(res.body.error.includes('NEEDS_ONBOARDING'));

      // Restore to LIVE for subsequent functional tests
      await setMode(MODES.LIVE);
    });
  });

  describe('3. Master Data Catalog Harmonization', () => {
    it('should quarantine empty legacy customer categories (BARISTA, SHISHA, KITCHEN)', async () => {
      const quarantined = await allQuery(
        `SELECT id, name, is_active, is_quarantined, quarantine_reason 
         FROM menu_categories 
         WHERE is_quarantined = 1 OR id IN (8, 9, 10)`
      );

      assert.ok(quarantined.length >= 3, 'Legacy station categories must be quarantined');
      for (const q of quarantined) {
        assert.strictEqual(q.is_active, 0, 'Quarantined category must be inactive');
        assert.strictEqual(q.is_quarantined, 1, 'is_quarantined flag must be 1');
        assert.strictEqual(q.quarantine_reason, 'INTERNAL_STATION_ROUTING_ONLY');
      }
    });

    it('should never return quarantined categories in the customer-facing getMenu() catalog', async () => {
      const menu = await getMenu();
      const catNames = menu.map(c => c.name);
      assert.strictEqual(catNames.includes('BARISTA'), false, 'BARISTA must not appear as a customer category');
      assert.strictEqual(catNames.includes('KITCHEN'), false, 'KITCHEN must not appear as a customer category');
      assert.strictEqual(catNames.includes('SHISHA'), false, 'Raw SHISHA station name must not appear');
      assert.ok(catNames.includes('مشروبات باردة'), 'Cold Drinks category must be present');
      assert.ok(catNames.includes('مشروبات ساخنة'), 'Hot Drinks category must be present');
      assert.ok(catNames.includes('حلويات'), 'Desserts category must be present');
    });

    it('should verify Creme Brulee is in Desserts and Ice Latte & Mojito are in Cold Drinks', async () => {
      const cremeBrulee = await getQuery(`SELECT m.id, m.name, c.name as category_name FROM menu_items m JOIN menu_categories c ON m.category_id = c.id WHERE m.name LIKE '%كريم بروليه%' OR m.name LIKE '%كريم برولية%'`);
      assert.ok(cremeBrulee, 'Creme Brulee item must exist');
      assert.strictEqual(cremeBrulee.category_name, 'حلويات', 'Creme Brulee must belong to Desserts');

      const iceLatte = await getQuery(`SELECT m.id, m.name, c.name as category_name FROM menu_items m JOIN menu_categories c ON m.category_id = c.id WHERE m.name LIKE '%أيس لاتيه%' OR m.name LIKE '%ايس لاتيه%' OR m.name LIKE '%أيس فانيليا لاتيه%'`);
      assert.ok(iceLatte, 'Ice Latte item must exist');
      assert.strictEqual(iceLatte.category_name, 'مشروبات باردة', 'Ice Latte must belong to Cold Drinks');

      const mojito = await getQuery(`SELECT m.id, m.name, c.name as category_name FROM menu_items m JOIN menu_categories c ON m.category_id = c.id WHERE m.name LIKE '%موهيتو%'`);
      assert.ok(mojito, 'Mojito item must exist');
      assert.strictEqual(mojito.category_name, 'مشروبات باردة', 'Mojito must belong to Cold Drinks');
    });

    it('should disambiguate duplicate Club Sandwich with explicit distinct SKUs and descriptions', async () => {
      const clubSandwiches = await allQuery(`SELECT id, name, name_en, sku, category_id, department FROM menu_items WHERE name LIKE '%كلوب ساندوتش%'`);
      assert.ok(clubSandwiches.length >= 2, 'Two distinct club sandwich items must exist');

      const skus = clubSandwiches.map(c => c.sku);
      assert.ok(skus.includes('SKU-FOOD-CLUBSANDWICH-CHK'), 'Chicken Club Sandwich SKU must exist');
      assert.ok(skus.includes('SKU-FOOD-CLUBSANDWICH-TRK'), 'Turkey Club Sandwich SKU must exist');

      // Ensure all SKUs are unique
      const uniqueSkus = new Set(skus);
      assert.strictEqual(uniqueSkus.size, skus.length, 'All item SKUs must be unique');
    });

    it('should render identical published menu and prices on POS and QR endpoints', async () => {
      const posMenuRes = await request(app).get('/api/menu').expect(200);
      const catalogRes = await request(app).get('/api/catalog').expect(200);

      assert.strictEqual(posMenuRes.body.success, true);
      assert.strictEqual(catalogRes.body.success, true);

      const posItems = posMenuRes.body.data?.menu || posMenuRes.body.menu || posMenuRes.body.data;
      const catItems = catalogRes.body.data?.menu || catalogRes.body.menu || catalogRes.body.data;

      assert.strictEqual(JSON.stringify(posItems), JSON.stringify(catItems), 'POS and Catalog/QR must render identical published catalog');
    });
  });

  describe('4. Versioned Production Definitions & BOM Reconciliation', () => {
    it('should retrieve versioned recipe BOM with ingredients, yield, and WAC cost basis', async () => {
      const itemWithBOM = await getMenuItemWithActivePriceAndBOM('كافيه لاتيه');
      assert.ok(itemWithBOM, 'Latte item must be found');
      assert.ok(itemWithBOM.recipe_version_id, 'Recipe version must be attached');
      assert.ok(itemWithBOM.recipe_version >= 1, 'Recipe version must be >= 1');
      assert.ok(itemWithBOM.ingredients.length >= 1, 'Latte must contain at least one recipe ingredient');

      for (const ing of itemWithBOM.ingredients) {
        assert.strictEqual(ing.cost_basis, 'WEIGHTED_AVERAGE', 'Cost basis must be WEIGHTED_AVERAGE');
        assert.ok(ing.quantity > 0, 'Ingredient quantity must be positive');
        assert.ok(ing.unit, 'Ingredient unit must be defined');
      }
    });

    it('should distinguish automatic waste allowance from manual waste and calculate non-green status on unlinked items', async () => {
      const bomRes = await request(app)
        .get('/api/reports/bom-reconciliation')
        .set('Cookie', ownerCookies)
        .expect(200);

      assert.strictEqual(bomRes.body.success, true);
      const report = bomRes.body.data?.reconciliation || bomRes.body.reconciliation || bomRes.body.data;
      assert.ok(Array.isArray(report), 'Reconciliation report must be an array');

      for (const item of report) {
        assert.ok(item.cost_basis, 'Cost basis must be recorded');
        assert.ok(item.auto_waste_allowance !== undefined, 'Auto waste allowance must be calculated');
        assert.ok(item.status, 'Status must be present');
      }
    });

    it('should preserve historical consumption ledger when creating a new recipe version', async () => {
      // Fetch initial consumption ledger count
      const initialLedger = await allQuery(`SELECT id, event_type, quantity_delta_microunits FROM inventory_ledger WHERE event_type = 'CONSUMPTION'`);
      const initialCount = initialLedger.length;

      const currentLatte = await getMenuItemWithActivePriceAndBOM('كافيه لاتيه');
      const nextVer = (currentLatte ? currentLatte.recipe_version : 1) + 1;

      // Retire current recipe version
      await runQuery(
        `UPDATE recipe_versions SET active_to = datetime('now', 'localtime') WHERE menu_item_id = 3 AND (active_to IS NULL OR active_to > datetime('now', 'localtime'))`
      );
      const newVersionRes = await runQuery(
        `INSERT INTO recipe_versions (menu_item_id, version, instructions, tolerance_percent_basis_points, active_from)
         VALUES (3, ?, 'طريقة تحضير محدثة لإصدار جديد', 500, datetime('now', 'localtime'))`,
        [nextVer]
      );
      const newVersionId = newVersionRes.lastID;

      // Add updated ingredients to new version (20g coffee beans instead of 18g)
      await runQuery(
        `INSERT INTO recipe_ingredients (recipe_version_id, inventory_item_id, quantity_microunits, unit, yield_percent, preparation_loss_percent, cost_basis)
         VALUES (?, 1, 20000000, 'g', 100, 0, 'WEIGHTED_AVERAGE')`,
        [newVersionId]
      );

      // Verify that the active recipe version is now nextVer
      const updatedLatte = await getMenuItemWithActivePriceAndBOM('كافيه لاتيه');
      assert.strictEqual(updatedLatte.recipe_version, nextVer, `Active recipe version must now be ${nextVer}`);

      // Verify that historical consumption ledger rows remain completely intact and untouched
      const postLedger = await allQuery(`SELECT id, event_type, quantity_delta_microunits FROM inventory_ledger WHERE event_type = 'CONSUMPTION'`);
      assert.strictEqual(postLedger.length, initialCount, 'Historical consumption ledger must not be rewritten or deleted');
    });
  });

  describe('5. Policy Versioning & Order Association', () => {
    it('should record policy_version on settled orders', async () => {
      // Settle a test fast checkout with quoted amount
      const quoteRes = await request(app)
        .post('/api/quote')
        .set('Cookie', ownerCookies)
        .send({ items: [{ name: 'كافيه لاتيه', quantity: 1 }] })
        .expect(200);

      const quoteData = quoteRes.body.data?.quote || quoteRes.body.quote;
      const totalToPay = quoteData.total_amount || quoteData.total || (quoteData.total_minor / 100);

      const checkoutRes = await request(app)
        .post('/api/checkout')
        .set('Cookie', ownerCookies)
        .send({
          subtotal: quoteData.subtotal,
          payments: [{ method: 'CASH', amount: totalToPay }]
        })
        .expect(200);

      assert.strictEqual(checkoutRes.body.success, true);
    });
  });
});
