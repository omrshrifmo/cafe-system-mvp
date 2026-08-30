/**
 * Prompt S5 Security & UX Gate: In-Page Accessible Arabic Components & Zero Native Dialogs
 * Verifies that all browser-native dialogs (alert/confirm/prompt) are removed,
 * accessible in-page Arabic modals/toasts/error handlers are standardized,
 * keyboard/focus trap/Escape policies are enforced, and print/hardware flows are controlled in-page.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { getDb } = require('../../src/db/connection');

describe('Prompt S5: Accessible In-Page Arabic UX & Zero Native Dialog Gate', function () {
  this.timeout(20000);
  let app;
  const publicDir = path.resolve(__dirname, '../../public');
  const UIState = require('../../public/modules/ui-state');

  before(async () => {
    getDb();
    app = createApp();
    const { hashPin } = require('../../src/domain/auth/service');
    const { runQuery } = require('../../src/db/connection');
    const pinHash = await hashPin('8801');
    await runQuery(`INSERT OR REPLACE INTO roles (id, venue_id, name) VALUES ('R_SUPER_ADMIN', 'V_DEFAULT', 'SUPER_ADMIN')`);
    await runQuery(
      `INSERT OR REPLACE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until)
       VALUES ('101', 'V_DEFAULT', 'سوبر أدمن', 'R_SUPER_ADMIN', ?, 1, 0, NULL)`,
      [pinHash]
    );
  });

  describe('1. Static Codebase Audit: Zero Native Browser Dialogs', () => {
    function getFiles(dir, exts = ['.html', '.js']) {
      let results = [];
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFiles(filePath, exts));
        } else if (exts.includes(path.extname(file))) {
          results.push(filePath);
        }
      });
      return results;
    }

    it('proves no application-controlled alert(), confirm(), or prompt() calls exist in public HTML/JS files', () => {
      const files = getFiles(publicDir);
      const violations = [];

      files.forEach((file) => {
        const relPath = path.relative(publicDir, file);
        // Exclude the library definition files that declare/override dialog handlers
        if (relPath === 'modules/ui-state.js' || relPath === 'nav.js') return;

        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          // Remove comments
          const cleanLine = line.replace(/\/\/.*/, '').replace(/\/\*.*?\*\//g, '');
          
          const alertMatch = cleanLine.match(/(?<!UIState\.)(?<!window\.UIState\.)(?<!showInPage)(?<!show)\balert\s*\(/);
          const confirmMatch = cleanLine.match(/(?<!UIState\.)(?<!window\.UIState\.)(?<!showInPage)(?<!show)\bconfirm\s*\(/);
          const promptMatch = cleanLine.match(/(?<!UIState\.)(?<!window\.UIState\.)(?<!showInPage)(?<!show)\bprompt\s*\(/);

          if (alertMatch) violations.push(`${relPath}:${idx + 1} -> ${line.trim()}`);
          if (confirmMatch) violations.push(`${relPath}:${idx + 1} -> ${line.trim()}`);
          if (promptMatch) violations.push(`${relPath}:${idx + 1} -> ${line.trim()}`);
        });
      });

      assert.strictEqual(
        violations.length,
        0,
        `Found ${violations.length} forbidden native browser dialog call(s):\n${violations.join('\n')}`
      );
    });

    it('verifies public/nav.js installs defensive interception for unexpected native dialog calls', () => {
      const navContent = fs.readFileSync(path.join(publicDir, 'nav.js'), 'utf8');
      assert.ok(navContent.includes('window.alert = function'), 'Missing window.alert interception in nav.js');
      assert.ok(navContent.includes('window.confirm = function'), 'Missing window.confirm interception in nav.js');
      assert.ok(navContent.includes('window.prompt = function'), 'Missing window.prompt interception in nav.js');
    });
  });

  describe('2. Universal In-Page Arabic Dialog & Notification Module (UIState)', () => {
    it('exposes all required dialog and toast methods on UIState module', () => {
      assert.strictEqual(typeof UIState.showInPageAlert, 'function');
      assert.strictEqual(typeof UIState.showInPageConfirm, 'function');
      assert.strictEqual(typeof UIState.showInPagePrompt, 'function');
      assert.strictEqual(typeof UIState.showApiError, 'function');
      assert.strictEqual(typeof UIState.showToast, 'function');
      assert.strictEqual(typeof UIState.alert, 'function');
      assert.strictEqual(typeof UIState.confirm, 'function');
      assert.strictEqual(typeof UIState.prompt, 'function');
      assert.strictEqual(typeof UIState.toast, 'function');
      assert.strictEqual(typeof UIState.apiError, 'function');
    });

    it('generates structured Request IDs for API errors and tracing', () => {
      const reqId = UIState.generateRequestId('ERR');
      assert.ok(reqId.startsWith('ERR-'), 'Request ID must start with prefix');
      assert.ok(reqId.length >= 10, 'Request ID must have high entropy');
    });

    it('formats monetary values in Arabic without misleading zeros or undefined strings', () => {
      UIState.setLanguage('ar');
      assert.strictEqual(UIState.formatMoney(null), '--');
      assert.strictEqual(UIState.formatMoney(undefined), '--');
      assert.strictEqual(UIState.formatMoney(NaN), '--');

      const formatted = UIState.formatMoney(25000); // 250.00 EGP
      assert.ok(formatted.includes('250') || formatted.includes('٢٥٠'));
      assert.ok(formatted.includes('ج.م'));
    });
  });

  describe('3. Staff UX Resilience, Async Guard & Controlled Printing', () => {
    it('guards async actions against duplicate clicks and double submission', async () => {
      let callCount = 0;
      const fakeBtn = {
        disabled: false,
        dataset: {},
        innerHTML: '<span>حفظ</span>'
      };

      const asyncTask = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return 'DONE';
      };

      const p1 = UIState.guardButtonAction(fakeBtn, asyncTask);
      // Attempt immediate duplicate click
      const p2 = UIState.guardButtonAction(fakeBtn, asyncTask);

      const res = await p1;
      await p2;

      assert.strictEqual(res, 'DONE');
      assert.strictEqual(callCount, 1, 'Duplicate click must be blocked by guardButtonAction');
      assert.strictEqual(fakeBtn.disabled, false, 'Button must be re-enabled after execution');
      assert.strictEqual(fakeBtn.dataset.actionExecuting, 'false');
    });

    it('verifies controlled print test endpoint exists and returns structured JSON', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ pin: '8801' }); // Super Admin PIN
      
      const cookies = loginRes.headers['set-cookie'];

      const res = await request(app)
        .post('/api/print/test')
        .set('Cookie', cookies)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message || res.body.printer);
    });

    it('verifies eod.html uses controlled in-page print preview rather than raw window.print()', () => {
      const eodContent = fs.readFileSync(path.join(publicDir, 'eod.html'), 'utf8');
      assert.ok(eodContent.includes('triggerZReportPrint'), 'Missing triggerZReportPrint in eod.html');
      assert.ok(!eodContent.includes('onclick="window.print()"'), 'eod.html must not use raw onclick="window.print()"');
      assert.ok(eodContent.includes('z-report-print-btn'), 'eod.html must have dedicated print trigger');
    });
  });

  describe('4. Accessibility, Screen Reader & RTL Layout Integrity', () => {
    it('verifies UIState modal HTML constructs use aria-modal, role dialog, and dir="rtl"', () => {
      const uiStateSrc = fs.readFileSync(path.join(publicDir, 'modules/ui-state.js'), 'utf8');
      
      assert.ok(uiStateSrc.includes("'role', 'dialog'"), "Missing setAttribute('role', 'dialog') in UIState modals");
      assert.ok(uiStateSrc.includes("'aria-modal', 'true'"), "Missing setAttribute('aria-modal', 'true') in UIState modals");
      assert.ok(uiStateSrc.includes('aria-labelledby'), 'Missing aria-labelledby in UIState modals');
      assert.ok(uiStateSrc.includes('aria-describedby'), 'Missing aria-describedby in UIState modals');
      assert.ok(uiStateSrc.includes('dir="rtl"') || uiStateSrc.includes("dir', 'rtl'"), 'Missing dir="rtl" in UIState dialog container');
      assert.ok(uiStateSrc.includes('trapFocus'), 'Missing keyboard focus trap helper');
    });

    it('verifies all operational pages specify RTL document direction', () => {
      const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
      htmlFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
        assert.ok(
          content.includes('dir="rtl"') || content.includes("dir='rtl'"),
          `${file} must explicitly declare dir="rtl"`
        );
      });
    });
  });
});
