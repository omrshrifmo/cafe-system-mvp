/**
 * Shisha BOM Engine & Blend Calculation Service
 * Manages precise shisha consumption (Small vs Large bowl, 70/30 molasses blends, coals)
 */

/**
 * Calculate Shisha Raw Material Consumption
 * - Small Bowl ("حجر صغير"): 11g molasses, 2 coals
 * - Large Bowl ("حجر كبير"): 20g molasses, 3 coals
 * - 70/30 Blended recipes: 70% primary molasses, 30% secondary molasses
 * 
 * @param {string} bowlSize - 'SMALL' / 'حجر صغير' or 'LARGE' / 'حجر كبير'
 * @param {object} options - Configuration for blend and material IDs
 * @returns {object} { bowl_size, total_molasses_grams, coals_count, is_blend, ingredients }
 */
function calculateShishaBOM(bowlSize = 'LARGE', options = {}) {
  const isSmall = String(bowlSize).toUpperCase().includes('SMALL') || String(bowlSize).includes('صغير');
  const totalMolassesGrams = isSmall ? 11 : 20;
  const coalsCount = isSmall ? 2 : 3;

  const isBlend = Boolean(options.isBlend || options.is_blend || options.blend_70_30);
  const primaryMolassesId = options.primaryMolassesId || options.primary_molasses_id || 5;
  const secondaryMolassesId = options.secondaryMolassesId || options.secondary_molasses_id || 13;
  const coalItemId = options.coalItemId || options.coal_item_id || 6;

  const ingredients = [];

  if (isBlend) {
    const primaryGrams = Math.round(totalMolassesGrams * 0.70 * 100) / 100; // 70%
    const secondaryGrams = Math.round(totalMolassesGrams * 0.30 * 100) / 100; // 30%

    ingredients.push({
      inventory_item_id: primaryMolassesId,
      quantity_microunits: Math.round(primaryGrams * 1000000),
      unit: 'g',
      ratio: 0.70,
      grams: primaryGrams,
      name: 'معسل رئيسي (70%)'
    });

    ingredients.push({
      inventory_item_id: secondaryMolassesId,
      quantity_microunits: Math.round(secondaryGrams * 1000000),
      unit: 'g',
      ratio: 0.30,
      grams: secondaryGrams,
      name: 'معسل ميكس إضافي (30%)'
    });
  } else {
    ingredients.push({
      inventory_item_id: primaryMolassesId,
      quantity_microunits: Math.round(totalMolassesGrams * 1000000),
      unit: 'g',
      ratio: 1.0,
      grams: totalMolassesGrams,
      name: 'معسل سادة'
    });
  }

  // Charcoal cubes
  ingredients.push({
    inventory_item_id: coalItemId,
    quantity_microunits: Math.round(coalsCount * 1000000),
    unit: 'pcs',
    count: coalsCount,
    name: 'فحم طبيعي'
  });

  return {
    bowl_size: isSmall ? 'SMALL' : 'LARGE',
    bowl_size_ar: isSmall ? 'حجر صغير' : 'حجر كبير',
    total_molasses_grams: totalMolassesGrams,
    coals_count: coalsCount,
    is_blend: isBlend,
    ingredients
  };
}

module.exports = {
  calculateShishaBOM
};
