/**
 * Dynamic Recipe Costing & Menu Engineering Matrix Service (Stars vs Dogs)
 * Computes live contribution margins from latest supplier inventory prices and categorizes items.
 */
'use strict';

const { allQuery, getQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

/**
 * Calculate dynamic recipe cost for a menu item based on current raw material costs
 */
async function calculateItemDynamicCost(menuItemId) {
  const mId = parseInt(menuItemId, 10) || menuItemId;
  let ingredients = [];

  try {
    ingredients = await allQuery(`
      SELECT r.ingredient_id, 
             r.quantity_required, 
             r.unit as recipe_unit,
             i.name as ingredient_name,
             i.unit as stock_unit,
             COALESCE(i.cost_per_unit_minor / 100.0, 0) as latest_cost_per_unit
      FROM recipes r
      JOIN inventory_items i ON r.ingredient_id = i.id
      WHERE r.menu_item_id = ? OR r.menu_item_id = ?
    `, [mId, String(menuItemId)]);
  } catch (e) {}

  if (!ingredients || ingredients.length === 0) {
    try {
      ingredients = await allQuery(`
        SELECT r.ingredient_id, 
               r.quantity_required, 
               r.unit as recipe_unit,
               i.name as ingredient_name,
               i.unit as stock_unit,
               COALESCE(i.cost_per_unit, 0) as latest_cost_per_unit
        FROM recipes r
        JOIN inventory i ON r.ingredient_id = i.id
        WHERE r.menu_item_id = ? OR r.menu_item_id = ?
      `, [mId, String(menuItemId)]);
    } catch (e) {}
  }

  let totalCostEgp = 0;
  const ingredientsBreakdown = [];

  for (const ing of (ingredients || [])) {
    const qty = Number(ing.quantity_required) || 0;
    const unitCost = Number(ing.latest_cost_per_unit) || 0;
    const cost = Math.round(qty * unitCost * 100) / 100;
    totalCostEgp += cost;

    ingredientsBreakdown.push({
      ingredient_id: ing.ingredient_id,
      ingredient_name: ing.ingredient_name,
      quantity_required: qty,
      unit: ing.recipe_unit || ing.stock_unit,
      latest_cost_per_unit: unitCost,
      calculated_cost: cost
    });
  }

  return {
    total_cost_egp: Math.round(totalCostEgp * 100) / 100,
    ingredients_breakdown: ingredientsBreakdown
  };
}

/**
 * Generate Menu Engineering BCG Matrix Report (Stars, Plowhorses, Puzzles, Dogs)
 */
async function getMenuEngineeringReport(marginThresholdPercent = 40) {
  let menuItems = [];

  try {
    menuItems = await allQuery(`
      SELECT m.id, m.name, 
             COALESCE(mc.name, m.department, 'عام') as category,
             COALESCE(mp.amount_minor / 100.0, 0) as price,
             m.is_available as is_active,
             COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE (oi.item_name_snapshot = m.name OR oi.item_name = m.name) AND oi.status = 'SETTLED'), 0) as sales_volume
      FROM menu_items m
      LEFT JOIN menu_prices mp ON m.id = mp.menu_item_id AND mp.valid_to IS NULL
      LEFT JOIN menu_categories mc ON m.category_id = mc.id
      WHERE m.is_available = 1
    `);
  } catch (e) {}

  if (!menuItems || menuItems.length === 0) {
    try {
      menuItems = await allQuery(`
        SELECT m.id, m.name, 
               COALESCE(m.category, 'عام') as category, 
               COALESCE(m.price, 0) as price, 
               COALESCE(m.is_active, 1) as is_active,
               COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.item_name = m.name AND oi.status = 'SETTLED'), 0) as sales_volume
        FROM menu_items m
        WHERE m.is_active = 1
      `);
    } catch (e) {}
  }

  if (!menuItems || menuItems.length === 0) {
    return {
      success: true,
      summary: { total_items: 0, average_contribution_margin: 0, average_sales_volume: 0, counts: { stars: 0, plowhorses: 0, puzzles: 0, dogs: 0 } },
      matrix: { stars: [], plowhorses: [], puzzles: [], dogs: [] },
      critical_alerts: []
    };
  }

  // Calculate dynamic costs and contribution margins
  const analyzedItems = [];
  let totalVolume = 0;
  let totalMargin = 0;

  for (const item of menuItems) {
    const costData = await calculateItemDynamicCost(item.id);
    
    // Fallback: if no BOM recipe is defined, estimate cost at 25% of selling price
    const realCost = costData.total_cost_egp > 0 ? costData.total_cost_egp : Math.round((item.price || 0) * 0.25 * 100) / 100;
    const sellingPrice = Number(item.price) || 0;
    const contributionMargin = Math.max(0, sellingPrice - realCost);
    const marginPercent = sellingPrice > 0 ? Math.round((contributionMargin / sellingPrice) * 1000) / 10 : 0;
    const salesVolume = Number(item.sales_volume) || 0;

    totalVolume += salesVolume;
    totalMargin += contributionMargin;

    analyzedItems.push({
      id: item.id,
      name: item.name,
      category: item.category,
      price: sellingPrice,
      real_cost: realCost,
      contribution_margin: Math.round(contributionMargin * 100) / 100,
      margin_percent: marginPercent,
      sales_volume: salesVolume,
      has_bom_recipe: costData.total_cost_egp > 0,
      ingredients: costData.ingredients_breakdown
    });
  }

  const avgVolume = totalVolume / (analyzedItems.length || 1);
  const avgMargin = totalMargin / (analyzedItems.length || 1);

  const stars = [];       // High Margin, High Volume
  const plowhorses = [];  // Low Margin, High Volume
  const puzzles = [];     // High Margin, Low Volume
  const dogs = [];        // Low Margin, Low Volume
  const criticalAlerts = [];

  for (const item of analyzedItems) {
    const isHighVolume = item.sales_volume >= avgVolume;
    const isHighMargin = item.contribution_margin >= avgMargin;

    if (isHighVolume && isHighMargin) {
      item.classification = 'STAR';
      item.classification_ar = 'نجم ساطع (Star) ⭐';
      item.recommendation_ar = 'حافظ على الجودة وثبات السعر، هذا صنف رابح وشهير.';
      stars.push(item);
    } else if (isHighVolume && !isHighMargin) {
      item.classification = 'PLOWHORSE';
      item.classification_ar = 'حصان جر (Plowhorse) 🐎';
      item.recommendation_ar = 'حجم المبيعات مرتفع لكن الهامش ضعيف، أعد هندسة الوصفة أو ارفع السعر تدريجياً.';
      plowhorses.push(item);
    } else if (!isHighVolume && isHighMargin) {
      item.classification = 'PUZZLE';
      item.classification_ar = 'لغز محير (Puzzle) 🧩';
      item.recommendation_ar = 'الربحية ممتازة لكن المبيعات منخفضة، قم بحملة ترويجية أو أبرز موقعه في المنيو.';
      puzzles.push(item);
    } else {
      item.classification = 'DOG';
      item.classification_ar = 'صنف خاسر (Dog) 🐕';
      item.recommendation_ar = 'هامش ومبيعات منخفضة، مرشح للاستبدال أو الإلغاء من القائمة.';
      dogs.push(item);
    }

    // Critical low-margin alert
    if (item.margin_percent < marginThresholdPercent && item.price > 0) {
      criticalAlerts.push({
        item_id: item.id,
        item_name: item.name,
        current_margin_percent: item.margin_percent,
        threshold_percent: marginThresholdPercent,
        selling_price: item.price,
        real_cost: item.real_cost,
        message: `تنبيه ربحية: صنف [${item.name}] انخفض هامش ربحه إلى ${item.margin_percent}% وهو أقل من الحد الآمن (${marginThresholdPercent}%).`
      });
    }
  }

  return {
    success: true,
    summary: {
      total_items: analyzedItems.length,
      average_contribution_margin: Math.round(avgMargin * 100) / 100,
      average_sales_volume: Math.round(avgVolume * 10) / 10,
      margin_threshold_alert_percent: marginThresholdPercent,
      critical_alerts_count: criticalAlerts.length,
      counts: {
        stars: stars.length,
        plowhorses: plowhorses.length,
        puzzles: puzzles.length,
        dogs: dogs.length
      }
    },
    matrix: {
      stars,
      plowhorses,
      puzzles,
      dogs
    },
    critical_alerts: criticalAlerts
  };
}

module.exports = {
  calculateItemDynamicCost,
  getMenuEngineeringReport
};
