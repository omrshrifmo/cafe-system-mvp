/**
 * Automated Verification Test Suite for Desktop Commercialization & DevOps Pipeline
 * 1. Licensing middleware & kill-switch (24h ping, MAC address resolution, 7-day offline JWT, 402 enforcement)
 * 2. V8 Bytecode compiler verification (.jsc artifact generation)
 * 3. Desktop Electron configuration & NSIS packaging metadata
 */

const request = require('supertest');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./src/app');
const { getMachineHardwareId, licenseMiddleware, cachedLicenseStatus } = require('./src/http/middleware/license');
const bytenode = require('bytenode');

describe('Mazaj OS - Desktop Packaging & Commercialization Pipeline', function () {
  this.timeout(20000);
  let app;

  before(() => {
    app = createApp();
  });

  describe('1. Hardware ID & Licensing Kill-Switch (src/http/middleware/license.js)', () => {
    it('should successfully detect machine MAC/Hardware ID', () => {
      const hwId = getMachineHardwareId();
      assert.ok(hwId, 'Hardware ID must be returned');
      assert.ok(typeof hwId === 'string' && hwId.length > 5, 'Hardware ID must be a non-empty string');
    });

    it('should allow API traffic when license is valid within grace period', async () => {
      cachedLicenseStatus.active = true;
      cachedLicenseStatus.expiresAt = Date.now() + 7 * 24 * 3600 * 1000;

      const res = await request(app).get('/api/config/public');
      assert.notStrictEqual(res.status, 402, 'Should not return 402 when license is active');
    });

    it('should intercept API requests with HTTP 402 Payment Required when license expires', async () => {
      cachedLicenseStatus.active = false;
      cachedLicenseStatus.expiresAt = Date.now() - 1000; // expired

      const res = await request(app).get('/api/config/public');
      assert.strictEqual(res.status, 402, 'Must return HTTP 402 Payment Required');
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'PAYMENT_REQUIRED');
      assert.ok(res.body.error.includes('انتهت صلاحية الاشتراك'));
      assert.ok(res.body.hardware_id, 'Must include hardware_id in 402 payload');

      // Reset license status for other tests
      cachedLicenseStatus.active = true;
      cachedLicenseStatus.expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
    });
  });

  describe('2. Source Code Protection (V8 Bytecode .jsc Compilation)', () => {
    it('should verify compiled bytecode files exist in dist_bytecode/', () => {
      const serverJsc = path.join(__dirname, 'dist_bytecode/server.jsc');
      assert.ok(fs.existsSync(serverJsc), 'dist_bytecode/server.jsc must exist');
      const stats = fs.statSync(serverJsc);
      assert.ok(stats.size > 100, 'Bytecode file must have non-trivial size');
    });
  });

  describe('3. Electron Desktop Packaging & NSIS Setup (package.json & main.js)', () => {
    it('should verify main.js exists and configures Cloudflare Tunnel & Express', () => {
      const mainPath = path.join(__dirname, 'main.js');
      assert.ok(fs.existsSync(mainPath), 'main.js must exist');
      const mainContent = fs.readFileSync(mainPath, 'utf8');
      assert.ok(mainContent.includes('BrowserWindow'), 'main.js must instantiate BrowserWindow');
      assert.ok(mainContent.includes('cloudflared'), 'main.js must contain Cloudflare Tunnel integration');
      assert.ok(mainContent.includes('fullscreen: true'), 'main.js must configure fullscreen mode');
    });

    it('should verify package.json build configurations for NSIS installer', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      assert.strictEqual(pkg.main, 'main.js', 'package.json main must point to main.js');
      assert.ok(pkg.build, 'package.json must contain build configuration object');
      assert.strictEqual(pkg.build.productName, 'Mazaj OS');
      assert.strictEqual(pkg.build.win.target[0].target, 'nsis');
      assert.strictEqual(pkg.build.nsis.createDesktopShortcut, true);
    });

    it('should verify bin/ directory and documentation exist', () => {
      const binDir = path.join(__dirname, 'bin');
      assert.ok(fs.existsSync(binDir), 'bin/ directory must exist');
      assert.ok(fs.existsSync(path.join(binDir, 'README.md')), 'bin/README.md must exist');
    });
  });
});
