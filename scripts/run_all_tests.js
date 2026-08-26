/**
 * Authoritative Enterprise Test Runner & Regression Verification Suite
 * Executes all test files across unit, integration, security, and performance suites.
 * Enforces per-suite fixture isolation, metrics collection, and exit codes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findTestFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(findTestFiles(fullPath));
    } else if (entry.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function resetTestFixture(rootDir) {
  const fixturePath = path.join(rootDir, 'test', 'fixtures', 'full_day_fixture.db');
  const demoPath = path.join(rootDir, 'fixtures', 'demo-normal.sqlite');
  try {
    if (fs.existsSync(`${fixturePath}-wal`)) fs.unlinkSync(`${fixturePath}-wal`);
    if (fs.existsSync(`${fixturePath}-shm`)) fs.unlinkSync(`${fixturePath}-shm`);
    fs.copyFileSync(demoPath, fixturePath);
  } catch (e) {}
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const testDir = path.join(rootDir, 'test');
  const allTests = findTestFiles(testDir);

  // Group by category
  const categories = {
    unit: allTests.filter(f => f.includes('/test/unit/')),
    integration: allTests.filter(f => f.includes('/test/integration/')),
    security: allTests.filter(f => f.includes('/test/security/')),
    performance: allTests.filter(f => f.includes('/test/performance/'))
  };

  console.log(`=======================================================`);
  console.log(`  MENA Cafe ERP Enterprise Automated Test Runner`);
  console.log(`  Total Test Suites Discovered: ${allTests.length}`);
  console.log(`  - Unit: ${categories.unit.length}`);
  console.log(`  - Integration: ${categories.integration.length}`);
  console.log(`  - Security & Release Gates: ${categories.security.length}`);
  console.log(`  - Performance & Benchmarks: ${categories.performance.length}`);
  console.log(`=======================================================\n`);

  let totalPassing = 0;
  let totalFailing = 0;
  const failureDetails = [];
  const startTime = Date.now();

  for (let i = 0; i < allTests.length; i++) {
    const testFile = allTests[i];
    const relPath = path.relative(rootDir, testFile);
    process.stdout.write(`[${String(i + 1).padStart(2, ' ')}/${allTests.length}] Running ${relPath}... `);

    // Pristine fixture reset before each suite
    resetTestFixture(rootDir);

    const testStart = Date.now();
    const result = spawnSync('npx', ['mocha', testFile, '--timeout', '60000', '--exit'], {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf8'
    });
    const testDuration = Date.now() - testStart;

    const output = (result.stdout || '') + (result.stderr || '');
    const match = output.match(/(\d+)\s+passing/);
    const passCount = match ? parseInt(match[1], 10) : 0;

    if (result.status === 0 && passCount > 0) {
      totalPassing += passCount;
      console.log(`✅ PASS (${passCount} tests, ${testDuration}ms)`);
    } else {
      totalFailing++;
      console.log(`❌ FAIL (exit ${result.status}, ${testDuration}ms)`);
      failureDetails.push({
        file: relPath,
        status: result.status,
        output: output.trim()
      });
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n=======================================================`);
  console.log(`  TEST RUN SUMMARY`);
  console.log(`  Suites Passed: ${allTests.length - totalFailing} / ${allTests.length}`);
  console.log(`  Individual Tests Passed: ${totalPassing}`);
  console.log(`  Failed Suites: ${totalFailing}`);
  console.log(`  Total Execution Time: ${totalDuration}s`);
  console.log(`=======================================================`);

  if (failureDetails.length > 0) {
    console.error(`\n--- FAILURE DETAILS ---`);
    for (const fail of failureDetails) {
      console.error(`\n>>> ${fail.file} (Exit: ${fail.status})`);
      console.error(fail.output.slice(-1500));
    }
    process.exit(1);
  } else {
    console.log(`\n🎉 ALL ${totalPassing} TESTS PASSED 100% CLEANLY ACROSS ALL SUITES!\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
