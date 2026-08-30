/**
 * Barista Liquid Density & Conversion Utility
 * Converts mass (grams/kilos) with tare deduction to volume (milliliters/liters)
 */

const DENSITY_PRESETS = {
  WATER: 1.05,
  JUICE: 1.05,
  MILK: 1.03,
  SYRUP: 1.32,
  HONEY: 1.42,
  OIL: 0.92,
  ALCOHOL: 0.79
};

/**
 * Convert liquid mass to volume using density
 * @param {number} grossGrams - Total weight on scale in grams
 * @param {number} tareGrams - Weight of empty container (bottle/jar) in grams
 * @param {string|number} liquidTypeOrDensity - Preset key ('WATER', 'MILK', 'SYRUP', etc.) or custom density (g/mL)
 * @returns {object} { net_grams, density, volume_ml, volume_liters }
 */
function convertLiquidGramsToMl(grossGrams, tareGrams = 0, liquidTypeOrDensity = 'WATER') {
  const gross = Number(grossGrams) || 0;
  const tare = Number(tareGrams) || 0;
  const netGrams = Math.max(0, gross - tare);

  let density = 1.05;
  if (typeof liquidTypeOrDensity === 'number' && liquidTypeOrDensity > 0) {
    density = liquidTypeOrDensity;
  } else if (typeof liquidTypeOrDensity === 'string') {
    const key = liquidTypeOrDensity.toUpperCase().trim();
    density = DENSITY_PRESETS[key] || 1.05;
  }

  // Volume (mL) = Mass (g) / Density (g/mL)
  const volumeMl = netGrams / density;
  const volumeLiters = volumeMl / 1000.0;

  return {
    gross_grams: gross,
    tare_grams: tare,
    net_grams: netGrams,
    density: density,
    volume_ml: Math.round(volumeMl * 100) / 100, // round to 2 decimal places
    volume_liters: Math.round(volumeLiters * 10000) / 10000,
    volume_microunits: Math.round(volumeMl * 1000000) // standard 1e6 microunits representation
  };
}

module.exports = {
  DENSITY_PRESETS,
  convertLiquidGramsToMl
};
