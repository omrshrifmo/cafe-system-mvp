/**
 * Canonical Menu & Recipe BOM Domain Service
 */
const { allQuery, getQuery, runQuery } = require('../../db/connection');

async function getMenu() {
  const categories = await allQuery(
    `SELECT id, name, name_en, icon, color, sort_order, is_active 
     FROM menu_categories 
     WHERE is_active = 1 
     ORDER BY sort_order ASC, id ASC`
  );

  const items = await allQuery(
    `SELECT m.id, m.category_id, m.name, m.name_en, m.description, m.department, 
            m.is_available, m.is_featured, m.sort_order, m.sku, m.image_ref,
            m.allergens, m.tax_class, m.lifecycle_state,
            COALESCE(p.amount_minor, 0) as price_minor,
            COALESCE(p.currency, 'ج.م') as currency
     FROM menu_items m
     LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
     WHERE m.is_available = 1 AND m.lifecycle_state = 'PUBLISHED'
     ORDER BY m.sort_order ASC, m.id ASC`
  );

  const itemsByCategory = new Map();
  for (const item of items) {
    if (!itemsByCategory.has(item.category_id)) {
      itemsByCategory.set(item.category_id, []);
    }
    itemsByCategory.get(item.category_id).push({
      ...item,
      price: (item.price_minor / 100).toFixed(2),
      allergens: item.allergens ? JSON.parse(item.allergens) : []
    });
  }

  return categories.map(cat => ({
    ...cat,
    items: itemsByCategory.get(cat.id) || []
  }));
}

async function getMenuItemWithActivePriceAndBOM(menuItemId) {
  if (!menuItemId) return null;
  const rawQueryStr = String(menuItemId).trim();
  const normalizedStr = rawQueryStr
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

  // Try exact / substring lookup first
  let item = await getQuery(
    `SELECT m.id, m.category_id, m.name, m.department, m.is_available, m.lifecycle_state, m.sku, m.publication_version,
            COALESCE(p.amount_minor, 0) as price_minor,
            COALESCE(p.currency, 'ج.م') as currency,
            r.id as recipe_version_id, r.version as recipe_version,
            r.instructions, r.tolerance_percent_basis_points
     FROM menu_items m
     LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
     LEFT JOIN recipe_versions r ON m.id = r.menu_item_id AND (r.active_to IS NULL OR r.active_to > datetime('now', 'localtime'))
     WHERE m.id = ? OR m.sku = ? OR m.name = ? OR m.name_en = ? OR m.name LIKE ? LIMIT 1`,
    [menuItemId, menuItemId, rawQueryStr, rawQueryStr, `%${rawQueryStr}%`]
  );

  // If not found, try normalized Arabic matching
  if (!item) {
    const allItems = await allQuery(
      `SELECT m.id, m.category_id, m.name, m.department, m.is_available, m.lifecycle_state, m.sku, m.publication_version,
              COALESCE(p.amount_minor, 0) as price_minor,
              COALESCE(p.currency, 'ج.م') as currency,
              r.id as recipe_version_id, r.version as recipe_version,
              r.instructions, r.tolerance_percent_basis_points
       FROM menu_items m
       LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
       LEFT JOIN recipe_versions r ON m.id = r.menu_item_id AND (r.active_to IS NULL OR r.active_to > datetime('now', 'localtime'))
       WHERE m.is_available = 1`
    );

    for (const it of allItems) {
      const normName = it.name.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
      if (normName.includes(normalizedStr) || normalizedStr.includes(normName)) {
        item = it;
        break;
      }
    }
  }

  if (!item) return null;

  let ingredients = [];
  if (item.recipe_version_id) {
    ingredients = await allQuery(
      `SELECT ri.inventory_item_id, ri.quantity_microunits, ri.unit, ri.yield_percent, ri.preparation_loss_percent, ri.cost_basis,
              i.name as inventory_item_name, i.current_stock_microunits, i.cost_per_unit_minor
       FROM recipe_ingredients ri
       JOIN inventory_items i ON ri.inventory_item_id = i.id
       WHERE ri.recipe_version_id = ?`,
      [item.recipe_version_id]
    );
  }

  return {
    ...item,
    price: item.price_minor / 100,
    ingredients: ingredients.map(ing => ({
      ...ing,
      quantity: ing.quantity_microunits / 1000000,
      current_stock: ing.current_stock_microunits / 1000000
    }))
  };
}

async function getRecipeDetails(itemNameOrId) {
  return getMenuItemWithActivePriceAndBOM(itemNameOrId);
}

// Ensure duplicates do not exist
async function validateUniqueItem(sku, name, name_en, excludeId = null) {
  let query = `SELECT id, sku, name, name_en FROM menu_items WHERE (name = ? OR name_en = ? OR (sku = ? AND sku IS NOT NULL))`;
  let params = [name, name_en, sku];
  
  if (excludeId) {
    query += ` AND id != ?`;
    params.push(excludeId);
  }

  const existing = await allQuery(query, params);
  
  if (existing.length > 0) {
    const dup = existing[0];
    if (dup.sku === sku && sku) throw new Error(`Duplicate SKU: ${sku} is already in use by item ${dup.id}`);
    if (dup.name === name || dup.name_en === name_en) throw new Error(`Duplicate Name: duplicate detected with item ${dup.id}`);
  }
}

async function createMenuItem(itemData) {
  const { sku, name, name_en, category_id, department, priceMinor, description, is_featured, sort_order, author_id } = itemData;
  
  await validateUniqueItem(sku, name, name_en);

  const itemRes = await runQuery(
    `INSERT INTO menu_items (sku, category_id, name, name_en, description, department, is_available, is_featured, sort_order, lifecycle_state) 
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'DRAFT')`,
    [sku || null, category_id || 1, name.trim(), name_en ? name_en.trim() : null, description || null, department || 'BARISTA', is_featured ? 1 : 0, sort_order || 0]
  );

  const itemId = itemRes.lastID;
  if (priceMinor !== undefined) {
    await runQuery(`INSERT INTO menu_prices (menu_item_id, amount_minor, currency, author_id) VALUES (?, ?, 'ج.م', ?)`, [itemId, priceMinor, author_id]);
  }

  return itemId;
}

async function publishMenuItem(itemId, author_id) {
  // Simple lifecycle publish
  const item = await getQuery(`SELECT lifecycle_state, publication_version FROM menu_items WHERE id = ?`, [itemId]);
  if (!item) throw new Error("Item not found");
  
  if (item.lifecycle_state === 'PUBLISHED') return true;

  const newVersion = item.publication_version + 1;
  await runQuery(`UPDATE menu_items SET lifecycle_state = 'PUBLISHED', publication_version = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newVersion, itemId]);
  
  return true;
}

module.exports = {
  getMenu,
  getMenuItemWithActivePriceAndBOM,
  getRecipeDetails,
  createMenuItem,
  publishMenuItem
};
