/**
 * كافيه مزاج - Universal UI State Contract, Modal Manager & Resilient UX Module
 * Standardizes 14 canonical UI states across all operational surfaces:
 * LOADING, READY, EMPTY, ERROR, TIMEOUT, RETRYING, OFFLINE, STALE, QUEUED, SYNCING, REJECTED, CONFLICT, SUCCESS, SETTLED
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UIState = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATES = {
    LOADING: 'LOADING',
    READY: 'READY',
    EMPTY: 'EMPTY',
    ERROR: 'ERROR',
    TIMEOUT: 'TIMEOUT',
    RETRYING: 'RETRYING',
    OFFLINE: 'OFFLINE',
    STALE: 'STALE',
    QUEUED: 'QUEUED',
    SYNCING: 'SYNCING',
    REJECTED: 'REJECTED',
    CONFLICT: 'CONFLICT',
    SUCCESS: 'SUCCESS',
    SETTLED: 'SETTLED'
  };

  const I18N = {
    ar: {
      LOADING: { title: 'جاري تحميل البيانات...', desc: 'يرجى الانتظار بينما يتم جلب البيانات المحدثة من الخادم.' },
      READY: { title: 'البيانات جاهزة', desc: 'تم تحميل كافة السجلات بنجاح.' },
      EMPTY: { title: 'لا توجد بيانات متاحة', desc: 'لم يتم العثور على أي عناصر أو سجلات مطابقة في هذا النطاق.' },
      ERROR: { title: 'حدث خطأ في النظام', desc: 'تعذر إتمام العملية بنجاح. يرجى مراجعة التفاصيل أو إعادة المحاولة.' },
      TIMEOUT: { title: 'انتهت مهلة الاتصال', desc: 'استغرق الخادم وقتاً أطول من المتوقع للاستجابة. يرجى التحقق من الشبكة.' },
      RETRYING: { title: 'جاري إعادة المحاولة...', desc: 'نقوم حالياً بإعادة محاولة إرسال الطلب تلقائياً.' },
      OFFLINE: { title: 'أنت غير متصل بالشبكة', desc: 'تم التبديل إلى وضع عدم الاتصال. سيتم حفظ العمليات المؤهلة محلياً.' },
      STALE: { title: 'البيانات المعروضة غير محدثة', desc: 'قد لا تعكس هذه الشاشة أحدث التغييرات نظراً لضعف الاتصال.' },
      QUEUED: { title: 'العملية قيد الانتظار', desc: 'تم حفظ الطلب في طابور الانتظار المحلي وسيتم إرساله فور استقرار الشبكة.' },
      SYNCING: { title: 'جاري مزامنة السجلات...', desc: 'يتم الآن ترحيل ومطابقة العمليات المحلية مع قاعدة البيانات المركزية.' },
      REJECTED: { title: 'تم رفض العملية', desc: 'الطلب غير مطابق لشروط الصلاحية أو السياسات المعتمدة للنظام.' },
      CONFLICT: { title: 'تعارض في إصدار البيانات', desc: 'تم تعديل هذا السجل بواسطة جهاز آخر. يرجى التحديث وإعادة المحاولة.' },
      SUCCESS: { title: 'تمت العملية بنجاح', desc: 'تم حفظ التغييرات وتأكيدها بواسطة الخادم بشكل نهائي.' },
      SETTLED: { title: 'تم التسوية والتحصيل', desc: 'تم سداد الحساب وإصدار الإيصال المالي المعتمد.' },
      buttons: {
        retry: '🔄 إعادة المحاولة',
        refresh: '🔄 تحديث الشاشة',
        cancel: 'إلغاء',
        close: 'إغلاق',
        resolveConflict: '⚡ حل التعارض وتحديث السجل',
        viewReceipt: '🧾 عرض الإيصال'
      },
      labels: {
        requestId: 'رقم التتبع (Request ID):',
        lastUpdated: 'آخر تحديث:',
        currency: 'ج.م'
      }
    },
    en: {
      LOADING: { title: 'Loading Data...', desc: 'Please wait while fetching latest records from server.' },
      READY: { title: 'Data Ready', desc: 'All records loaded successfully.' },
      EMPTY: { title: 'No Data Available', desc: 'No records matching the selected scope were found.' },
      ERROR: { title: 'System Error Occurred', desc: 'Operation could not be completed. Please review details or retry.' },
      TIMEOUT: { title: 'Connection Timeout', desc: 'Server took too long to respond. Please verify network health.' },
      RETRYING: { title: 'Retrying Request...', desc: 'Automatically retrying the operation now.' },
      OFFLINE: { title: 'Device Offline', desc: 'Switched to offline mode. Safe actions will be queued locally.' },
      STALE: { title: 'Data Is Stale', desc: 'This screen may not reflect latest updates due to network lag.' },
      QUEUED: { title: 'Operation Queued', desc: 'Action saved to local queue and will sync once online.' },
      SYNCING: { title: 'Syncing Outbox...', desc: 'Reconciling local queued actions with authoritative server ledger.' },
      REJECTED: { title: 'Action Rejected', desc: 'Operation violates security permissions or business policy rules.' },
      CONFLICT: { title: 'Version Conflict Detected', desc: 'Record was modified concurrently by another terminal.' },
      SUCCESS: { title: 'Operation Successful', desc: 'Changes confirmed and committed by server ledger.' },
      SETTLED: { title: 'Settled & Paid', desc: 'Payment received and fiscal receipt recorded.' },
      buttons: {
        retry: '🔄 Retry',
        refresh: '🔄 Refresh',
        cancel: 'Cancel',
        close: 'Close',
        resolveConflict: '⚡ Resolve Conflict & Reload',
        viewReceipt: '🧾 View Receipt'
      },
      labels: {
        requestId: 'Request ID:',
        lastUpdated: 'Last Updated:',
        currency: 'EGP'
      }
    }
  };

  let currentLang = 'ar';
  let activeModal = null;
  let previouslyFocusedElement = null;

  function setLanguage(lang) {
    if (I18N[lang]) currentLang = lang;
  }

  function getLanguage() {
    return currentLang;
  }

  function generateRequestId(prefix = 'REQ') {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  }

  function formatMoney(minorUnits, currency = 'EGP') {
    if (minorUnits === null || minorUnits === undefined || isNaN(minorUnits)) {
      return '--';
    }
    const val = Number(minorUnits) / 100;
    return new Intl.NumberFormat(currentLang === 'ar' ? 'ar-EG' : 'en-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val) + ' ' + (currentLang === 'ar' ? 'ج.م' : currency);
  }

  function formatDateTime(isoString) {
    if (!isoString) return '--';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '--';
      return date.toLocaleTimeString(currentLang === 'ar' ? 'ar-EG' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + ' - ' + date.toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', {
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return '--';
    }
  }

  /**
   * Render standardized state block into container
   */
  function render(containerOrSelector, state, options = {}) {
    const container = typeof containerOrSelector === 'string'
      ? document.querySelector(containerOrSelector)
      : containerOrSelector;

    if (!container) return;

    const lang = I18N[currentLang];
    const stateConfig = lang[state] || lang.READY;
    const title = options.title || stateConfig.title;
    const desc = options.desc || stateConfig.desc;
    const requestId = options.requestId || null;
    const lastUpdated = options.lastUpdated ? formatDateTime(options.lastUpdated) : formatDateTime(new Date().toISOString());
    const onRetry = options.onRetry || null;
    const onRefresh = options.onRefresh || null;

    let icon = 'ℹ️';
    let borderColor = 'border-slate-800';
    let bgColor = 'bg-slate-900/90';
    let titleColor = 'text-slate-100';

    switch (state) {
      case STATES.LOADING:
      case STATES.RETRYING:
      case STATES.SYNCING:
        icon = '<div class="w-8 h-8 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>';
        borderColor = 'border-amber-500/40';
        bgColor = 'bg-slate-900/95';
        titleColor = 'text-amber-400';
        break;
      case STATES.EMPTY:
        icon = '📭';
        borderColor = 'border-slate-700/50';
        titleColor = 'text-slate-300';
        break;
      case STATES.ERROR:
      case STATES.TIMEOUT:
      case STATES.REJECTED:
        icon = '⚠️';
        borderColor = 'border-rose-500/50';
        bgColor = 'bg-rose-950/20';
        titleColor = 'text-rose-400';
        break;
      case STATES.OFFLINE:
      case STATES.STALE:
      case STATES.QUEUED:
        icon = '📡';
        borderColor = 'border-amber-600/50';
        bgColor = 'bg-amber-950/20';
        titleColor = 'text-amber-300';
        break;
      case STATES.CONFLICT:
        icon = '⚡';
        borderColor = 'border-orange-500/60';
        bgColor = 'bg-orange-950/30';
        titleColor = 'text-orange-400';
        break;
      case STATES.SUCCESS:
      case STATES.SETTLED:
        icon = '✅';
        borderColor = 'border-emerald-500/50';
        bgColor = 'bg-emerald-950/20';
        titleColor = 'text-emerald-400';
        break;
    }

    const stateHtml = `
      <div class="mazaj-state-card w-full p-6 my-3 rounded-2xl border ${borderColor} ${bgColor} backdrop-blur-md flex flex-col items-center justify-center text-center shadow-xl transition-all" role="status" aria-live="polite">
        <div class="text-3xl mb-3 flex items-center justify-center">${typeof icon === 'string' && icon.startsWith('<') ? icon : `<span class="text-4xl select-none">${icon}</span>`}</div>
        <h3 class="text-base font-black ${titleColor} mb-1">${title}</h3>
        <p class="text-xs text-slate-300 max-w-md leading-relaxed mb-4">${desc}</p>
        
        ${options.errorMessage ? `
          <div class="w-full max-w-lg mb-4 p-3 bg-slate-950/80 border border-rose-500/30 rounded-xl text-left font-mono text-[11px] text-rose-300 overflow-x-auto select-all">
            ${options.errorMessage}
          </div>
        ` : ''}

        <div class="flex flex-wrap items-center justify-center gap-2 mb-3">
          ${onRetry ? `
            <button class="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5 focus:ring-2 focus:ring-amber-300 focus:outline-none" onclick="(${onRetry.toString()})()">
              <span>${lang.buttons.retry}</span>
            </button>
          ` : ''}
          ${onRefresh ? `
            <button class="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 shadow-md transition-all cursor-pointer flex items-center gap-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none" onclick="(${onRefresh.toString()})()">
              <span>${lang.buttons.refresh}</span>
            </button>
          ` : ''}
          ${options.customActionsHtml || ''}
        </div>

        <div class="pt-3 border-t border-slate-800/80 w-full max-w-sm flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>${lang.labels.lastUpdated} <strong class="text-slate-300">${lastUpdated}</strong></span>
          ${requestId ? `<span>${lang.labels.requestId} <strong class="text-amber-400/90">${requestId}</strong></span>` : ''}
        </div>
      </div>
    `;

    container.innerHTML = stateHtml;
  }

  /**
   * Guard button from multiple submissions / clicks
   */
  async function guardButtonAction(button, asyncFn) {
    if (!button || button.disabled || button.dataset.actionExecuting === 'true') return;
    
    button.dataset.actionExecuting = 'true';
    button.disabled = true;
    const originalContent = button.innerHTML;
    
    try {
      button.innerHTML = `<span class="inline-flex items-center gap-2"><span class="w-3.5 h-3.5 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin"></span><span>جاري التنفيذ...</span></span>`;
      return await asyncFn();
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
      button.dataset.actionExecuting = 'false';
    }
  }

  /**
   * Accessible Modal Manager with Focus Trap and Escape Recovery
   */
  function trapFocus(modalElement) {
    const focusable = modalElement.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return () => {};

    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];

    const keyHandler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    modalElement.addEventListener('keydown', keyHandler);
    return () => modalElement.removeEventListener('keydown', keyHandler);
  }

  function openModal(modalId, options = {}) {
    if (typeof document === 'undefined') return;
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!modal) return;

    previouslyFocusedElement = document.activeElement;
    activeModal = modal;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const removeTrap = trapFocus(modal);
    modal._removeTrap = removeTrap;

    const escapeHandler = (e) => {
      if (e.key === 'Escape' && !options.preventEscape) {
        if (typeof options.onCancel === 'function') {
          options.onCancel();
        } else {
          closeModal(modal);
        }
      }
    };
    document.addEventListener('keydown', escapeHandler);
    modal._escapeHandler = escapeHandler;

    const focusable = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      setTimeout(() => focusable[0].focus(), 50);
    }
  }

  function closeModal(modalId) {
    if (typeof document === 'undefined') return;
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : (modalId || activeModal);
    if (!modal) return;

    modal.classList.add('hidden');
    modal.removeAttribute('aria-modal');
    modal.setAttribute('aria-hidden', 'true');

    if (modal._removeTrap) {
      modal._removeTrap();
      delete modal._removeTrap;
    }

    if (modal._escapeHandler) {
      document.removeEventListener('keydown', modal._escapeHandler);
      delete modal._escapeHandler;
    }

    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      try { previouslyFocusedElement.focus(); } catch (e) {}
    }

    if (activeModal === modal) activeModal = null;
  }

  /**
   * Generic In-Page Dialog Container
   */
  function getOrCreateDialogContainer() {
    if (typeof document === 'undefined') return null;
    let container = document.getElementById('mazaj-dialog-root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mazaj-dialog-root';
      container.setAttribute('aria-live', 'assertive');
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Accessible In-Page Alert Modal (Promise-based)
   */
  function showInPageAlert(message, options = {}) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve();

      const container = getOrCreateDialogContainer();
      if (!container) return resolve();

      const title = options.title || 'تنبيه من النظام';
      const severity = options.severity || 'info'; // 'info' | 'success' | 'warning' | 'error'
      const confirmText = options.confirmText || 'حسناً، فهمت';
      const requestId = options.requestId || null;

      const colors = {
        info: { border: 'border-amber-500/40', btn: 'bg-amber-500 hover:bg-amber-400 text-slate-950', icon: 'ℹ️' },
        success: { border: 'border-emerald-500/50', btn: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950', icon: '✅' },
        warning: { border: 'border-amber-500/60', btn: 'bg-amber-500 hover:bg-amber-400 text-slate-950', icon: '⚠️' },
        error: { border: 'border-rose-500/60', btn: 'bg-rose-600 hover:bg-rose-500 text-white', icon: '🚨' }
      }[severity] || { border: 'border-slate-700', btn: 'bg-amber-500 text-slate-950', icon: 'ℹ️' };

      const dialogId = 'mazaj-alert-' + Date.now();
      const modalEl = document.createElement('div');
      modalEl.id = dialogId;
      modalEl.className = 'fixed inset-0 z-[999999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('aria-labelledby', `${dialogId}-title`);
      modalEl.setAttribute('aria-describedby', `${dialogId}-desc`);
      modalEl.setAttribute('dir', 'rtl');

      modalEl.innerHTML = `
        <div class="bg-slate-900 border ${colors.border} rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100 flex flex-col gap-4 text-right transform transition-all animate-in fade-in zoom-in-95 duration-150">
          <div class="flex items-center gap-3">
            <span class="text-3xl">${colors.icon}</span>
            <h2 id="${dialogId}-title" class="text-base font-black text-slate-100">${title}</h2>
          </div>
          <div id="${dialogId}-desc" class="text-xs text-slate-300 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">${message}</div>
          ${options.technicalDetails ? `
            <details class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-slate-400">
              <summary class="cursor-pointer font-bold text-amber-400 select-none">تفاصيل فنية للدعم الفني</summary>
              <pre class="mt-2 text-rose-300 overflow-x-auto whitespace-pre-wrap">${options.technicalDetails}</pre>
            </details>
          ` : ''}
          ${requestId ? `<div class="text-[10px] font-mono text-slate-500 border-t border-slate-800 pt-2 flex justify-between"><span>معرف الطلب:</span><span class="text-amber-400">${requestId}</span></div>` : ''}
          <div class="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button id="${dialogId}-btn-ok" class="px-5 py-2.5 ${colors.btn} font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer focus:ring-2 focus:ring-amber-300 focus:outline-none">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      container.appendChild(modalEl);
      openModal(modalEl, {
        onCancel: () => {
          closeModal(modalEl);
          modalEl.remove();
          resolve(true);
        }
      });

      const okBtn = modalEl.querySelector(`#${dialogId}-btn-ok`);
      okBtn.onclick = () => {
        closeModal(modalEl);
        modalEl.remove();
        resolve(true);
      };
    });
  }

  /**
   * Accessible In-Page Confirm Modal (Promise-based)
   */
  function showInPageConfirm(message, options = {}) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(false);

      const container = getOrCreateDialogContainer();
      if (!container) return resolve(false);

      const title = options.title || 'تأكيد العملية';
      const severity = options.severity || 'warning'; // 'warning' | 'danger' | 'info'
      const confirmText = options.confirmText || 'نعم، متابعة';
      const cancelText = options.cancelText || 'إلغاء التراجع';
      const requestId = options.requestId || null;

      const colors = {
        warning: { border: 'border-amber-500/60', btn: 'bg-amber-500 hover:bg-amber-400 text-slate-950', icon: '⚠️' },
        danger: { border: 'border-rose-500/60', btn: 'bg-rose-600 hover:bg-rose-500 text-white', icon: '🚨' },
        info: { border: 'border-sky-500/50', btn: 'bg-sky-500 hover:bg-sky-400 text-slate-950', icon: '❓' }
      }[severity] || { border: 'border-amber-500/50', btn: 'bg-amber-500 text-slate-950', icon: '⚠️' };

      const dialogId = 'mazaj-confirm-' + Date.now();
      const modalEl = document.createElement('div');
      modalEl.id = dialogId;
      modalEl.className = 'fixed inset-0 z-[999999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('aria-labelledby', `${dialogId}-title`);
      modalEl.setAttribute('aria-describedby', `${dialogId}-desc`);
      modalEl.setAttribute('dir', 'rtl');

      modalEl.innerHTML = `
        <div class="bg-slate-900 border ${colors.border} rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100 flex flex-col gap-4 text-right transform transition-all animate-in fade-in zoom-in-95 duration-150">
          <div class="flex items-center gap-3">
            <span class="text-3xl">${colors.icon}</span>
            <h2 id="${dialogId}-title" class="text-base font-black text-slate-100">${title}</h2>
          </div>
          <div id="${dialogId}-desc" class="text-xs text-slate-300 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">${message}</div>
          ${requestId ? `<div class="text-[10px] font-mono text-slate-500 border-t border-slate-800 pt-2 flex justify-between"><span>معرف الطلب:</span><span class="text-amber-400">${requestId}</span></div>` : ''}
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button id="${dialogId}-btn-cancel" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 shadow-md transition-all cursor-pointer focus:ring-2 focus:ring-slate-400 focus:outline-none">
              ${cancelText}
            </button>
            <button id="${dialogId}-btn-confirm" class="px-5 py-2.5 ${colors.btn} font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer focus:ring-2 focus:ring-amber-300 focus:outline-none">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      container.appendChild(modalEl);
      openModal(modalEl, {
        onCancel: () => {
          closeModal(modalEl);
          modalEl.remove();
          resolve(false);
        }
      });

      const confirmBtn = modalEl.querySelector(`#${dialogId}-btn-confirm`);
      const cancelBtn = modalEl.querySelector(`#${dialogId}-btn-cancel`);

      confirmBtn.onclick = () => {
        closeModal(modalEl);
        modalEl.remove();
        resolve(true);
      };

      cancelBtn.onclick = () => {
        closeModal(modalEl);
        modalEl.remove();
        resolve(false);
      };
    });
  }

  /**
   * Accessible In-Page Prompt Modal (Promise-based)
   */
  function showInPagePrompt(message, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(null);

      const container = getOrCreateDialogContainer();
      if (!container) return resolve(null);

      const title = options.title || 'إدخال بيانات';
      const placeholder = options.placeholder || 'أدخل القيمة هنا...';
      const inputType = options.inputType || 'text';
      const confirmText = options.confirmText || 'تأكيد';
      const cancelText = options.cancelText || 'إلغاء';
      const isPassword = options.isPassword || inputType === 'password';

      const dialogId = 'mazaj-prompt-' + Date.now();
      const modalEl = document.createElement('div');
      modalEl.id = dialogId;
      modalEl.className = 'fixed inset-0 z-[999999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('aria-labelledby', `${dialogId}-title`);
      modalEl.setAttribute('aria-describedby', `${dialogId}-desc`);
      modalEl.setAttribute('dir', 'rtl');

      modalEl.innerHTML = `
        <div class="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100 flex flex-col gap-4 text-right transform transition-all animate-in fade-in zoom-in-95 duration-150">
          <div class="flex items-center gap-3">
            <span class="text-3xl">📝</span>
            <h2 id="${dialogId}-title" class="text-base font-black text-slate-100">${title}</h2>
          </div>
          <div id="${dialogId}-desc" class="text-xs text-slate-300 leading-relaxed">${message}</div>
          <div class="flex flex-col gap-1.5">
            <input
              id="${dialogId}-input"
              type="${isPassword ? 'password' : 'text'}"
              value="${defaultValue || ''}"
              placeholder="${placeholder}"
              class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:outline-none font-mono"
            />
            <span id="${dialogId}-error" class="text-[11px] text-rose-400 hidden"></span>
          </div>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button id="${dialogId}-btn-cancel" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 shadow-md transition-all cursor-pointer focus:ring-2 focus:ring-slate-400 focus:outline-none">
              ${cancelText}
            </button>
            <button id="${dialogId}-btn-confirm" class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer focus:ring-2 focus:ring-amber-300 focus:outline-none">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      container.appendChild(modalEl);
      openModal(modalEl, {
        onCancel: () => {
          closeModal(modalEl);
          modalEl.remove();
          resolve(null);
        }
      });

      const inputEl = modalEl.querySelector(`#${dialogId}-input`);
      const errorEl = modalEl.querySelector(`#${dialogId}-error`);
      const confirmBtn = modalEl.querySelector(`#${dialogId}-btn-confirm`);
      const cancelBtn = modalEl.querySelector(`#${dialogId}-btn-cancel`);

      setTimeout(() => inputEl.focus(), 100);

      const submit = () => {
        const val = inputEl.value;
        if (options.validate && typeof options.validate === 'function') {
          const err = options.validate(val);
          if (err) {
            errorEl.innerText = err;
            errorEl.classList.remove('hidden');
            inputEl.focus();
            return;
          }
        }
        closeModal(modalEl);
        modalEl.remove();
        resolve(val);
      };

      confirmBtn.onclick = submit;
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };

      cancelBtn.onclick = () => {
        closeModal(modalEl);
        modalEl.remove();
        resolve(null);
      };
    });
  }

  /**
   * Accessible API Error Dialog with Request ID and Debug Accordion
   */
  function showApiError(errorObjOrMsg, options = {}) {
    let msg = 'حدث خطأ غير متوقع أثناء معالجة الطلب.';
    let requestId = options.requestId || null;
    let technicalDetails = null;

    if (typeof errorObjOrMsg === 'string') {
      msg = errorObjOrMsg;
    } else if (errorObjOrMsg && typeof errorObjOrMsg === 'object') {
      msg = errorObjOrMsg.error || errorObjOrMsg.message || msg;
      requestId = errorObjOrMsg.requestId || errorObjOrMsg.request_id || requestId;
      if (errorObjOrMsg.details || errorObjOrMsg.stack) {
        technicalDetails = typeof errorObjOrMsg.details === 'object'
          ? JSON.stringify(errorObjOrMsg.details, null, 2)
          : (errorObjOrMsg.details || errorObjOrMsg.stack);
      }
    }

    if (!requestId) requestId = generateRequestId('ERR');

    return showInPageAlert(msg, {
      title: options.title || 'خطأ في معالجة الطلب',
      severity: 'error',
      confirmText: options.confirmText || 'حسناً، فهمت',
      requestId: requestId,
      technicalDetails: technicalDetails || options.technicalDetails
    });
  }

  /**
   * Accessible Transient Toast Notification
   */
  function showToast(message, type = 'info', options = {}) {
    if (typeof document === 'undefined') return;
    const duration = options.duration || 4000;
    let container = document.getElementById('mazaj-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mazaj-toast-container';
      container.className = 'fixed bottom-5 right-5 z-[999999] flex flex-col gap-2 pointer-events-none max-w-sm w-full';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('dir', 'rtl');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto px-4 py-3 rounded-xl border text-xs font-bold shadow-2xl flex items-center justify-between gap-3 transform transition-all duration-300 translate-y-[-10px] opacity-0 ${
      type === 'success' ? 'bg-emerald-950/95 text-emerald-300 border-emerald-500/50' :
      type === 'error' ? 'bg-rose-950/95 text-rose-300 border-rose-500/50' :
      type === 'warning' ? 'bg-amber-950/95 text-amber-300 border-amber-500/50' :
      'bg-slate-900/95 text-slate-200 border-slate-700'
    }`;

    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-base">${icon}</span>
        <span class="leading-snug">${message}</span>
      </div>
      ${options.requestId ? `<span class="text-[10px] font-mono text-slate-400 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800 mr-2 select-all">${options.requestId}</span>` : ''}
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-[-10px]', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-[-10px]');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Safe global bindings in browser environment
  if (typeof window !== 'undefined') {
    window.showInPageAlert = showInPageAlert;
    window.showInPageConfirm = showInPageConfirm;
    window.showInPagePrompt = showInPagePrompt;
    window.showToast = showToast;
    window.showApiError = showApiError;
  }

  return {
    STATES,
    I18N,
    setLanguage,
    getLanguage,
    generateRequestId,
    formatMoney,
    formatDateTime,
    render,
    guardButtonAction,
    openModal,
    closeModal,
    showToast,
    showInPageAlert,
    showInPageConfirm,
    showInPagePrompt,
    showApiError,
    alert: showInPageAlert,
    confirm: showInPageConfirm,
    prompt: showInPagePrompt,
    toast: showToast,
    apiError: showApiError
  };
});

