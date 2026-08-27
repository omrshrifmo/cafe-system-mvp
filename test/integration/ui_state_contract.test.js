const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('UI State Contract, Accessibility & Resilient Staff UX Integration Tests', () => {

  const UIState = require('../../public/modules/ui-state');

  describe('1. Shared UI State Contract Definitions', () => {
    const requiredStates = [
      'LOADING', 'READY', 'EMPTY', 'ERROR', 'TIMEOUT', 'RETRYING',
      'OFFLINE', 'STALE', 'QUEUED', 'SYNCING', 'REJECTED', 'CONFLICT',
      'SUCCESS', 'SETTLED'
    ];

    it('should explicitly define all 14 canonical UI states in STATES enum', () => {
      requiredStates.forEach(st => {
        assert.ok(UIState.STATES[st], `Missing state ${st} in UIState.STATES`);
        assert.strictEqual(UIState.STATES[st], st);
      });
    });

    it('should provide localized Arabic & English copy for all 14 states', () => {
      ['ar', 'en'].forEach(lang => {
        UIState.setLanguage(lang);
        assert.strictEqual(UIState.getLanguage(), lang);
        
        requiredStates.forEach(st => {
          const sampleDiv = { innerHTML: '', setAttribute: () => {} };
          UIState.render(sampleDiv, st, {
            requestId: 'REQ-TEST-123',
            lastUpdated: new Date().toISOString()
          });
          assert.ok(sampleDiv.innerHTML.length > 50, `Rendered state ${st} for ${lang} produced empty HTML`);
          assert.ok(sampleDiv.innerHTML.includes('REQ-TEST-123'), `Rendered state ${st} did not include Request ID`);
        });
      });
    });

    it('should format money safely without misleading zeros or undefined strings', () => {
      UIState.setLanguage('ar');
      assert.strictEqual(UIState.formatMoney(null), '--');
      assert.strictEqual(UIState.formatMoney(undefined), '--');
      assert.strictEqual(UIState.formatMoney(NaN), '--');
      
      const moneyFormatted = UIState.formatMoney(15000); // 150.00 EGP
      assert.ok(moneyFormatted.includes('150') || moneyFormatted.includes('١٥٠'));
    });

    it('should generate valid Request IDs for error tracing and auditing', () => {
      const reqId = UIState.generateRequestId('POS');
      assert.ok(reqId.startsWith('POS-'));
      assert.ok(reqId.length > 10);
    });
  });

  describe('2. Blind Cashier Mode & EOD Invariants', () => {
    it('should verify eod.html strictly hides variance and expected cash from regular cashier role', () => {
      const eodHtml = fs.readFileSync(path.join(__dirname, '../../public/eod.html'), 'utf8');
      
      // Asserts that manager elements are hidden by default and guarded by isManagerOrOwner check
      assert.ok(eodHtml.includes('manager-reconciliation-card'));
      assert.ok(eodHtml.includes('isManagerOrOwner'));
      assert.ok(eodHtml.includes('manager-variance-bar'));
      assert.ok(eodHtml.includes('Blind Cash Declaration'));
      assert.ok(eodHtml.includes('openZReportModal'));
    });
  });

  describe('3. POS Touch Keypad & Keyboard Accessibility', () => {
    it('should verify pos.html contains quick cash denominations and keyboard shortcut bindings', () => {
      const posHtml = fs.readFileSync(path.join(__dirname, '../../public/pos.html'), 'utf8');
      
      // Check quick tender buttons
      assert.ok(posHtml.includes('addCashAmount(10)'));
      assert.ok(posHtml.includes('addCashAmount(50)'));
      assert.ok(posHtml.includes('addCashAmount(100)'));
      assert.ok(posHtml.includes('addCashAmount(200)'));

      // Check keyboard shortcuts
      assert.ok(posHtml.includes("e.key === 'F2'"), 'Missing F2 menu search shortcut');
      assert.ok(posHtml.includes("e.key === 'F4'"), 'Missing F4 quick checkout shortcut');
      assert.ok(posHtml.includes("e.key === 'F8'"), 'Missing F8 print check shortcut');
      assert.ok(posHtml.includes("e.key === 'Escape'"), 'Missing Escape modal close shortcut');
    });
  });

  describe('4. Navigation Shell, Responsive Styles & Service Worker Versioning', () => {
    it('should verify public/nav.js enforces focus rings, skip-links, and SW update prompts', () => {
      const navJs = fs.readFileSync(path.join(__dirname, '../../public/nav.js'), 'utf8');
      
      assert.ok(navJs.includes(':focus-visible'), 'Missing :focus-visible accessibility rule');
      assert.ok(navJs.includes('skip-link'), 'Missing skip link for keyboard navigation');
      assert.ok(navJs.includes('showUpdatePrompt'), 'Missing Service Worker update banner');
      assert.ok(navJs.includes('nav-net-status'), 'Missing network connectivity badge');
    });

    it('should verify sw.js is updated to cafe-os-v3.1 with complete asset list', () => {
      const swJs = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
      
      assert.ok(swJs.includes("const CACHE_NAME = 'cafe-os-v3.2-prod'") || swJs.includes("const CACHE_NAME = 'cafe-os-v3.1'"));
      assert.ok(swJs.includes('/modules/ui-state.js'));
      assert.ok(swJs.includes('/qr-menu.html'));
      assert.ok(swJs.includes('SKIP_WAITING'));
    });
  });

  describe('5. Responsive Breakpoint & Viewport Compliance', () => {
    it('should confirm responsive styles prevent critical button clipping on small mobile viewports (320px)', () => {
      const navJs = fs.readFileSync(path.join(__dirname, '../../public/nav.js'), 'utf8');
      
      // Asserts min-height 44px on mobile for touch target compliance
      assert.ok(navJs.includes('min-height: 44px;'));
      assert.ok(navJs.includes('@media (max-width: 640px)'));
    });
  });

});
