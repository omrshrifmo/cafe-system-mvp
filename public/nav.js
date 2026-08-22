/**
 * كافيه مزاج - Universal Enterprise Unified Navigation, Design System & Shell
 * Unified Header, Collapsible Multi-Group Sidebar, and Compact Footer
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

  // Auto-Register PWA Service Worker & Manifest
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration note:', err));
    });
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
      .cat-tag {
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .cat-tag.selected {
        background: rgba(245, 158, 11, 0.2) !important;
        border-color: #f59e0b !important;
        color: #fbbf24 !important;
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
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userTools');
    localStorage.removeItem('session_token');
    sessionStorage.clear();
    document.body.innerHTML = `
      <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-200" style="font-family: 'Tajawal', sans-serif;">
        <div class="text-3xl mb-3">👋</div>
        <h1 class="text-lg font-bold mb-2">تم تسجيل الخروج بنجاح</h1>
        <p class="text-xs text-slate-400">جاري التوجيه لصفحة الدخول...</p>
      </div>
    `;
    window.location.href = '/index.html';
  }

  function updateClock() {
    const el = document.getElementById('nav-live-clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

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
    const demoBannerHtml = appMode === 'DEMO' ? `<div class="w-full bg-rose-600 text-white text-[10px] font-black text-center py-0.5 tracking-widest z-[100] relative">وضع التجربة (DEMO MODE) - جميع الإجراءات هنا معزولة عن بيانات النظام الفعلي</div>` : '';
    const topBarHTML = `
      ${demoBannerHtml}
      <header class="h-[46px] bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-300 shrink-0 z-50 select-none shadow-md">
        <div class="flex items-center gap-3">
          <button onclick="window.MazajNav.toggleSidebar()" id="sidebar-toggle-btn" title="طي/توسيع القائمة الجانبية (Ctrl+B)" class="hidden md:flex w-7 h-7 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-black items-center justify-center border border-slate-700 cursor-pointer transition-colors shadow-sm">
            ${isCollapsed() ? '▶' : '◀'}
          </button>
          
          <button onclick="window.MazajNav.toggleMobileMenu()" class="md:hidden w-8 h-8 bg-amber-500 text-slate-950 rounded-lg font-black text-sm flex items-center justify-center cursor-pointer shadow">
            ☰
          </button>

          <a href="/portal.html" class="flex items-center gap-2 text-white hover:text-amber-400 transition-colors">
            <span class="text-lg">☕</span>
            <span class="font-black text-sm tracking-wide text-amber-400">كافيه مزاج</span>
          </a>

          <span class="text-slate-700 hidden sm:inline">|</span>

          <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/80 rounded-lg border border-slate-800 text-[11px] font-bold text-slate-200">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>${currentPageTitle}</span>
          </div>
        </div>

        <div class="flex items-center gap-2.5">
          <button onclick="window.MazajNav.toggleShiftType()" id="global-shift-badge" title="اضغط للتبديل بين الورديات" class="px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer border flex items-center gap-1.5 transition-all shadow-sm ${
            currentShift === 'MORNING' 
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25' 
              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/25'
          }">
            <span>${currentShift === 'MORNING' ? '☀️' : '🌙'}</span>
            <span>${currentShift === 'MORNING' ? 'وردية صباحية' : 'وردية مسائية'}</span>
          </button>

          <div id="nav-live-clock" class="hidden lg:block text-slate-400 font-mono text-[11px] bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            00:00:00 م
          </div>

          <div class="px-2.5 py-1 bg-slate-950 rounded-lg text-[11px] font-bold text-slate-300 border border-slate-800 flex items-center gap-1.5">
            <span>👤</span>
            <span class="text-white max-w-[100px] truncate">${currentUser.name || 'مستخدم'}</span>
            <span class="text-amber-400 text-[10px] font-mono font-black">(${userRole})</span>
          </div>

          <button onclick="window.MazajNav.logout()" title="تسجيل الخروج" class="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 rounded-lg text-[11px] font-bold cursor-pointer transition-colors">
            🚪 خروج
          </button>
        </div>
      </header>
    `;

    // Sidebar Container HTML
    const sidebarWidth = isCollapsed() ? '64px' : '230px';
    const sidebarHTML = `
      <aside id="app-sidebar" style="width: ${sidebarWidth};" class="hidden md:flex flex-col bg-slate-900/90 backdrop-blur-md border-l border-slate-800 shrink-0 h-full select-none transition-all duration-200">
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
          <span class="text-slate-600 font-mono text-[9px]">v2.6</span>
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
      <footer class="h-[28px] bg-slate-950/95 border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-500 shrink-0 z-50 select-none">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1 text-emerald-400 font-bold">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>نظام التشغيل نشط</span>
          </span>
          <span class="text-slate-700">|</span>
          <span class="text-slate-400">كافيه مزاج - نظام إدارة العمليات والضيافة</span>
        </div>
        <div class="flex items-center gap-3 font-mono text-[10px]">
          <span>شبكة محلية (LAN)</span>
          <span class="text-slate-700">|</span>
          <span class="text-amber-500/80 font-bold">طابعة: 192.168.1.100</span>
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
    rootContainer.appendChild(headerWrapper.firstElementChild);

    const mainBody = document.createElement('div');
    mainBody.className = 'flex flex-1 min-h-0 w-full overflow-hidden';

    const tempSidebar = document.createElement('div');
    tempSidebar.innerHTML = sidebarHTML;
    while (tempSidebar.firstChild) {
      mainBody.appendChild(tempSidebar.firstChild);
    }

    const contentArea = document.createElement('div');
    contentArea.id = 'app-content-area';
    contentArea.className = 'flex-1 min-w-0 h-full flex flex-col overflow-y-auto scrollbar-thin';

    while (document.body.firstChild) {
      contentArea.appendChild(document.body.firstChild);
    }

    mainBody.appendChild(contentArea);
    rootContainer.appendChild(mainBody);

    const footerWrapper = document.createElement('div');
    footerWrapper.innerHTML = footerHTML;
    rootContainer.appendChild(footerWrapper.firstElementChild);

    document.body.appendChild(rootContainer);

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    });

    setInterval(updateClock, 1000);
    updateClock();
  }

  // Export functions globally
  window.MazajNav = {
    toggleSidebar,
    toggleMobileMenu,
    toggleShiftType,
    logout,
    initNav: validateSessionAndRender
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', validateSessionAndRender);
  } else {
    validateSessionAndRender();
  }
})();
