/**
 * Standalone test runner for Advanced Operations & Profitability Upgrades
 */
'use strict';

const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, 'test', 'fixtures', 'full_day_fixture.db');

const Mocha = require('mocha');

const mocha = new Mocha({
  timeout: 60000,
  reporter: 'spec'
});

mocha.addFile(path.join(__dirname, 'test', 'security', 'test_advanced_operations.js'));

mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
