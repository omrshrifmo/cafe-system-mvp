/**
 * Advanced Offers & Promotions Engine for MENA Cafe ERP
 * Evaluates HAPPY_HOUR, BOGO, COMBO, and TIER_DISCOUNT rules.
 */
'use strict';

const { allQuery, getQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

/**
 * List all promotions
 */
async function getAllPromotions() {
  return await allQuery(`SELECT * FROM promotions ORDER BY is_active DESC, id DESC`);
}

/**
 * Create a new promotion campaign
 */
async function createPromotion(promoData) {
  const {
    name,
    type,
    target_item_name,
    reward_item_name,
    discount_percent = 0,
    discount_amount = 0,
    start_time,
    end_time,
    min_spend = 0,
    customer_tier = 'ALL'
  } = promoData;

  if (!name || !type) {
    throw new Error('VALIDATION_ERROR: اسم العرض ونوعه مطلوبان');
  }

  const res = await runQuery(
    `INSERT INTO promotions (name, type, target_item_name, reward_item_name, discount_percent, discount_amount, start_time, end_time, min_spend, customer_tier, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      name,
      type.toUpperCase(),
      target_item_name || null,
      reward_item_name || null,
      Number(discount_percent) || 0,
      Number(discount_amount) || 0,
      start_time || null,
      end_time || null,
      Number(min_spend) || 0,
      customer_tier || 'ALL'
    ]
  );

  return {
    success: true,
    message: `تم إنشاء العرض الترويجي [${name}] بنجاح 🎁`,
    promotion_id: res.lastID
  };
}

/**
 * Toggle promotion status
 */
async function togglePromotion(id, isActive) {
  await runQuery(`UPDATE promotions SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
  return { success: true, message: 'تم تحديث حالة العرض' };
}

/**
 * Delete promotion
 */
async function deletePromotion(id) {
  await runQuery(`DELETE FROM promotions WHERE id = ?`, [id]);
  return { success: true, message: 'تم حذف العرض' };
}

/**
 * Scan cart items and customer profile for applicable promotions, selecting the highest discount
 * @param {Array} items - [{ item_name, price, quantity, unit_price_minor }]
 * @param {Object} context - { subtotalMinor, customer_phone, customer_tier, currentTime }
 */
async function evaluateBestPromotion(items = [], context = {}) {
  const activePromos = await allQuery(`SELECT * FROM promotions WHERE is_active = 1`);
  if (!activePromos || activePromos.length === 0) {
    return { appliedPromotion: null, discountMinor: 0 };
  }

  const subtotalMinor = context.subtotalMinor || items.reduce((s, it) => s + (it.price || it.unit_price_minor/100 || 0) * (it.quantity || 1) * 100, 0);
  const now = context.currentTime || new Date();
  const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const customerTier = context.customer_tier || 'ALL';

  let bestPromo = null;
  let maxDiscountMinor = 0;

  for (const promo of activePromos) {
    // 1. Check Customer Tier
    if (promo.customer_tier && promo.customer_tier !== 'ALL' && promo.customer_tier !== customerTier) {
      continue;
    }

    // 2. Check Min Spend
    if (promo.min_spend > 0 && subtotalMinor < (promo.min_spend * 100)) {
      continue;
    }

    // 3. Check Time Window (Happy Hour)
    if (promo.start_time && promo.end_time) {
      if (currentHourMin < promo.start_time || currentHourMin > promo.end_time) {
        continue;
      }
    }

    let calculatedDiscountMinor = 0;

    switch (promo.type) {
      case 'HAPPY_HOUR':
      case 'PERCENTAGE':
        if (promo.discount_percent > 0) {
          calculatedDiscountMinor = Math.round((subtotalMinor * promo.discount_percent) / 100);
        } else if (promo.discount_amount > 0) {
          calculatedDiscountMinor = Math.round(promo.discount_amount * 100);
        }
        break;

      case 'BOGO':
        // Buy 1 Target Item, Get Reward Item Free / Discounted
        const targetItem = items.find(it => (it.item_name || it.name || '').includes(promo.target_item_name || ''));
        if (targetItem && targetItem.quantity >= 1) {
          // If reward item specified, check if present in cart; otherwise discount the second target item
          if (promo.reward_item_name) {
            const rewardItem = items.find(it => (it.item_name || it.name || '').includes(promo.reward_item_name));
            if (rewardItem) {
              calculatedDiscountMinor = Math.round((rewardItem.price || (rewardItem.unit_price_minor / 100) || 0) * 100);
            }
          } else if (targetItem.quantity >= 2) {
            // Free 2nd item
            const itemUnitPriceMinor = Math.round((targetItem.price || (targetItem.unit_price_minor / 100) || 0) * 100);
            calculatedDiscountMinor = itemUnitPriceMinor;
          }
        }
        break;

      case 'COMBO':
        // Fixed combo discount
        if (promo.discount_amount > 0) {
          calculatedDiscountMinor = Math.round(promo.discount_amount * 100);
        }
        break;

      case 'TIER_DISCOUNT':
        if (promo.discount_percent > 0) {
          calculatedDiscountMinor = Math.round((subtotalMinor * promo.discount_percent) / 100);
        }
        break;
    }

    if (calculatedDiscountMinor > maxDiscountMinor) {
      maxDiscountMinor = calculatedDiscountMinor;
      bestPromo = {
        id: promo.id,
        name: promo.name,
        type: promo.type,
        discount_amount_minor: calculatedDiscountMinor,
        discount_amount_egp: calculatedDiscountMinor / 100.0
      };
    }
  }

  return {
    appliedPromotion: bestPromo,
    discountMinor: maxDiscountMinor,
    discountEgp: maxDiscountMinor / 100.0
  };
}

module.exports = {
  getAllPromotions,
  createPromotion,
  togglePromotion,
  deletePromotion,
  evaluateBestPromotion
};
