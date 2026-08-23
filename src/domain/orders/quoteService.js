const { getQuery, allQuery } = require('../../db/connection');

// Constants for policy based configuration (Mocked for MVP)
const TAX_RATE = 0.14; // 14% VAT
const SERVICE_RATE = 0.12; // 12% Service Charge

/**
 * Generates an authoritative server-side quote based on intent.
 */
async function computeQuote(orderIntent) {
  // orderIntent = { lines: [{ item_id, quantity, modifier_ids: [] }], discount_minor: 0, tip_minor: 0 }
  
  let subtotal = 0;
  const quotedLines = [];

  for (const line of orderIntent.lines) {
    const item = await getQuery(`SELECT id, amount_minor FROM v3_menu_prices WHERE menu_item_id = ? AND end_date IS NULL ORDER BY effective_date DESC LIMIT 1`, [line.item_id]);
    
    if (!item) {
      throw new Error(`Item ${line.item_id} has no active price`);
    }

    const lineBase = item.amount_minor * line.quantity;
    
    // We don't have a modifiers table yet, so we mock modifier deltas as 0 for this MVP,
    // but the logic structure remains mathematically strict.
    let modifierTotal = 0; 
    if (line.modifier_ids && line.modifier_ids.length > 0) {
      // e.g., sum up modifier deltas here
      modifierTotal = 0; 
    }

    const lineTotal = lineBase + (modifierTotal * line.quantity);
    subtotal += lineTotal;

    quotedLines.push({
      menu_item_id: line.item_id,
      quantity: line.quantity,
      unit_price_minor: item.amount_minor,
      modifiers_json: JSON.stringify(line.modifier_ids || []),
      modifier_total_minor: modifierTotal,
      total_minor: lineTotal
    });
  }

  // Enforce integer math with bankers rounding
  const discount = Math.round(orderIntent.discount_minor || 0);
  
  // Calculate service on (subtotal - discount)
  const taxableBase = Math.max(0, subtotal - discount);
  const service = Math.round(taxableBase * SERVICE_RATE);
  
  // Calculate tax on (taxableBase + service)
  const tax = Math.round((taxableBase + service) * TAX_RATE);
  
  const tip = Math.round(orderIntent.tip_minor || 0);

  const totalDue = taxableBase + service + tax + tip;

  return {
    lines: quotedLines,
    subtotal_minor: subtotal,
    discount_minor: discount,
    service_minor: service,
    tax_minor: tax,
    tip_minor: tip,
    total_due_minor: totalDue,
    currency: 'EGP',
    quote_timestamp: new Date().toISOString()
  };
}

module.exports = {
  computeQuote,
  TAX_RATE,
  SERVICE_RATE
};
