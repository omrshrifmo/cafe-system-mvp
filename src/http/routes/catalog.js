/**
 * Canonical Menu & Recipe Catalog HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { getMenu, getRecipeDetails, createMenuItem, publishMenuItem } = require('../../domain/catalog/service');
const { requirePermission } = require('../middleware/permissions');
const { requireAuth } = require('../middleware/auth');
const { allQuery, runQuery } = require('../../db/connection');

// Get canonical hierarchical menu for POS, QR, and KDS
router.get(['/menu', '/catalog', '/catalog/menu'], async (req, res, next) => {
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

// Public menu snapshot for guest QR
router.get(['/public/menu', '/public/catalog/menu'], async (req, res, next) => {
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

// Categories management (Menu Manager)
router.get(['/menu/categories', '/catalog/menu/categories'], async (req, res, next) => {
  try {
    const categories = await allQuery(
      `SELECT c.*, COUNT(m.id) as item_count 
       FROM menu_categories c 
       LEFT JOIN menu_items m ON c.id = m.category_id 
       WHERE (c.is_quarantined = 0 OR c.is_quarantined IS NULL) 
         AND c.name NOT LIKE 'temp_%'
       GROUP BY c.id 
       ORDER BY c.sort_order ASC, c.id ASC`
    );
    res.json({
      success: true,
      categories
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/menu/categories', '/catalog/menu/categories'], requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const { name, name_en, icon = '☕', color = '#f59e0b', sort_order = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم التصنيف مطلوب' });
    }
    const result = await runQuery(
      `INSERT INTO menu_categories (name, name_en, icon, color, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
      [name.trim(), name_en ? name_en.trim() : null, icon, color, sort_order]
    );
    res.json({ success: true, category_id: result.lastID, message: 'تم إضافة التصنيف بنجاح' });
  } catch (err) {
    next(err);
  }
});

router.put(['/menu/categories/:id', '/catalog/menu/categories/:id'], requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const { name, name_en, icon, color, sort_order, is_active } = req.body;
    const catId = req.params.id;
    
    if (is_active !== undefined && name === undefined) {
      await runQuery(`UPDATE menu_categories SET is_active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [is_active ? 1 : 0, catId]);
      return res.json({ success: true, message: 'تم تحديث حالة التصنيف' });
    }

    await runQuery(
      `UPDATE menu_categories SET 
         name = COALESCE(?, name),
         name_en = COALESCE(?, name_en),
         icon = COALESCE(?, icon),
         color = COALESCE(?, color),
         sort_order = COALESCE(?, sort_order),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [name, name_en, icon, color, sort_order, is_active, catId]
    );
    res.json({ success: true, message: 'تم تحديث التصنيف بنجاح' });
  } catch (err) {
    next(err);
  }
});

// Items management (Menu Manager)
router.get(['/menu/items', '/catalog/menu/items'], async (req, res, next) => {
  try {
    const items = await allQuery(
      `SELECT m.id, m.category_id, m.name, m.name_en, m.description, m.department, 
              m.is_available, m.is_featured, m.sort_order, m.sku, m.lifecycle_state, m.publication_version,
              c.name as category_name, c.icon as category_icon,
              COALESCE(p.amount_minor, 0) as price_minor,
              (COALESCE(p.amount_minor, 0) / 100.0) as price,
              COALESCE(p.currency, 'ج.م') as currency
       FROM menu_items m
       LEFT JOIN menu_categories c ON m.category_id = c.id
       LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
       ORDER BY m.sort_order ASC, m.id ASC`
    );
    res.json({
      success: true,
      items
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/menu/items', '/catalog/menu/items'], requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const { sku, name, name_en, category_id, department = 'BARISTA', price_minor, price, description, is_featured = 0, sort_order = 0, instructions } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم الصنف مطلوب' });
    }
    
    // Support either explicit minor units or float price fallback
    const computedPriceMinor = price_minor !== undefined ? price_minor : Math.round((Number(price) || 0) * 100);

    const itemId = await createMenuItem({
      sku, name, name_en, category_id, department, 
      priceMinor: computedPriceMinor, 
      description, is_featured, sort_order, 
      author_id: req.user ? req.user.id : null
    });

    if (instructions) {
      await runQuery(
        `INSERT INTO recipe_versions (menu_item_id, version, instructions) VALUES (?, 1, ?)`,
        [itemId, instructions]
      );
    }

    res.json({ success: true, item_id: itemId, message: 'تم إضافة الصنف بنجاح (DRAFT)' });
  } catch (err) {
    if (err.message && (err.message.includes('duplicate') || err.message.includes('Duplicate'))) {
      return res.status(409).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post(['/menu/items/:id/publish', '/catalog/menu/items/:id/publish'], requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const itemId = req.params.id;
    await publishMenuItem(itemId, req.user ? req.user.id : null);
    res.json({ success: true, message: 'تم نشر الصنف بنجاح' });
  } catch (err) {
    next(err);
  }
});

router.put('/menu/items/:id', requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const itemId = req.params.id;
    const { sku, name, name_en, category_id, department, price_minor, price, description, is_available, is_featured, sort_order } = req.body;

    if (is_available !== undefined && name === undefined && price === undefined && price_minor === undefined) {
      await runQuery(`UPDATE menu_items SET is_available = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [is_available ? 1 : 0, itemId]);
      return res.json({ success: true, message: 'تم تحديث حالة توفر الصنف' });
    }

    // Checking for dupes before updating name/sku
    if (name || sku) {
      const existing = await allQuery(`SELECT id, name, sku FROM menu_items WHERE (name = ? OR (sku = ? AND sku IS NOT NULL)) AND id != ?`, [name, sku, itemId]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, error: 'Duplicate SKU or Name detected.' });
      }
    }

    await runQuery(
      `UPDATE menu_items SET
         sku = COALESCE(?, sku),
         category_id = COALESCE(?, category_id),
         name = COALESCE(?, name),
         name_en = COALESCE(?, name_en),
         description = COALESCE(?, description),
         department = COALESCE(?, department),
         is_available = COALESCE(?, is_available),
         is_featured = COALESCE(?, is_featured),
         sort_order = COALESCE(?, sort_order),
         updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [sku, category_id, name, name_en, description, department, is_available, is_featured, sort_order, itemId]
    );

    if (price !== undefined || price_minor !== undefined) {
      const computedPriceMinor = price_minor !== undefined ? price_minor : Math.round((Number(price) || 0) * 100);
      const authorId = req.user ? req.user.id : null;
      // Close older active price and insert new active price
      await runQuery(`UPDATE menu_prices SET valid_to = datetime('now', 'localtime') WHERE menu_item_id = ? AND valid_to IS NULL`, [itemId]);
      await runQuery(`INSERT INTO menu_prices (menu_item_id, amount_minor, currency, author_id) VALUES (?, ?, 'ج.م', ?)`, [itemId, computedPriceMinor, authorId]);
    }

    res.json({ success: true, message: 'تم تحديث بيانات وسعر الصنف بنجاح' });
  } catch (err) {
    next(err);
  }
});

router.delete('/menu/items/:id', requireAuth, requirePermission('menu:write'), async (req, res, next) => {
  try {
    const itemId = req.params.id;
    await runQuery(`UPDATE menu_items SET is_available = 0, lifecycle_state = 'RETIRED', updated_at = datetime('now', 'localtime') WHERE id = ?`, [itemId]);
    res.json({ success: true, message: 'تم إيقاف وحفظ الصنف بنجاح' });
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

module.exports = router;
