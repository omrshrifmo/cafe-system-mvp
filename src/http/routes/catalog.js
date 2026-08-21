/**
 * Canonical Menu & Recipe Catalog HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { getMenu, getRecipeDetails } = require('../../domain/catalog/service');
const { requirePermission } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');
const { allQuery, runQuery } = require('../../db/connection');

router.get('/menu', async (req, res, next) => {
  try {
    const menu = await getMenu();
    res.json({
      success: true,
      menu
    });
  } catch (err) {
    next(err);
  }
});

router.get('/public/menu', async (req, res, next) => {
  try {
    const menu = await getMenu();
    res.json({
      success: true,
      menu
    });
  } catch (err) {
    next(err);
  }
});

router.get('/recipes/:name', async (req, res, next) => {
  try {
    const recipe = await getRecipeDetails(req.params.name);
    if (!recipe) {
      return res.status(404).json({ success: false, error: 'الوصفة غير موجودة' });
    }
    res.json({
      success: true,
      recipe
    });
  } catch (err) {
    next(err);
  }
});

// Admin / BOM manager menu operations
router.post('/menu/items', requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const { name, category_id, department = 'BARISTA', price, instructions } = req.body;
    const priceMinor = Math.round((Number(price) || 0) * 100);

    const itemRes = await runQuery(
      `INSERT INTO menu_items (category_id, name, department, is_available) VALUES (?, ?, ?, 1)`,
      [category_id || 1, name, department]
    );

    const itemId = itemRes.lastID;
    await runQuery(`INSERT INTO menu_prices (menu_item_id, amount_minor) VALUES (?, ?)`, [itemId, priceMinor]);

    if (instructions) {
      await runQuery(
        `INSERT INTO recipe_versions (menu_item_id, version, instructions) VALUES (?, 1, ?)`,
        [itemId, instructions]
      );
    }

    res.json({ success: true, item_id: itemId, message: 'تم إضافة الصنف بنجاح' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
