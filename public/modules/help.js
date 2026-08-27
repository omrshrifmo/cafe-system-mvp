/**
 * Enterprise In-App Help, Searchable Manual, and Guided Walkthrough Module
 * Injects a non-intrusive floating help icon and modal on any page.
 */
(function() {
  const ROLE_CHECKLISTS = {
    'OWNER': [
      { id: 1, text_ar: 'مراجعة السياسة الضريبية وإعدادات الفرع من الإعدادات', route: '/settings.html' },
      { id: 2, text_ar: 'الاطلاع على تقارير الأرباح وتوزيعات الشركاء', route: '/shareholders.html' },
      { id: 3, text_ar: 'متابعة مؤشرات الأداء الحية ومبيعات الأقسام في BI', route: '/bi.html' },
      { id: 4, text_ar: 'اعتماد إغلاق اليومية وفروقات الخزينة (EOD)', route: '/eod.html' }
    ],
    'OP_MANAGER': [
      { id: 1, text_ar: 'فتح الوردية الصباحية أو المسائية والتأكد من رصيد الدرج', route: '/portal.html' },
      { id: 2, text_ar: 'متابعة حركة الطاولات ونسب الإشغال في الصالة', route: '/tables.html' },
      { id: 3, text_ar: 'مراقبة سرعة إنجاز الطلبات في شاشات المطبخ والبار KDS', route: '/kds.html' },
      { id: 4, text_ar: 'فحص نواقص المخزون وسجلات التوالف اليومية', route: '/inventory.html' }
    ],
    'OP_ASSISTANT_CASHIER': [
      { id: 1, text_ar: 'استلام عهدة الدرج النقدية والتأكد من فتح الوردية', route: '/pos.html' },
      { id: 2, text_ar: 'تسجيل طلبات الصالة والسفري بسرعة وبدقة', route: '/pos.html' },
      { id: 3, text_ar: 'تحصيل المدفوعات (كاش / فيزا / مقسم) وطباعة الفاتورة', route: '/pos.html' },
      { id: 4, text_ar: 'إجراء الجرد الأعمى النقدي عند تسليم الوردية', route: '/eod.html' }
    ],
    'BARISTA': [
      { id: 1, text_ar: 'استقبال تذاكر المشروبات الساخنة والباردة فور طلبها', route: '/kds.html' },
      { id: 2, text_ar: 'الضغط على "بدء التحضير" ثم "جاهز للتسليم"', route: '/kds.html' },
      { id: 3, text_ar: 'متابعة رصيد الحليب والبن من تبويب الخامات', route: '/kds.html' }
    ],
    'CHEF': [
      { id: 1, text_ar: 'استعراض تذاكر الوجبات والمأكولات في شاشة المطبخ', route: '/kitchen.html' },
      { id: 2, text_ar: 'الالتزام بمعايير الوصفة والمكونات المحددة', route: '/kitchen.html' },
      { id: 3, text_ar: 'تحديث حالة الصنف إلى جاهز لإشعار الويتر/الرنر', route: '/kitchen.html' }
    ],
    'WAITER': [
      { id: 1, text_ar: 'تسجيل جلوس الضيوف وفتح الطاولة في الصالة', route: '/tables.html' },
      { id: 2, text_ar: 'أخذ الطلبات مع الملاحظات الخاصة وإرسالها للمحطات', route: '/pos.html' },
      { id: 3, text_ar: 'طلب الحساب عند رغبة العميل وطباعة الشيك الأولي', route: '/tables.html' }
    ],
    'RUNNER': [
      { id: 1, text_ar: 'استلام الطلبات الجاهزة من البار والمطبخ والشيشة', route: '/runner.html' },
      { id: 2, text_ar: 'تأكيد توصيل الطلب لطاولة العميل في شاشة الرنر', route: '/runner.html' }
    ]
  };

  const MANUAL_SECTIONS = [
    {
      id: 'login_security',
      title_ar: 'تسجيل الدخول والأمان وقفل الشاشة',
      title_en: 'Login, Security & Screen Lock',
      content_ar: `• تسجيل الدخول: يتم إدخال رمز PIN المكون من 4 أرقام المخصص لكل موظف.
• قفل الخمول: يتم قفل الشاشة تلقائياً بعد 15 ثانية من عدم النشاط لحماية الدرج والعمليات المالية.
• وضع النشاط المستمر (Caffeine Mode): يتيح إبقاء الشاشة مفعلة أثناء ضغط العمل بحد أقصى ساعتين (120 دقيقة).
• الخروج الآمن: بالضغط على "خروج"، يتم إنهاء الجلسة فورياً في السيرفر ومسح البيانات المؤقتة.`
    },
    {
      id: 'pos_orders',
      title_ar: 'نقطة البيع (POS) وإدارة الطلبات',
      title_en: 'Point of Sale & Orders',
      content_ar: `• إنشاء طلب: اختر الصنف والحجم والإضافات، ثم حدد رقم الطاولة أو سفري.
• طرق الدفع: يدعم النظام الكاش، البطاقات المصرفية، المحافظ الإلكترونية، والدفع المقسم (Split).
• الخصومات: تتطلب موافقة المدير وتوثق تلقائياً في سجل الرقابة المالي.`
    },
    {
      id: 'bom_inventory',
      title_ar: 'الوصفات وشجرة التكاليف (BOM) والمخزون',
      title_en: 'Recipes, BOM & Inventory',
      content_ar: `• الخصم التلقائي: يتم استهلاك الخامات (جرام / مل / حبة) فور تأكيد وبيع الصنف.
• تحويل الكثافة للسوائل: يتم احتساب حجم السوائل الموزونة بدقة عبر كثافة كل مادة معتمدة (حجم = وزن / كثافة).
• الجرد الدوري: يتيح تسجيل الفعلي مقارنة بالمحسوب واحتساب الفروقات والتوالف بنزاهة.`
    },
    {
      id: 'shifts_eod',
      title_ar: 'الورديات والإغلاق اليومي المالي (EOD)',
      title_en: 'Shifts & End of Day Close',
      content_ar: `• استلام الوردية: يبدأ بتسجيل عهدة الافتتاح (Float).
• الجرد الأعمى (Blind Count): يقوم الكاشير بعد النقد الفعلي دون إظهار الرصيد المتوقع لمنع التلاعب.
• معادلة الدرج: المتوقع = العهدة + مبيعات الكاش - المرتجعات + الإيداعات - المصروفات.`
    }
  ];

  function openHelpModal() {
    if (document.getElementById('mazaj-help-modal')) {
      document.getElementById('mazaj-help-modal').classList.remove('hidden');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'mazaj-help-modal';
    overlay.dir = 'rtl';
    overlay.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[999999] flex flex-col items-center justify-center p-4 select-none';
    overlay.style.fontFamily = "'Cairo', system-ui, sans-serif";

    overlay.innerHTML = `
      <div class="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <!-- Header -->
        <div class="p-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-2xl">📖</span>
            <div>
              <h2 class="text-base font-black text-slate-100">دليل الاستخدام والمساعدة السريعة</h2>
              <p class="text-xs text-slate-400">كافيه مزاج — نظام التشغيل والإدارة</p>
            </div>
          </div>
          <button onclick="document.getElementById('mazaj-help-modal').classList.add('hidden')" class="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center cursor-pointer">
            ✕
          </button>
        </div>

        <!-- Search Bar -->
        <div class="p-3 bg-slate-900 border-b border-slate-800">
          <input type="text" id="manualSearchInput" oninput="window.MazajHelp.filterManual(this.value)" placeholder="ابحث في دليل الاستخدام والتعليمات..." class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none">
        </div>

        <!-- Content Body -->
        <div class="p-4 overflow-y-auto space-y-4 flex-1 text-xs" id="manualContentArea">
          <!-- Role Checklist Banner -->
          <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h3 class="font-bold text-amber-400 mb-2 flex items-center gap-1">
              <span>📋</span>
              <span>قائمة المهام السريعة لدورك الحالي</span>
            </h3>
            <ul id="helpRoleChecklist" class="space-y-1.5 text-slate-300">
              <li>• جاري تحميل مهام دورك...</li>
            </ul>
          </div>

          <!-- Manual Articles -->
          <div id="manualArticles" class="space-y-3">
            ${MANUAL_SECTIONS.map(s => `
              <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700 manual-card" data-title="${s.title_ar} ${s.title_en}">
                <h4 class="font-bold text-slate-100 mb-1.5">${s.title_ar}</h4>
                <p class="text-slate-300 whitespace-pre-line leading-relaxed text-[11px]">${s.content_ar}</p>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Footer -->
        <div class="p-3 bg-slate-800/80 border-t border-slate-700 flex items-center justify-between text-xs">
          <a href="/manual.html" target="_blank" class="text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1">
            <span>📚</span>
            <span>فتح الدليل الكامل في صفحة منفصلة</span>
          </a>
          <button onclick="document.getElementById('mazaj-help-modal').classList.add('hidden')" class="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg font-bold cursor-pointer">
            إغلاق
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    populateRoleChecklist();
  }

  async function populateRoleChecklist() {
    const listEl = document.getElementById('helpRoleChecklist');
    if (!listEl) return;

    let role = 'OWNER';
    if (window.AuthModule && typeof window.AuthModule.getCurrentUser === 'function') {
      const user = window.AuthModule.getCurrentUser();
      if (user && user.role) role = user.role;
    }

    const items = ROLE_CHECKLISTS[role] || ROLE_CHECKLISTS['OWNER'];
    listEl.innerHTML = items.map(item => `
      <li class="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-slate-800">
        <span>${item.text_ar}</span>
        <a href="${item.route}" class="text-amber-400 hover:text-amber-300 font-bold text-[10px] px-2 py-1 bg-amber-500/10 rounded">انتقال ←</a>
      </li>
    `).join('');
  }

  function filterManual(query) {
    const term = (query || '').toLowerCase().trim();
    const cards = document.querySelectorAll('.manual-card');
    cards.forEach(card => {
      const text = (card.getAttribute('data-title') + ' ' + card.innerText).toLowerCase();
      if (!term || text.includes(term)) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  }

  // Floating trigger button injection
  function injectFloatingButton() {
    if (document.getElementById('mazaj-floating-help-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mazaj-floating-help-btn';
    btn.title = 'دليل الاستخدام والمساعدة';
    btn.className = 'fixed bottom-4 left-4 w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center justify-center shadow-2xl z-[99990] transition-transform hover:scale-110 cursor-pointer border border-amber-300';
    btn.innerHTML = '❓';
    btn.onclick = openHelpModal;
    document.body.appendChild(btn);
  }

  if (typeof window !== 'undefined') {
    window.MazajHelp = {
      openHelp: openHelpModal,
      filterManual: filterManual,
      getRoleChecklist: (role) => ROLE_CHECKLISTS[role] || []
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectFloatingButton);
    } else {
      injectFloatingButton();
    }
  }
})();
