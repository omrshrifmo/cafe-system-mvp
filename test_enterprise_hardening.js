/**
 * Standalone Node.js Runner for Enterprise Hardening Tests
 * Usage: node test_enterprise_hardening.js
 */
const { execSync } = require('child_process');

console.log('🚀 Running Enterprise Hardening & Concurrency Test Suite...');
try {
  const output = execSync('npx mocha test/security/test_enterprise_hardening.js --timeout 60000', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  console.log('✅ Enterprise Hardening Tests Passed Successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Enterprise Hardening Tests Failed:', error.message);
  process.exit(1);
}
