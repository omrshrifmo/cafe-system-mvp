const { allQuery, getQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

async function getActiveOffers() {
  const sql = `
    SELECT id, name, description, discount_type, discount_value_minor,
           eligibility_rules_json, stacking_rules_json, usage_limit,
           valid_from, valid_to, lifecycle_state
    FROM catalog_offers
    WHERE lifecycle_state = 'PUBLISHED'
      AND valid_from <= datetime('now', 'localtime')
      AND (valid_to IS NULL OR valid_to >= datetime('now', 'localtime'))
  `;
  const offers = await allQuery(sql);
  
  return offers.map(o => ({
    ...o,
    eligibility_rules: JSON.parse(o.eligibility_rules_json),
    stacking_rules: JSON.parse(o.stacking_rules_json)
  }));
}

// Evaluate eligibility for an order item
function evaluateOffer(offer, item, qty, customerRole = null, currentVenue = null) {
  // If the offer specifies venues, check if currentVenue is in it
  if (offer.eligibility_rules.venues && offer.eligibility_rules.venues.length > 0) {
    if (!currentVenue || !offer.eligibility_rules.venues.includes(currentVenue)) return 0;
  }
  
  // Example logic: if item matches some criteria in eligibility
  // For simplicity, say offer applies to everything for now if not restricted
  
  let discountMinor = 0;
  if (offer.discount_type === 'PERCENTAGE') {
    discountMinor = Math.floor((item.price_minor * qty * offer.discount_value_minor) / 100);
  } else if (offer.discount_type === 'FIXED_AMOUNT') {
    discountMinor = offer.discount_value_minor * qty;
  }
  
  return Math.min(discountMinor, item.price_minor * qty); // Cannot discount more than price
}

module.exports = {
  getActiveOffers,
  evaluateOffer
};
