/**
 * Human-Staff Experience, UI State Matrix & Accessibility Test Suite
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const UIState = require('../../public/modules/ui-state');

describe('Human-Staff Experience & Accessibility Test Suite', () => {

  describe('1. Standardized 14 Canonical UI States Matrix', () => {
    const expectedStates = [
      'LOADING', 'READY', 'EMPTY', 'ERROR', 'TIMEOUT',
      'RETRYING', 'OFFLINE', 'STALE', 'QUEUED', 'SYNCING',
      'REJECTED', 'CONFLICT', 'SUCCESS', 'SETTLED'
    ];

    it('should declare all 14 canonical UI states without missing definitions', () => {
      for (const state of expectedStates) {
        assert.ok(UIState.STATES[state], `Missing state definition: ${state}`);
      }
    });

    it('should provide localized Arabic & English dictionaries for all 14 states', () => {
      const arDict = UIState.I18N.ar;
      const enDict = UIState.I18N.en;

      for (const state of expectedStates) {
        assert.ok(arDict[state], `Missing Arabic dictionary for state: ${state}`);
        assert.ok(arDict[state].title, `Missing Arabic title for state: ${state}`);
        assert.ok(arDict[state].desc, `Missing Arabic desc for state: ${state}`);

        assert.ok(enDict[state], `Missing English dictionary for state: ${state}`);
        assert.ok(enDict[state].title, `Missing English title for state: ${state}`);
        assert.ok(enDict[state].desc, `Missing English desc for state: ${state}`);
      }
    });

    it('should format money with minor units and avoid misleading zeroes or undefined', () => {
      assert.strictEqual(UIState.formatMoney(null), '--');
      assert.strictEqual(UIState.formatMoney(undefined), '--');
      assert.strictEqual(UIState.formatMoney(NaN), '--');

      UIState.setLanguage('ar');
      const arFormatted = UIState.formatMoney(5000);
      assert.match(arFormatted, /50\.00|٥٠[.,٫]٠٠/);

      UIState.setLanguage('en');
      const enFormatted = UIState.formatMoney(7550);
      assert.strictEqual(enFormatted, '75.50 EGP');
    });

    it('should format date and time safely without throwing on invalid input', () => {
      assert.strictEqual(UIState.formatDateTime(null), '--');
      assert.strictEqual(UIState.formatDateTime('invalid-date'), '--');
      const formatted = UIState.formatDateTime(new Date().toISOString());
      assert.ok(formatted !== '--');
    });
  });

  describe('2. Modal Accessibility, Focus Management & Duplicate Prevention', () => {
    it('should export modal manager methods (openModal, closeModal, guardButtonAction)', () => {
      assert.strictEqual(typeof UIState.openModal, 'function');
      assert.strictEqual(typeof UIState.closeModal, 'function');
      assert.strictEqual(typeof UIState.guardButtonAction, 'function');
    });

    it('should prevent duplicate clicks via guardButtonAction', async () => {
      let executionCount = 0;
      const fakeButton = { dataset: {}, disabled: false };

      const asyncTask = async () => {
        executionCount++;
        await new Promise(r => setTimeout(r, 50));
      };

      // Trigger two rapid clicks concurrently
      const call1 = UIState.guardButtonAction(fakeButton, asyncTask);
      const call2 = UIState.guardButtonAction(fakeButton, asyncTask);

      await Promise.all([call1, call2]);

      assert.strictEqual(executionCount, 1, 'Duplicate click was not prevented');
      assert.strictEqual(fakeButton.disabled, false);
      assert.strictEqual(fakeButton.dataset.actionExecuting, 'false');
    });
  });

  describe('3. Operational Header, Metadata & Responsive Viewport Rules', () => {
    it('should verify global styles include focus-visible, touch targets, and Tajawal font', () => {
      const navJsPath = path.join(__dirname, '../../public/nav.js');
      const navContent = fs.readFileSync(navJsPath, 'utf8');

      // Focus visibility
      assert.match(navContent, /:focus-visible/);
      assert.match(navContent, /outline: 2px solid/);

      // Touch target size guarantee (>= 44px on mobile)
      assert.match(navContent, /min-height: 44px/);

      // Tajawal typography
      assert.match(navContent, /Tajawal/);

      // Skip link for keyboard accessibility
      assert.match(navContent, /\.skip-link/);
    });

    it('should verify header displays role badge, shift indicator, network status, and clock', () => {
      const navJsPath = path.join(__dirname, '../../public/nav.js');
      const navContent = fs.readFileSync(navJsPath, 'utf8');

      assert.match(navContent, /nav-net-status/);
      assert.match(navContent, /global-shift-badge/);
      assert.match(navContent, /nav-live-clock/);
      assert.match(navContent, /userRole/);
    });
  });

});
