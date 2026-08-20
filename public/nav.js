/**
 * كافيه مزاج - Universal Enterprise Unified Navigation, Design System & Shell
 * Unified Header, Collapsible Multi-Group Sidebar, and Compact Footer
 * Standardized on 'Tajawal' Typography & Slate-900/950 Theme
 */

(function () {
  // Navigation Route Configuration Grouped by Domain
  const navGroups = [
    {
      groupTitle: 'الصالة ونقطة البيع',
      items: [
        { title: 'نقطة البيع (POS)', path: '/pos.html', icon: '💳', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'HALL_MANAGER', 'WAITER', 'ADMIN', 'MANAGER', 'CASHIER'] },
        { title: 'إدارة وتوزيع الطاولات', path: '/tables.html', icon: '🪑', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'HALL_MANAGER', 'WAITER', 'ADMIN', 'MANAGER', 'CASHIER'] },
        { title: 'إدارة الحجوزات', path: '/reservations.html', icon: '📅', roles: ['OWNER', 'OP_MANAGER', 'HALL_MANAGER', 'WAITER', 'ADMIN', 'MANAGER'] },
        { title: 'شاشة الويتر والرانر', path: '/runner.html', icon: '🏃', roles: ['OWNER', 'OP_MANAGER', 'HALL_MANAGER', 'WAITER', 'BARISTA', 'SHIASH', 'CHEF', 'ADMIN', 'MANAGER'] }
      ]
    },
    {
      groupTitle: 'شاشات التحضير KDS',
      items: [
        { title: 'شاشة البارستا', path: '/kds.html', icon: '☕', roles: ['OWNER', 'OP_MANAGER', 'BARISTA', 'ADMIN', 'MANAGER'] },
        { title: 'شاشة المطبخ', path: '/kitchen.html', icon: '🍳', roles: ['OWNER', 'OP_MANAGER', 'CHEF', 'ADMIN', 'MANAGER'] },
        { title: 'شاشة الشيشة', path: '/shisha.html', icon: '💨', roles: ['OWNER', 'OP_MANAGER', 'SHIASH', 'ADMIN', 'MANAGER'] }
      ]
    },
    {
      groupTitle: 'المخزون والمشتريات',
      items: [
        { title: 'مدير قائمة الطعام', path: '/menu-manager.html', icon: '🍽️', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
        { title: 'المخزون ومطابقة BOM', path: '/inventory.html', icon: '📦', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
        { title: 'دليل الموردين', path: '/suppliers.html', icon: '🚚', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
        { title: 'فواتير المشتريات', path: '/purchasing.html', icon: '🛒', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] }
      ]
    },
    {
      groupTitle: 'العملاء والموارد البشرية',
      items: [
        { title: 'العملاء والولاء (CRM)', path: '/crm.html', icon: '👥', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER', 'CASHIER'] },
        { title: 'الموارد البشرية والرواتب', path: '/hr.html', icon: '💼', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
        { title: 'معايير الجودة والـ QA', path: '/qa.html', icon: '🛡️', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] }
      ]
    },
    {
      groupTitle: 'التقارير والإدارة المالية',
      items: [
        { title: 'تقفيل الوردية (EOD)', path: '/eod.html', icon: '📊', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'ADMIN', 'MANAGER', 'CASHIER'] },
        { title: 'مؤشرات الأداء (BI)', path: '/bi.html', icon: '📈', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
        { title: 'حسابات الشركاء', path: '/shareholders.html', icon: '💎', roles: ['OWNER', 'ADMIN'] },
        { title: 'البوابة الرئيسية', path: '/portal.html', icon: '🏠', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'HALL_MANAGER', 'WAITER', 'BARISTA', 'SHIASH', 'CHEF', 'ADMIN', 'MANAGER', 'CASHIER'] }
      ]
    }
  ];

  function injectGlobalStyles() {
    if (document.getElementById('mazaj-global-styles')) return;

    // Load Tajawal font if not already loaded
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

  function logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userTools');
    window.location.href = '/index.html';
  }

  function updateClock() {
    const el = document.getElementById('nav-live-clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

  function initNav() {
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname.endsWith('/index.html') || pathname.includes('qr-menu.html')) {
      return;
    }

    injectGlobalStyles();

    const currentUser = getStoredUser();
    const userRole = currentUser.role || 'OWNER';
    const currentShift = getActiveShiftType();

    // Determine current active page title
    let currentPageTitle = 'لوحة التحكم';
    for (const grp of navGroups) {
      for (const item of grp.items) {
        if (pathname.endsWith(item.path)) {
          currentPageTitle = item.title;
          break;
        }
      }
    }

    // Top Unified Header Bar HTML (Height: 46px)
    const topBarHTML = `
      <header class="h-[46px] bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-300 shrink-0 z-50 select-none shadow-md">
        <!-- Right side: Toggle, Logo & Current Page -->
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

        <!-- Left side: Shift badge, Clock, User Profile & Logout -->
        <div class="flex items-center gap-2.5">
          <!-- Shift Switcher Button -->
          <button onclick="window.MazajNav.toggleShiftType()" id="global-shift-badge" title="اضغط للتبديل بين الورديات" class="px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer border flex items-center gap-1.5 transition-all shadow-sm ${
            currentShift === 'MORNING' 
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25' 
              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/25'
          }">
            <span>${currentShift === 'MORNING' ? '☀️' : '🌙'}</span>
            <span>${currentShift === 'MORNING' ? 'وردية صباحية' : 'وردية مسائية'}</span>
          </button>

          <!-- Live Clock -->
          <div id="nav-live-clock" class="hidden lg:block text-slate-400 font-mono text-[11px] bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            00:00:00 م
          </div>

          <!-- User Pill -->
          <div class="px-2.5 py-1 bg-slate-950 rounded-lg text-[11px] font-bold text-slate-300 border border-slate-800 flex items-center gap-1.5">
            <span>👤</span>
            <span class="text-white max-w-[100px] truncate">${currentUser.name || 'مستخدم'}</span>
            <span class="text-amber-400 text-[10px] font-mono font-black">(${userRole})</span>
          </div>

          <!-- Logout Button -->
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
        <!-- Navigation Groups -->
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

        <!-- Sidebar Footer Status -->
        <div class="p-2 border-t border-slate-800/80 bg-slate-950/40 text-[10px] text-slate-500 flex items-center justify-between">
          <span class="nav-label truncate ${isCollapsed() ? 'hidden' : ''}">🟢 الخادم متصل</span>
          <span class="text-slate-600 font-mono text-[9px]">v2.6</span>
        </div>
      </aside>

      <!-- Mobile Drawer Overlay -->
      <div id="mobile-drawer-overlay" class="md:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[99] hidden flex justify-start">
        <div class="w-72 bg-slate-900 h-full border-l border-slate-800 flex flex-col p-4 shadow-2xl overflow-y-auto scrollbar-thin">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">☕</span>
              <span class="font-black text-sm text-amber-400">كافيه مزاج</span>
            </div>
            <button onclick="window.MazajNav.toggleMobileMenu()" class="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm cursor-pointer">✕</button>
          </div>

          <nav class="flex-1 overflow-y-auto space-y-4">
            ${navGroups.map(grp => {
              const accessibleItems = grp.items.filter(item => item.roles.includes(userRole));
              if (accessibleItems.length === 0) return '';

              return `
                <div>
                  <div class="text-[10px] font-bold text-slate-500 uppercase px-2 mb-1.5">${grp.groupTitle}</div>
                  <div class="space-y-1">
                    ${accessibleItems.map(item => {
                      const isActive = pathname.endsWith(item.path);
                      return `
                        <a href="${item.path}" onclick="window.MazajNav.toggleMobileMenu()" class="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold ${
                          isActive ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-300 hover:bg-slate-800'
                        }">
                          <span class="text-base">${item.icon}</span>
                          <span class="text-xs">${item.title}</span>
                        </a>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </nav>
        </div>
      </div>
    `;

    // Unified Bottom Footer HTML (Height: 28px)
    const footerHTML = `
      <footer class="h-7 bg-slate-950 border-t border-slate-800/80 px-4 flex items-center justify-between text-[10px] text-slate-500 shrink-0 z-40 select-none">
        <div class="flex items-center gap-3">
          <span class="font-bold text-slate-400">كافيه مزاج &copy; 2026</span>
          <span class="text-slate-700">|</span>
          <span>نظام التشغيل وإدارة المطاعم المتكامل</span>
        </div>
        <div class="flex items-center gap-3 font-mono">
          <span class="text-emerald-400 font-bold">● متصل بالخادم المحلي</span>
          <span class="hidden sm:inline text-slate-600">|</span>
          <span class="hidden sm:inline">اختصار القائمة: <kbd class="px-1 bg-slate-800 rounded border border-slate-700 text-slate-400">Ctrl+B</kbd></span>
        </div>
      </footer>
    `;

    // Wrap page contents into rootContainer: Header + (Sidebar + ContentArea) + Footer
    const rootContainer = document.createElement('div');
    rootContainer.className = 'flex flex-col h-screen max-h-screen w-screen overflow-hidden bg-slate-950 text-slate-100';
    rootContainer.dir = 'rtl';

    // 1. Insert Top Header
    const topBarWrapper = document.createElement('div');
    topBarWrapper.innerHTML = topBarHTML;
    rootContainer.appendChild(topBarWrapper.firstElementChild);

    // 2. Middle Body (Sidebar + Content)
    const mainBody = document.createElement('div');
    mainBody.className = 'flex flex-1 min-h-0 min-w-0 overflow-hidden';

    const tempSidebar = document.createElement('div');
    tempSidebar.innerHTML = sidebarHTML;
    while (tempSidebar.firstChild) {
      mainBody.appendChild(tempSidebar.firstChild);
    }

    const contentArea = document.createElement('div');
    contentArea.id = 'app-content-area';
    contentArea.className = 'flex-1 min-w-0 h-full flex flex-col overflow-y-auto scrollbar-thin';

    // Move existing body children to contentArea
    while (document.body.firstChild) {
      contentArea.appendChild(document.body.firstChild);
    }

    mainBody.appendChild(contentArea);
    rootContainer.appendChild(mainBody);

    // 3. Insert Footer
    const footerWrapper = document.createElement('div');
    footerWrapper.innerHTML = footerHTML;
    rootContainer.appendChild(footerWrapper.firstElementChild);

    // Append root container to body
    document.body.appendChild(rootContainer);

    // Keyboard shortcut for toggling sidebar (Ctrl + B)
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
    initNav
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
