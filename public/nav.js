/**
 * كافيه مزاج - Enterprise ERP Universal Side Navigation Component
 * Zero-animation, high-density, Arabic RTL, Role-Filtered Collapsible Side Drawer
 */

(function () {
  // All navigation routes with roles
  const navItems = [
    { title: 'القائمة الرئيسية', path: '/portal.html', icon: '🏠', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'HALL_MANAGER', 'WAITER', 'BARISTA', 'SHIASH', 'CHEF', 'ADMIN', 'MANAGER', 'CASHIER'] },
    { title: 'نقطة البيع (POS)', path: '/pos.html', icon: '💳', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'HALL_MANAGER', 'WAITER', 'ADMIN', 'MANAGER', 'CASHIER'] },
    { title: 'شاشة المشروبات (Barista)', path: '/kds.html', icon: '☕', roles: ['OWNER', 'OP_MANAGER', 'BARISTA', 'ADMIN', 'MANAGER'] },
    { title: 'شاشة الشيشة (Shisha)', path: '/shisha.html', icon: '💨', roles: ['OWNER', 'OP_MANAGER', 'SHIASH', 'ADMIN', 'MANAGER'] },
    { title: 'شاشة المطبخ (Kitchen)', path: '/kitchen.html', icon: '🍳', roles: ['OWNER', 'OP_MANAGER', 'CHEF', 'ADMIN', 'MANAGER'] },
    { title: 'شاشة التوصيل (Runner)', path: '/runner.html', icon: '🏃', roles: ['OWNER', 'OP_MANAGER', 'HALL_MANAGER', 'WAITER', 'BARISTA', 'SHIASH', 'CHEF', 'ADMIN', 'MANAGER'] },
    { title: 'الموارد البشرية والرواتب', path: '/hr.html', icon: '👥', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'إدارة الجودة والشكاوى', path: '/qa.html', icon: '🛡️', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'مؤشرات الأداء (BI)', path: '/bi.html', icon: '📊', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'تقرير تقفيل اليوم (EOD)', path: '/eod.html', icon: '📜', roles: ['OWNER', 'OP_MANAGER', 'OP_ASSISTANT_CASHIER', 'ADMIN', 'MANAGER', 'CASHIER'] },
    { title: 'إدارة القائمة والوصفات', path: '/admin-menu.html', icon: '🍽️', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'إدارة المخزون والخامات', path: '/inventory.html', icon: '📦', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'سجل المشتريات والتوريد', path: '/purchasing.html', icon: '🛒', roles: ['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'] },
    { title: 'سجل الشركاء والأرباح', path: '/shareholders.html', icon: '💰', roles: ['OWNER', 'ADMIN'] }
  ];

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
      return {};
    }
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
    const titleEl = document.getElementById('sidebar-brand-title');
    if (!sidebar) return;

    if (isCollapsed()) {
      sidebar.classList.remove('w-60');
      sidebar.classList.add('w-14');
      if (titleEl) titleEl.classList.add('hidden');
      labelEls.forEach(el => el.classList.add('hidden'));
      if (toggleBtn) toggleBtn.innerText = '◀';
    } else {
      sidebar.classList.remove('w-14');
      sidebar.classList.add('w-60');
      if (titleEl) titleEl.classList.remove('hidden');
      labelEls.forEach(el => el.classList.remove('hidden'));
      if (toggleBtn) toggleBtn.innerText = '▶';
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
    window.location.href = '/index.html';
  }

  function initNav() {
    // If login screen index.html, do not inject nav
    if (window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) {
      return;
    }

    const currentUser = getStoredUser();
    const userRole = currentUser.role || 'OWNER';
    const currentPath = window.location.pathname;

    // Filter routes by user role
    const accessibleNavItems = navItems.filter(item => item.roles.includes(userRole));

    // Inject Navigation Sidebar HTML into document
    const sidebarHTML = `
      <!-- Desktop Sidebar Container -->
      <aside id="app-sidebar" class="hidden md:flex flex-col bg-slate-900 border-l border-slate-800 shrink-0 h-screen sticky top-0 z-30 transition-none select-none ${isCollapsed() ? 'w-14' : 'w-60'}">
        <!-- Brand Header -->
        <div class="h-14 px-3 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div class="flex items-center gap-2 overflow-hidden">
            <span class="text-xl shrink-0">☕</span>
            <span id="sidebar-brand-title" class="font-black text-xs text-amber-400 truncate ${isCollapsed() ? 'hidden' : ''}">كافيه مزاج</span>
          </div>
          <button id="sidebar-toggle-btn" onclick="window.MazajNav.toggleSidebar()" class="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-bold text-xs flex items-center justify-center cursor-pointer border border-slate-700 shrink-0">
            ${isCollapsed() ? '◀' : '▶'}
          </button>
        </div>

        <!-- Role Badge -->
        <div class="p-2 border-b border-slate-800/80 bg-slate-950/40">
          <div class="px-2 py-1 bg-slate-800/60 rounded-lg text-[10px] font-bold text-slate-400 flex items-center justify-between">
            <span class="truncate">👤 ${currentUser.name || 'مستخدم'}</span>
            <span class="text-amber-400 font-mono font-extrabold text-[9px] shrink-0">${userRole}</span>
          </div>
        </div>

        <!-- Links List -->
        <nav class="flex-1 overflow-y-auto p-1.5 space-y-1">
          ${accessibleNavItems.map(item => {
            const isActive = currentPath.endsWith(item.path);
            return `
              <a href="${item.path}" title="${item.title}" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold ${
                isActive
                  ? 'bg-amber-500 text-slate-950 font-black border border-amber-400 shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white border border-transparent'
              }">
                <span class="text-base shrink-0">${item.icon}</span>
                <span class="nav-label truncate ${isCollapsed() ? 'hidden' : ''}">${item.title}</span>
              </a>
            `;
          }).join('')}
        </nav>

        <!-- Footer / Logout -->
        <div class="p-2 border-t border-slate-800 shrink-0">
          <button onclick="window.MazajNav.logout()" title="تسجيل الخروج" class="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-bold text-rose-400 bg-rose-950/30 hover:bg-rose-900/50 border border-rose-500/30 cursor-pointer">
            <span class="text-base shrink-0">🚪</span>
            <span class="nav-label truncate ${isCollapsed() ? 'hidden' : ''}">خروج</span>
          </button>
        </div>
      </aside>

      <!-- Mobile Floating Navigation Trigger Button -->
      <button onclick="window.MazajNav.toggleMobileMenu()" class="md:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-amber-500 text-slate-950 font-black text-xl flex items-center justify-center shadow-2xl border-2 border-amber-300 cursor-pointer hover:scale-105 active:scale-95">
        ☰
      </button>

      <!-- Mobile Drawer Overlay -->
      <div id="mobile-drawer-overlay" class="md:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[90] hidden flex justify-start">
        <div class="w-72 bg-slate-900 h-full border-l border-slate-800 flex flex-col p-4 shadow-2xl overflow-y-auto">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">☕</span>
              <span class="font-black text-sm text-amber-400">كافيه مزاج</span>
            </div>
            <button onclick="window.MazajNav.toggleMobileMenu()" class="text-slate-400 hover:text-white font-bold text-lg cursor-pointer">✕</button>
          </div>

          <div class="mb-3 p-2 bg-slate-950 rounded-xl border border-slate-800 text-xs font-bold text-slate-300">
            <div>👤 ${currentUser.name || 'مستخدم'}</div>
            <div class="text-[10px] text-amber-400 font-mono">${userRole}</div>
          </div>

          <nav class="flex-1 overflow-y-auto space-y-1.5">
            ${accessibleNavItems.map(item => {
              const isActive = currentPath.endsWith(item.path);
              return `
                <a href="${item.path}" onclick="window.MazajNav.toggleMobileMenu()" class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold ${
                  isActive
                    ? 'bg-amber-500 text-slate-950 font-black border border-amber-400 shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                }">
                  <span class="text-lg">${item.icon}</span>
                  <span>${item.title}</span>
                </a>
              `;
            }).join('')}
          </nav>

          <button onclick="window.MazajNav.logout()" class="mt-3 w-full py-2.5 bg-rose-950 text-rose-300 border border-rose-500/40 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer">
            <span>🚪</span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    `;

    // Wrap page content inside flex container if not already
    const wrapper = document.createElement('div');
    wrapper.className = 'flex h-screen max-h-screen w-screen overflow-hidden dir-rtl';
    wrapper.dir = 'rtl';

    // Move existing body children to wrapper content area
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 min-w-0 h-full flex flex-col overflow-hidden pb-16 md:pb-0';

    while (document.body.firstChild) {
      contentArea.appendChild(document.body.firstChild);
    }

    document.body.appendChild(wrapper);

    // Create a temporary container to parse sidebarHTML
    const tempNavContainer = document.createElement('div');
    tempNavContainer.innerHTML = sidebarHTML;

    // Append sidebar first (RTL right-side), then content area
    while (tempNavContainer.firstChild) {
      wrapper.appendChild(tempNavContainer.firstChild);
    }
    wrapper.appendChild(contentArea);
  }

  // Export functions globally
  window.MazajNav = {
    toggleSidebar,
    toggleMobileMenu,
    logout,
    initNav
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
