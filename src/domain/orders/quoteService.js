const crypto = require('crypto');
const { getQuery, allQuery } = require('../../db/connection');

// Constants for policy based configuration
const DEFAULT_TAX_RATE = 0.14; // 14% VAT
const DEFAULT_SERVICE_RATE = 0.12; // 12% Service Charge

/**
 * Generates an authoritative server-side quote based on intent or session.
 */
async function computeQuote(orderIntent = {}) {
  // orderIntent = { order_id, session_id, table_number, lines: [{ item_id, item_name, quantity, modifier_ids: [] }], discount_minor: 0, tip_minor: 0, request_id }
  
  let subtotalMinor = 0;
  const quotedLines = [];

  // 1. Resolve active catalog publication and policy versions
  let catalogVersion = 1;
  try {
    const cat = await getQuery(`SELECT version FROM v3_catalogs WHERE status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`);
    if (cat && cat.version) catalogVersion = cat.version;
  } catch (e) {}

  let policyVersion = 1;
  let vatRate = DEFAULT_TAX_RATE;
  let serviceRate = DEFAULT_SERVICE_RATE;
  try {
    const pol = await getQuery(`SELECT version, vat_rate, service_charge_rate FROM v3_policies WHERE status = 'ACTIVE' ORDER BY version DESC LIMIT 1`);
    if (pol) {
      if (pol.version) policyVersion = pol.version;
      if (pol.vat_rate !== undefined && pol.vat_rate !== null) vatRate = Number(pol.vat_rate);
      if (pol.service_charge_rate !== undefined && pol.service_charge_rate !== null) serviceRate = Number(pol.service_charge_rate);
    }
  } catch (e) {}

  const lines = Array.isArray(orderIntent.lines) ? orderIntent.lines : [];

  for (const line of lines) {
    const targetId = line.item_id || line.id || line.menu_item_id;
    const targetName = line.item_name || line.name;
    const qty = Math.max(1, parseInt(line.quantity, 10) || 1);

    // Look up item and price in v3 or legacy tables
    let priceMinor = null;
    let itemName = targetName || 'صنف';
    let recipeVersionId = null;

    if (targetId) {
      const v3Price = await getQuery(
        `SELECT p.amount_minor, m.name
         FROM v3_menu_prices p
         JOIN v3_menu_items m ON p.menu_item_id = m.id
         WHERE p.menu_item_id = ? AND p.end_date IS NULL
         ORDER BY p.effective_date DESC LIMIT 1`,
        [targetId]
      );
      if (v3Price) {
        priceMinor = v3Price.amount_minor;
        itemName = v3Price.name;
      }
    }

    if (priceMinor === null && targetName) {
      const v3ByName = await getQuery(
        `SELECT p.amount_minor, m.id as item_id, m.name
         FROM v3_menu_items m
         JOIN v3_menu_prices p ON p.menu_item_id = m.id
         WHERE m.name = ? AND p.end_date IS NULL
         ORDER BY p.effective_date DESC LIMIT 1`,
        [targetName]
      );
      if (v3ByName) {
        priceMinor = v3ByName.amount_minor;
        itemName = v3ByName.name;
      }
    }

    if (priceMinor === null && (targetId || targetName)) {
      try {
        const legacyItem = await getQuery(
          `SELECT id, name, price FROM menu_items WHERE id = ? OR name = ? LIMIT 1`,
          [targetId || 0, targetName || '']
        );
        if (legacyItem) {
          priceMinor = Math.round(Number(legacyItem.price || 0) * 100);
          itemName = legacyItem.name;
        }
      } catch (e) {}
    }

    // Fallback if price is directly provided in intent for custom lines
    if (priceMinor === null) {
      if (line.price_minor !== undefined) {
        priceMinor = parseInt(line.price_minor, 10) || 0;
      } else if (line.unit_price_minor !== undefined) {
        priceMinor = parseInt(line.unit_price_minor, 10) || 0;
      } else if (line.price !== undefined) {
        priceMinor = Math.round(Number(line.price) * 100);
      } else {
        throw new Error(`NOT_FOUND: Item ${targetId || targetName} has no active price truth`);
      }
    }

    let modifierTotalMinor = 0;
    if (Array.isArray(line.modifier_ids) && line.modifier_ids.length > 0) {
      modifierTotalMinor = 0;
    } else if (line.modifier_total_minor) {
      modifierTotalMinor = parseInt(line.modifier_total_minor, 10) || 0;
    }

    const lineBaseMinor = priceMinor * qty;
    const lineTotalMinor = lineBaseMinor + (modifierTotalMinor * qty);
    subtotalMinor += lineTotalMinor;

    quotedLines.push({
      menu_item_id: targetId || null,
      item_name: itemName,
      quantity: qty,
      unit_price_minor: priceMinor,
      modifiers_json: JSON.stringify(line.modifier_ids || line.modifiers || []),
      modifier_total_minor: modifierTotalMinor,
      total_minor: lineTotalMinor,
      recipe_version_id: recipeVersionId,
      catalog_version: catalogVersion
    });
  }

  // Integer minor-unit math with standard rounding
  const discountMinor = Math.max(0, Math.round(Number(orderIntent.discount_minor || (orderIntent.discount_amount ? orderIntent.discount_amount * 100 : 0))));
  const taxableBaseMinor = Math.max(0, subtotalMinor - discountMinor);
  const serviceMinor = Math.round(taxableBaseMinor * serviceRate);
  const taxMinor = Math.round((taxableBaseMinor + serviceMinor) * vatRate);
  const tipMinor = Math.max(0, Math.round(Number(orderIntent.tip_minor || (orderIntent.tip_amount ? orderIntent.tip_amount * 100 : 0))));
  const totalDueMinor = taxableBaseMinor + serviceMinor + taxMinor + tipMinor;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const requestId = orderIntent.request_id || `REQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  return {
    order_id: orderIntent.order_id || orderIntent.session_id || null,
    session_id: orderIntent.session_id || orderIntent.order_id || null,
    table_number: orderIntent.table_number || null,
    lines: quotedLines,
    subtotal_minor: subtotalMinor,
    discount_minor: discountMinor,
    service_minor: serviceMinor,
    tax_minor: taxMinor,
    tip_minor: tipMinor,
    total_due_minor: totalDueMinor,
    subtotal: subtotalMinor / 100,
    service_amount: serviceMinor / 100,
    vat_amount: taxMinor / 100,
    discount_amount: discountMinor / 100,
    tip_amount: tipMinor / 100,
    total_amount: totalDueMinor / 100,
    currency: 'EGP',
    rounding: 'ROUND_HALF_UP',
    versions: {
      catalog_version: catalogVersion,
      policy_version: policyVersion
    },
    quote_timestamp: now.toISOString(),
    expires_at: expiresAt,
    request_id: requestId
  };
}

module.exports = {
  computeQuote,
  TAX_RATE: DEFAULT_TAX_RATE,
  SERVICE_RATE: DEFAULT_SERVICE_RATE
};
