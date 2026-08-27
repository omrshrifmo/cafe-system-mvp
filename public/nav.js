/**
 * كافيه مزاج - Universal Enterprise Unified Navigation, Design System & Shell
 * Unified Header, Collapsible Multi-Group Sidebar, Compact Footer, UIState Contract & PWA Manager
 * Standardized on 'Tajawal' Typography & Slate-900/950 Theme
 * Enforces Server-Authenticated Session Validation and Strict Client-Side Page Guarding
 */

(function () {
  // Navigation Route Configuration Grouped by Domain
  const ALL_PRIVILEGED = ['SUPER_ADMIN', 'OWNER', 'OP_MANAGER'];
  const navGroups = [
    {
      groupTitle: 'الصالة ونقطة البيع',
      items: [
        { title: 'نقطة البيع (POS)', path: '/pos.html', icon: '💳', roles: [...ALL_PRIVILEGED, 'HALL_MANAGER', 'WAITER', 'CASHIER'] },
        { title: 'إدارة وتوزيع الطاولات', path: '/tables.html', icon: '🪑', roles: [...ALL_PRIVILEGED, 'HALL_MANAGER', 'WAITER', 'CASHIER'] },
        { title: 'إدارة الحجوزات', path: '/reservations.html', icon: '📅', roles: [...ALL_PRIVILEGED, 'HALL_MANAGER'] },
        { title: 'شاشة الويتر والرانر', path: '/runner.html', icon: '🏃', roles: [...ALL_PRIVILEGED, 'HALL_MANAGER', 'WAITER', 'RUNNER'] }
      ]
    },
    {
      groupTitle: 'شاشات التحضير KDS',
      items: [
        { title: 'شاشة البارستا', path: '/kds.html', icon: '☕', roles: [...ALL_PRIVILEGED, 'BARISTA'] },
        { title: 'شاشة المطبخ', path: '/kitchen.html', icon: '🍳', roles: [...ALL_PRIVILEGED, 'CHEF'] },
        { title: 'شاشة الشيشة', path: '/shisha.html', icon: '💨', roles: [...ALL_PRIVILEGED, 'SHISHA'] }
      ]
    },
    {
      groupTitle: 'المخزون والمشتريات',
      items: [
        { title: 'مدير قائمة الطعام', path: '/menu-manager.html', icon: '🍽️', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER'] },
        { title: 'المخزون ومطابقة BOM', path: '/inventory.html', icon: '📦', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER'] },
        { title: 'دليل الموردين', path: '/suppliers.html', icon: '🚚', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER'] },
        { title: 'فواتير المشتريات', path: '/purchasing.html', icon: '🛒', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER'] }
      ]
    },
    {
      groupTitle: 'العملاء والموارد البشرية',
      items: [
        { title: 'العملاء والولاء (CRM)', path: '/crm.html', icon: '👥', roles: [...ALL_PRIVILEGED, 'HALL_MANAGER', 'CASHIER'] },
        { title: 'الموارد البشرية والرواتب', path: '/hr.html', icon: '💼', roles: [...ALL_PRIVILEGED, 'HR_PAYROLL'] },
        { title: 'معايير الجودة والـ QA', path: '/qa.html', icon: '🛡️', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER', 'QA'] }
      ]
    },
    {
      groupTitle: 'التقارير والإدارة المالية',
      items: [
        { title: 'إعدادات النظام والضرائب', path: '/settings.html', icon: '⚙️', roles: ['SUPER_ADMIN', 'OWNER'] },
        { title: 'تقفيل الوردية (EOD)', path: '/eod.html', icon: '📊', roles: [...ALL_PRIVILEGED, 'CASHIER'] },
        { title: 'مؤشرات الأداء (BI)', path: '/bi.html', icon: '📈', roles: [...ALL_PRIVILEGED, 'READ_ONLY'] },
        { title: 'حسابات الشركاء', path: '/shareholders.html', icon: '💎', roles: ['SUPER_ADMIN', 'OWNER'] },
        { title: 'البوابة الرئيسية', path: '/portal.html', icon: '🏠', roles: [...ALL_PRIVILEGED, 'BOM_MANAGER', 'HALL_MANAGER', 'WAITER', 'RUNNER', 'BARISTA', 'SHISHA', 'CHEF', 'CASHIER', 'HR_PAYROLL', 'QA', 'READ_ONLY'] }
      ]
    }
  ];

  // Dynamically load UIState script if missing
  if (typeof window !== 'undefined') {
    if (!window.UIState) {
      const script = document.createElement('script');
      script.src = '/modules/ui-state.js';
      document.head.appendChild(script);
    }

    // Intercept native dialogs to guarantee zero browser-native popups
    window.alert = function (msg) {
      if (window.UIState && window.UIState.alert) {
        window.UIState.alert(String(msg || ''));
      } else {
        console.warn('Native alert suppressed:', msg);
      }
    };
    window.confirm = function (msg) {
      if (window.UIState && window.UIState.confirm) {
        window.UIState.confirm(String(msg || ''));
      } else {
        console.warn('Native confirm suppressed:', msg);
      }
      return false;
    };
    window.prompt = function (msg, def) {
      if (window.UIState && window.UIState.prompt) {
        window.UIState.prompt(String(msg || ''), def);
      } else {
        console.warn('Native prompt suppressed:', msg);
      }
      return null;
    };
  }

  // Auto-Register PWA Service Worker with Update Prompt
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdatePrompt(newWorker);
            }
          });
        });
      }).catch(err => console.log('SW registration note:', err));
    });
  }

  function showUpdatePrompt(worker) {
    const banner = document.createElement('div');
    banner.id = 'mazaj-sw-update-banner';
    banner.className = 'fixed bottom-4 left-4 z-[999999] bg-amber-500 text-slate-950 px-4 py-3 rounded-2xl font-bold text-xs shadow-2xl flex items-center gap-3 border border-amber-400 animate-bounce';
    banner.innerHTML = `
      <span>⚡ يتوفر تحديث جديد للنظام (v3.1)</span>
      <button id="mazaj-sw-reload-btn" class="px-3 py-1 bg-slate-950 text-white rounded-xl text-xs font-black hover:bg-slate-900 cursor-pointer shadow">
        تحديث الآن 🔄
      </button>
    `;
    document.body.appendChild(banner);
    document.getElementById('mazaj-sw-reload-btn').onclick = () => {
      worker.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    };
  }

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/manifest.json';
    document.head.appendChild(manifestLink);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    metaTheme.content = '#0f172a';
    document.head.appendChild(metaTheme);
  }

  function injectGlobalStyles() {
    if (document.getElementById('mazaj-global-styles')) return;

    if (!document.getElementById('tajawal-font-link')) {
      const fontLink = document.createElement('link');
      fontLink.id = 'tajawal-font-link';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap';
      document.head.appendChild(fontLink);
    }

    const style = document.createElement('style');
    style.id = 'mazaj-global-styles';
    style.innerHTML = `
      * {
        font-family: 'Tajawal', sans-serif;
      }
      body {
        background-color: #0f172a !important;
        color: #f8fafc !important;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      /* Accessibility Focus Ring */
      :focus-visible {
        outline: 2px solid #f59e0b !important;
        outline-offset: 2px !important;
      }
      /* Skip Link for Keyboard Navigation */
      .skip-link {
        position: absolute;
        top: -40px;
        left: 0;
        background: #f59e0b;
        color: #0f172a;
        padding: 8px 16px;
        font-weight: 800;
        z-index: 100000;
        transition: top 0.2s;
        border-radius: 0 0 8px 0;
      }
      .skip-link:focus {
        top: 0;
      }
      .stat-card {
        background: linear-gradient(135deg, #1e293b, #0f172a);
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 20px;
        transition: all 0.2s ease;
      }
      .stat-card:hover {
        border-color: #f59e0b88;
        transform: translateY(-1px);
      }
      .modal-bg {
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
      }
      .scrollbar-thin::-webkit-scrollbar {
        width: 5px;
        height: 5px;
      }
      .scrollbar-thin::-webkit-scrollbar-track {
        background: #0f172a;
      }
      .scrollbar-thin::-webkit-scrollbar-thumb {
        background: #334155;
        border-radius: 4px;
      }
      .scrollbar-thin::-webkit-scrollbar-thumb:hover {
        background: #475569;
      }
      .sidebar-item {
        transition: all 0.15s ease;
      }
      .sidebar-item:hover {
        background-color: #1e293b;
        color: #ffffff;
      }
      .sidebar-item.active {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #0f172a !important;
        font-weight: 800 !important;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);
      }
      /* Touch target guarantee */
      button, a, input, select, textarea {
        min-height: 38px;
      }
      @media (max-width: 640px) {
        button, a, input, select, textarea {
          min-height: 44px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || localStorage.getItem('user') || '{}');
    } catch (e) {
      return {};
    }
  }

  function getActiveShiftType() {
    return localStorage.getItem('active_shift_type') || (new Date().getHours() < 16 ? 'MORNING' : 'NIGHT');
  }

  function toggleShiftType() {
    const current = getActiveShiftType();
    const next = current === 'MORNING' ? 'NIGHT' : 'MORNING';
    localStorage.setItem('active_shift_type', next);
    window.location.reload();
  }

  function isCollapsed() {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  }

  function toggleSidebar() {
    const currentState = isCollapsed();
    localStorage.setItem('sidebar_collapsed', !currentState ? 'true' : 'false');
    applySidebarState();
  }

  function applySidebarState() {
    const sidebar = document.getElementById('app-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const labelEls = document.querySelectorAll('.nav-label');
    const groupTitles = document.querySelectorAll('.nav-group-title');
    if (!sidebar) return;

    if (isCollapsed()) {
      sidebar.style.width = '64px';
      labelEls.forEach(el => el.classList.add('hidden'));
      groupTitles.forEach(el => el.classList.add('hidden'));
      if (toggleBtn) toggleBtn.innerHTML = '▶';
    } else {
      sidebar.style.width = '230px';
      labelEls.forEach(el => el.classList.remove('hidden'));
      groupTitles.forEach(el => el.classList.remove('hidden'));
      if (toggleBtn) toggleBtn.innerHTML = '◀';
    }
  }

  function toggleMobileMenu() {
    const drawer = document.getElementById('mobile-drawer-overlay');
    if (drawer) {
      drawer.classList.toggle('hidden');
    }
  }

  async function logout() {
    try {
      localStorage.setItem('mazaj_session_revoked_at', Date.now().toString());
    } catch (e) {}

    if (window.AuthModule && typeof window.AuthModule.logout === 'function') {
      await window.AuthModule.logout();
      return;
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userTools');
    localStorage.removeItem('session_token');
    localStorage.removeItem('mazaj_session_reference');
    sessionStorage.clear();
    document.body.innerHTML = `
      <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-200" style="font-family: 'Tajawal', sans-serif;">
        <div class="text-3xl mb-3">👋</div>
        <h1 class="text-lg font-bold mb-2">تم تسجيل الخروج بنجاح</h1>
        <p class="text-xs text-slate-400">جاري التوجيه لصفحة الدخول...</p>
      </div>
    `;
    window.location.replace('/index.html');
  }

  function toggleCaffeineModal() {
    let modal = document.getElementById('caffeine-mode-modal');
    if (modal) {
      modal.remove();
      return;
    }

    modal = document.createElement('div');
    modal.id = 'caffeine-mode-modal';
    modal.dir = 'rtl';
    modal.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 text-slate-100 select-none';
    modal.style.fontFamily = "'Tajawal', system-ui, sans-serif";

    modal.innerHTML = `
      <div class="w-full max-w-sm bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div class="flex items-center gap-2">
            <span class="text-xl">☕</span>
            <h3 class="text-sm font-black text-amber-300">وضع الكافيين (منع القفل المؤقت)</h3>
          </div>
          <button onclick="document.getElementById('caffeine-mode-modal').remove()" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs">✕</button>
        </div>

        <p class="text-xs text-slate-300 mb-4 leading-relaxed">
          يحافظ هذا الوضع على بقاء الشاشة مفتوحة أثناء ساعات الذروة التشغيلية بدون إغلاق تلقائي. يتطلب موافقة المدير أو المشرف.
        </p>

        <div class="space-y-3 mb-4">
          <div>
            <label class="block text-[11px] font-bold text-slate-400 mb-1">المدة المطلوبة (بالدقائق - أقصى حد 60 دقيقة):</label>
            <select id="caffeine-duration-input" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
              <option value="15">15 دقيقة</option>
              <option value="30" selected>30 دقيقة</option>
              <option value="45">45 دقيقة</option>
              <option value="60">60 دقيقة</option>
            </select>
          </div>

          <div>
            <label class="block text-[11px] font-bold text-slate-400 mb-1">رمز PIN المشرف / المدير للتأكيد:</label>
            <input type="password" id="caffeine-manager-pin" placeholder="••••" maxlength="6" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-center text-lg tracking-widest text-amber-400">
          </div>

          <div id="caffeine-modal-err" class="hidden p-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs text-center font-bold"></div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="window.MazajNav.submitEnableCaffeine()" class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition-all shadow cursor-pointer">
            تفعيل الوضع ☕
          </button>
          <button onclick="window.MazajNav.submitDisableCaffeine()" class="py-2.5 px-3 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-bold rounded-xl transition-colors cursor-pointer">
            إيقاف
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  async function submitEnableCaffeine() {
    const dur = parseInt(document.getElementById('caffeine-duration-input').value, 10) || 30;
    const pin = document.getElementById('caffeine-manager-pin').value;
    const errEl = document.getElementById('caffeine-modal-err');
    
    try {
      if (window.AuthModule) {
        const res = await window.AuthModule.enableCaffeineMode(dur, 'PEAK_HOURS_KEEP_ALIVE', pin || null);
        if (!res.success) {
          throw new Error(res.error || 'فشل التفعيل');
        }
      }
      const modal = document.getElementById('caffeine-mode-modal');
      if (modal) modal.remove();
      const btn = document.getElementById('caffeine-mode-btn');
      if (btn) {
        btn.classList.add('bg-amber-500/30', 'border-amber-400', 'animate-pulse');
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'فشل تفعيل وضع الكافيين';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function submitDisableCaffeine() {
    try {
      if (window.AuthModule) {
        await window.AuthModule.disableCaffeineMode();
      }
      const modal = document.getElementById('caffeine-mode-modal');
      if (modal) modal.remove();
      const btn = document.getElementById('caffeine-mode-btn');
      if (btn) {
        btn.classList.remove('bg-amber-500/30', 'border-amber-400', 'animate-pulse');
      }
    } catch (e) {}
  }

  function updateClock() {
    const el = document.getElementById('nav-live-clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

  function updateNetworkStatusBadge() {
    const badge = document.getElementById('nav-net-status');
    if (!badge) return;
    if (navigator.onLine) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-emerald-400">متصل بالخادم</span>
      `;
      badge.className = "px-2 py-0.5 rounded-lg text-[10px] font-bold border border-emerald-500/30 bg-emerald-950/40 flex items-center gap-1.5";
    } else {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
        <span class="text-rose-400">وضع غير متصل (Offline)</span>
      `;
      badge.className = "px-2 py-0.5 rounded-lg text-[10px] font-bold border border-rose-500/40 bg-rose-950/60 flex items-center gap-1.5";
    }
  }

  window.addEventListener('online', updateNetworkStatusBadge);
  window.addEventListener('offline', updateNetworkStatusBadge);

  async function validateSessionAndRender() {
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname.endsWith('/index.html') || pathname.includes('qr-menu.html')) {
      return;
    }

    injectGlobalStyles();

    // 1. Verify authenticated server session
    let authenticatedUser = null;
    let appMode = 'LIVE';
    try {
      const res = await fetch('/api/auth/me');
      appMode = res.headers.get('X-App-Mode') || 'LIVE';
      
      if (res.status === 403) {
        const data = await res.json();
        if (data.code === 'NEEDS_ONBOARDING') {
          window.location.replace('/setup.html');
          return;
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          authenticatedUser = data.user;
          localStorage.setItem('currentUser', JSON.stringify(data.user));
        }
      }
    } catch (e) {}

    // If server says unauthorized / logged out, clear stale state and redirect to login immediately
    if (!authenticatedUser) {
      localStorage.removeItem('user');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('userTools');
      sessionStorage.clear();
      document.body.innerHTML = `
        <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-200" style="font-family: 'Tajawal', sans-serif;">
          <div class="w-16 h-16 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-2xl flex items-center justify-center text-3xl mb-4">
            🔒
          </div>
          <h1 class="text-xl font-bold mb-2">يلزم تسجيل الدخول</h1>
          <p class="text-sm text-slate-400 mb-4">انتهت صلاحية الجلسة أو تم تسجيل الخروج. جاري التوجيه...</p>
        </div>
      `;
      setTimeout(() => { window.location.href = '/index.html'; }, 300);
      return;
    }

    const currentUser = authenticatedUser;
    const userRole = currentUser.role || 'WAITER';
    const currentShift = getActiveShiftType();

    // Determine current active page and check role permissions
    let currentPageTitle = 'لوحة التحكم';
    let matchedItem = null;
    for (const grp of navGroups) {
      for (const item of grp.items) {
        if (pathname.endsWith(item.path)) {
          matchedItem = item;
          currentPageTitle = item.title;
          break;
        }
      }
      if (matchedItem) break;
    }

    // Direct access control guard: If current page requires roles that user lacks, show access denied
    if (matchedItem && !matchedItem.roles.includes(userRole)) {
      document.body.innerHTML = `
        <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-200" style="font-family: 'Tajawal', sans-serif;">
          <div class="w-16 h-16 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-lg">
            ⛔
          </div>
          <h1 class="text-xl font-black text-rose-300 mb-2">غير مصرح بالوصول إلى هذه الصفحة</h1>
          <p class="text-sm text-slate-400 max-w-md mb-6">
            دورك الوظيفي الحالي (${userRole}) لا يمتلك الصلاحية الكافية لفتح صفحة [${matchedItem.title}].
          </p>
          <a href="/portal.html" class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition-colors shadow-lg">
            العودة للبوابة الرئيسية 🏠
          </a>
        </div>
      `;
      setTimeout(() => { window.location.href = '/portal.html'; }, 2000);
      return;
    }

    // Top Unified Header Bar HTML (Height: 46px)
    const demoBannerHtml = appMode === 'DEMO' ? `<div id="demo-mode-banner" class="demo-banner w-full bg-rose-600 text-white text-xs font-black text-center py-1.5 tracking-widest z-[100] relative border-b border-rose-500 shadow-md">⚠️ وضع التجربة المعزول (DEMO MODE) - جميع العمليات والبيانات هنا تجريبية ومعزولة تماماً عن النظام الفعلي</div>` : '';
    const topBarHTML = `
      <a href="#app-content-area" class="skip-link">انتقل للمحتوى الرئيسي (Tab)</a>
      ${demoBannerHtml}
      <header role="banner" class="h-[46px] bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 md:px-4 flex items-center justify-between text-xs text-slate-300 shrink-0 z-50 select-none shadow-md">
        <div class="flex items-center gap-2 md:gap-3">
          <button onclick="window.MazajNav.toggleSidebar()" id="sidebar-toggle-btn" aria-label="طي أو توسيع القائمة الجانبية" class="hidden md:flex w-7 h-7 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-black items-center justify-center border border-slate-700 cursor-pointer transition-colors shadow-sm">
            ${isCollapsed() ? '▶' : '◀'}
          </button>
          
          <button onclick="window.MazajNav.toggleMobileMenu()" aria-label="فتح القائمة الرئيسية" class="md:hidden w-8 h-8 bg-amber-500 text-slate-950 rounded-lg font-black text-sm flex items-center justify-center cursor-pointer shadow">
            ☰
          </button>

          <a href="/portal.html" class="flex items-center gap-2 text-white hover:text-amber-400 transition-colors">
            <span class="text-lg">☕</span>
            <span class="font-black text-sm tracking-wide text-amber-400 hidden xs:inline">كافيه مزاج</span>
          </a>

          <span class="text-slate-700 hidden sm:inline">|</span>

          <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/80 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-200">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>${currentPageTitle}</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 md:gap-2.5">
          <div id="nav-net-status" class="px-2 py-0.5 rounded-lg text-[10px] font-bold border border-emerald-500/30 bg-emerald-950/40 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span class="text-emerald-400 hidden xs:inline">متصل</span>
          </div>

          <button onclick="window.MazajNav.toggleShiftType()" id="global-shift-badge" title="اضغط للتبديل بين الورديات" class="px-2 md:px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer border flex items-center gap-1.5 transition-all shadow-sm ${
            currentShift === 'MORNING' 
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25' 
              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/25'
          }">
            <span>${currentShift === 'MORNING' ? '☀️' : '🌙'}</span>
            <span class="hidden sm:inline">${currentShift === 'MORNING' ? 'وردية صباحية' : 'وردية مسائية'}</span>
          </button>

          <button onclick="window.MazajNav.toggleCaffeineModal()" id="caffeine-mode-btn" title="وضع الكافيين (منع القفل المؤقت)" class="px-2 md:px-2.5 py-1 bg-amber-950/30 hover:bg-amber-900/50 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1">
            <span>☕</span>
            <span class="hidden sm:inline">كافيين</span>
          </button>

          <div class="hidden xl:flex px-2 py-1 bg-slate-950/80 rounded-lg text-[10px] font-mono text-slate-400 border border-slate-800 items-center gap-1">
            <span>💺</span>
            <span>مقعد: ${(typeof localStorage !== 'undefined' && localStorage.getItem('cafe_seat_id')) || 'POS-01'}</span>
          </div>

          <div class="px-2 md:px-2.5 py-1 bg-slate-950 rounded-lg text-[11px] font-bold text-slate-300 border border-slate-800 flex items-center gap-1.5">
            <span>👤</span>
            <span class="text-white max-w-[80px] sm:max-w-[100px] truncate">${currentUser.name || 'مستخدم'}</span>
            <span class="text-amber-400 text-[10px] font-mono font-black">(${userRole})</span>
          </div>

          <button onclick="window.AuthModule ? window.AuthModule.lockScreen() : null" title="قفل الشاشة مؤقتاً" class="px-2 md:px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1">
            <span>🔒</span>
            <span class="hidden xs:inline">قفل</span>
          </button>

          <button onclick="window.MazajNav.logout()" title="تسجيل الخروج" class="px-2 md:px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1">
            <span>🚪</span>
            <span class="hidden xs:inline">خروج</span>
          </button>
        </div>
      </header>
    `;

    // Sidebar Container HTML
    const sidebarWidth = isCollapsed() ? '64px' : '230px';
    const sidebarHTML = `
      <aside id="app-sidebar" role="navigation" aria-label="القائمة الجانبية" style="width: ${sidebarWidth};" class="hidden md:flex flex-col bg-slate-900/90 backdrop-blur-md border-l border-slate-800 shrink-0 h-full select-none transition-all duration-200">
        <nav class="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3">
          ${navGroups.map(grp => {
            const accessibleItems = grp.items.filter(item => item.roles.includes(userRole));
            if (accessibleItems.length === 0) return '';

            return `
              <div>
                <div class="nav-group-title text-[10px] font-bold text-slate-500 uppercase px-2 mb-1 truncate ${isCollapsed() ? 'hidden' : ''}">
                  ${grp.groupTitle}
                </div>
                <div class="space-y-0.5">
                  ${accessibleItems.map(item => {
                    const isActive = pathname.endsWith(item.path);
                    return `
                      <a href="${item.path}" title="${item.title}" class="sidebar-item flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-bold ${
                        isActive ? 'active' : 'text-slate-300'
                      }">
                        <span class="text-base shrink-0">${item.icon}</span>
                        <span class="nav-label truncate text-[11px] ${isCollapsed() ? 'hidden' : ''}">${item.title}</span>
                      </a>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </nav>

        <div class="p-2 border-t border-slate-800/80 bg-slate-950/40 text-[10px] text-slate-500 flex items-center justify-between">
          <span class="nav-label truncate ${isCollapsed() ? 'hidden' : ''}">🟢 الخادم متصل</span>
          <span class="text-slate-600 font-mono text-[9px]">v3.1</span>
        </div>
      </aside>

      <div id="mobile-drawer-overlay" class="md:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[99] hidden flex justify-start">
        <div class="w-72 bg-slate-900 h-full border-l border-slate-800 flex flex-col p-4 shadow-2xl overflow-y-auto scrollbar-thin">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div class="flex items-center gap-2 text-white">
              <span class="text-xl">☕</span>
              <span class="font-black text-sm text-amber-400">كافيه مزاج</span>
            </div>
            <button onclick="window.MazajNav.toggleMobileMenu()" class="w-7 h-7 bg-slate-800 text-slate-400 rounded-lg flex items-center justify-center font-bold">✕</button>
          </div>
          <div class="space-y-3 flex-1">
            ${navGroups.map(grp => {
              const accessibleItems = grp.items.filter(item => item.roles.includes(userRole));
              if (accessibleItems.length === 0) return '';
              return `
                <div>
                  <div class="text-[10px] font-bold text-slate-500 uppercase px-2 mb-1">${grp.groupTitle}</div>
                  <div class="space-y-1">
                    ${accessibleItems.map(item => `
                      <a href="${item.path}" class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800">
                        <span>${item.icon}</span>
                        <span>${item.title}</span>
                      </a>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <button onclick="window.MazajNav.logout()" class="w-full mt-4 py-2.5 bg-rose-950/50 text-rose-300 rounded-xl font-bold text-xs border border-rose-500/30">🚪 خروج</button>
        </div>
      </div>
    `;

    // Footer HTML (Height: 28px)
    const footerHTML = `
      <footer role="contentinfo" class="h-[28px] bg-slate-950/95 border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-500 shrink-0 z-50 select-none">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1 text-emerald-400 font-bold">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>نظام التشغيل نشط</span>
          </span>
          <span class="text-slate-700">|</span>
          <span class="text-slate-400 truncate">كافيه مزاج - نظام إدارة العمليات والضيافة</span>
        </div>
        <div class="flex items-center gap-3 font-mono text-[10px]">
          <span>شبكة محلية (LAN)</span>
          <span class="text-slate-700 hidden sm:inline">|</span>
          <span class="text-amber-500/80 font-bold hidden sm:inline">طابعة: 192.168.1.100</span>
        </div>
      </footer>
    `;

    // Wrap page structure cleanly
    if (document.getElementById('mazaj-app-root')) return;

    const rootContainer = document.createElement('div');
    rootContainer.id = 'mazaj-app-root';
    rootContainer.className = 'flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100';

    const headerWrapper = document.createElement('div');
    headerWrapper.innerHTML = topBarHTML;
    while (headerWrapper.firstChild) {
      rootContainer.appendChild(headerWrapper.firstChild);
    }

    const mainBody = document.createElement('div');
    mainBody.className = 'flex flex-1 min-h-0 w-full overflow-hidden';

    const tempSidebar = document.createElement('div');
    tempSidebar.innerHTML = sidebarHTML;
    while (tempSidebar.firstChild) {
      mainBody.appendChild(tempSidebar.firstChild);
    }

    const contentArea = document.createElement('div');
    contentArea.id = 'app-content-area';
    contentArea.tabIndex = -1;
    contentArea.className = 'flex-1 min-w-0 h-full flex flex-col overflow-y-auto scrollbar-thin outline-none';

    while (document.body.firstChild) {
      contentArea.appendChild(document.body.firstChild);
    }

    mainBody.appendChild(contentArea);
    rootContainer.appendChild(mainBody);

    const footerWrapper = document.createElement('div');
    footerWrapper.innerHTML = footerHTML;
    while (footerWrapper.firstChild) {
      rootContainer.appendChild(footerWrapper.firstChild);
    }

    document.body.appendChild(rootContainer);

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    });

    setInterval(updateClock, 1000);
    updateClock();
    updateNetworkStatusBadge();
  }

  // Export functions globally
  window.MazajNav = {
    toggleSidebar,
    toggleMobileMenu,
    toggleShiftType,
    toggleCaffeineModal,
    submitEnableCaffeine,
    submitDisableCaffeine,
    logout,
    initNav: validateSessionAndRender
  };

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      validateSessionAndRender();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', validateSessionAndRender);
  } else {
    validateSessionAndRender();
  }
})();
