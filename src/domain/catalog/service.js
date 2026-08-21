/**
 * Canonical Menu & Recipe BOM Domain Service
 */
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { runTransaction } = require('../../db/transaction');

async function getMenu() {
  const categories = await allQuery(
    `SELECT id, name, name_en, icon, color, sort_order, is_active 
     FROM menu_categories 
     WHERE is_active = 1 
     ORDER BY sort_order ASC, id ASC`
  );

  const items = await allQuery(
    `SELECT m.id, m.category_id, m.name, m.name_en, m.description, m.department, 
            m.is_available, m.is_featured, m.sort_order,
            COALESCE(p.amount_minor, 0) as price_minor,
            COALESCE(p.currency, 'ج.م') as currency
     FROM menu_items m
     LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
     WHERE m.is_available = 1
     ORDER BY m.sort_order ASC, m.id ASC`
  );

  const itemsByCategory = new Map();
  for (const item of items) {
    if (!itemsByCategory.has(item.category_id)) {
      itemsByCategory.set(item.category_id, []);
    }
    // Present human-readable price along with minor units
    itemsByCategory.get(item.category_id).push({
      ...item,
      price: (item.price_minor / 100).toFixed(2)
    });
  }

  return categories.map(cat => ({
    ...cat,
    items: itemsByCategory.get(cat.id) || []
  }));
}

async function getMenuItemWithActivePriceAndBOM(menuItemId) {
  const item = await getQuery(
    `SELECT m.id, m.category_id, m.name, m.department, m.is_available,
            COALESCE(p.amount_minor, 0) as price_minor,
            COALESCE(p.currency, 'ج.م') as currency,
            r.id as recipe_version_id, r.version as recipe_version,
            r.instructions, r.tolerance_percent_basis_points
     FROM menu_items m
     LEFT JOIN menu_prices p ON m.id = p.menu_item_id AND (p.valid_to IS NULL OR p.valid_to > datetime('now', 'localtime'))
     LEFT JOIN recipe_versions r ON m.id = r.menu_item_id AND (r.active_to IS NULL OR r.active_to > datetime('now', 'localtime'))
     WHERE m.id = ? OR m.name = ?`,
    [menuItemId, menuItemId]
  );

  if (!item) return null;

  let ingredients = [];
  if (item.recipe_version_id) {
    ingredients = await allQuery(
      `SELECT ri.inventory_item_id, ri.quantity_microunits, ri.unit,
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

module.exports = {
  getMenu,
  getMenuItemWithActivePriceAndBOM,
  getRecipeDetails
};
