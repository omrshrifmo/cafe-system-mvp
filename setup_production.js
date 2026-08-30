/**
 * Root wrapper for scripts/setup_production.js
 */
const { setupProduction } = require('./scripts/setup_production');

setupProduction()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Production Setup Failed:', err);
    process.exit(1);
  });
