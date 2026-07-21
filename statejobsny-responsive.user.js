// ==UserScript==
// @name         StateJobsNY responsive/full-width layout
// @namespace    https://statejobsny.com/
// @version      3.6.4
// @description  Makes StateJobsNY public and employee pages use the full viewport with configurable page settings.
// @author       You
// @match        https://statejobsny.com/public/*
// @match        https://statejobsny.com/employees/*
// @match        https://statejobs.ny.gov/public/*
// @match        https://statejobs.ny.gov/employees/*
// @run-at       document-idle
// @grant        none
// @history      3.6.4 - UX: Reduced hover preview box size by 50%. Restored live console logging for salary loads. Enhanced deadline shading visibility.
// @history      3.6.3 - Fixed: Completely cleaned up duplicate code declarations that caused syntax and execution errors.
// @history      3.6.2 - Fixed: Restored the accidentally omitted wireTitleHoverPreview function.
// @history      3.6.1 - Fixed: Syntactical issue with duplicate loadRawPreviewHtml and loadPreviewContent declarations.
// @history      3.6.0 - Feature: Added dynamic rate-limit detection (429/50x), exponential backoff, and graceful concurrency downgrading to the async pool.
// @history      3.5.0 - Feature: Implemented Async Promise Pooling for parallel salary fetching with sequential fallback and live progress counter.
// @history      3.4.1 - Feature: Added mobile-optimized modal scaling. Fixed: UX for global deadline filter.
// @history      3.4.0 - Feature: Added global deadline filter. Fixed: UX for responsive toggle and compare tool cleanup.
// @history      3.3.6 - Feature: Slowed down Fun Mode animations for better visual comfort.
// @history      3.3.5 - Feature: Added math-based JS animation loop for Fun Mode patterns.
// @history      Previous - Initial responsive layout, compare tool, salary range estimation, and hover previews.
// ==/UserScript==

(function () {
  'use strict';

  // --- CONSTANTS ---
  const STYLE_ID = 'tm-statejobsny-responsive';
  const BASE_UI_STYLE_ID = 'tm-statejobsny-base-ui';
  const SETTINGS_KEY = 'tm-statejobsny-settings';
  const SETTINGS_ENTRY_ID = 'tm-statejobsny-settings-entry';
  const SETTINGS_MODAL_ID = 'tm-statejobsny-settings-modal';
  const MOBILE_NAV_TOGGLE_ID = 'tm-statejobsny-mobile-nav-toggle';
  const PREVIEW_BOX_ID = 'tm-statejobsny-link-preview';
  const COMPARE_OVERLAY_ID = 'tm-statejobsny-compare-overlay';
  const COMPARE_BUTTON_ID = 'tm-statejobsny-compare-button';
  const CLEAR_BUTTON_ID = 'tm-statejobsny-clear-button';
  const COMPARE_ERROR_ID = 'tm-statejobsny-compare-error';
  const JUST_FOR_FUN_BUTTON_ID = 'tm-statejobsny-just-for-fun';
  const SALARY_LOADING_TOAST_ID = 'tm-statejobsny-salary-loading-toast';
  const DEBUG_KEY = 'tm-statejobsny-debug';
  const STRIPE_PALETTE = ['#eee', '#ecdfff', '#ffe0f3', '#d8dcff', '#ddffce', '#fff6c1'];

  const DEFAULT_SETTINGS = {
    responsiveLayout: true,
    widenAgencyColumn: false,
    highlightDeadlineApproaching: false,
    deadlinePulse: false,
    tableFontFamily: '',
    tableFontSizePx: 12,
    stripeColor: '#eee',
    defaultEntriesPerPage: '100',
    previewHoverDelayMs: 220,
  };

  // --- UTILITIES & SETTINGS ---
  const parseDate = (text) => {
    const match = (text || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!match) return null;
    const year = 2000 + Number(match[3]);
    const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const isApproachingDate = (text) => {
    const dueDate = parseDate(text);
    if (!dueDate) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dueDate - now) / 86400000);
    return diffDays >= 0 && diffDays <= 3;
  };

  const loadSettings = () => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (_e) {
      return { ...DEFAULT_SETTINGS };
    }
  };

  let settings = loadSettings();
  let enabled = settings.responsiveLayout;
  let lengthObserver = null;
  let stripeObserver = null;
  let mobileNavCollapsed = false;
  let defaultLengthApplied = false;
  let previewPinnedPosition = null;
  let previewIsDragging = false;
  const previewCache = new Map();
  const previewRawCache = new Map();
  const compareCache = new Map();
  const selectedCompareUrls = new Set();
  let compareValidationMessage = '';
  let closeDeadlineFilterActive = new URLSearchParams(window.location.search).get('tmCloseDeadline') === '1';
  let vacancyRefreshScheduled = false;
  let funModeActive = false;
  let funModeFrame = null;
  let funModeCells = [];
  let deadlinePulseTimer = null;
  let salaryLazyBound = false;
  let salaryLazyTickScheduled = false;
  let salaryLazyLoading = false;
  let salaryLazyPoller = null;
  let salaryLoadPassDone = false;
  let salaryLoadPassPromise = null;
  const salaryRangeCache = new Map();
  const salaryLazyListeners = [];

  const isVacancyTablePage = () => Boolean(document.getElementById('vacancyTable'));
  const isSettingsModalOpen = () => {
    const modal = document.getElementById(SETTINGS_MODAL_ID);
    return Boolean(modal && window.getComputedStyle(modal).display !== 'none');
  };

  const isDebugEnabled = () => {
    try {
      return window.localStorage.getItem(DEBUG_KEY) === 'on';
    } catch (_e) {
      return false;
    }
  };

  const debugState = {
    lengthObserverMutations: 0,
    stripeObserverMutations: 0,
    vacancyRefreshRuns: 0,
    hoverPreviewLoads: 0,
    lastVacancyRefreshMs: 0,
    salaryLazySchedules: 0,
    salaryRowsConsidered: 0,
    salaryRowsLoaded: 0,
    salaryLastViewportRange: '',
    salaryLastRawText: '',
    salaryLastExtractedRange: '',
  };

  const logDebug = (...args) => {
    if (!isDebugEnabled()) return;
    console.debug('[tm-statejobsny-debug]', ...args);
  };

  const logDebugWarn = (...args) => {
    if (!isDebugEnabled()) return;
    console.warn('[tm-statejobsny-debug]', ...args);
  };

  window.__tmStateJobsDebug = {
    enable() {
      try { window.localStorage.setItem(DEBUG_KEY, 'on'); } catch (_e) {}
      console.info('[tm-statejobsny] debug enabled; reload page to capture startup logs');
    },
    disable() {
      try { window.localStorage.setItem(DEBUG_KEY, 'off'); } catch (_e) {}
      console.info('[tm-statejobsny] debug disabled');
    },
    status() {
      return {
        enabled: isDebugEnabled(),
        settings,
        debugState: { ...debugState },
      };
    },
    dump() {
      console.table({ ...debugState });
      return { ...debugState };
    },
  };

  const saveSettings = () => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_e) {}
  };

  const updateSetting = (key, value) => {
    settings[key] = value;
    enabled = settings.responsiveLayout;
    saveSettings();
    defaultLengthApplied = false;
    applyState();
  };

  // --- DOM STYLING ---
  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (style) return style;

    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html, body { width:100% !important; max-width:none !important; overflow-x:hidden !important; }
      #leftShadow, #rightShadow, #bottomShadowLeft, #bottomShadowRight, #bottomInnerShadow {
        width:100vw !important; max-width:100vw !important; min-width:0 !important; margin:0 !important;
        overflow-x:clip !important; background-image:none !important;
      }
      #mainContent {
        width:100% !important; max-width:none !important; margin:0 !important; box-sizing:border-box !important;
        padding:0 clamp(12px, 2vw, 28px) 16px !important; display:grid !important;
        grid-template-columns:minmax(220px, 300px) minmax(0, 1fr) !important;
        grid-template-areas:"header header" "nav content" "organ organ" "footer footer" !important;
        column-gap:clamp(16px, 2vw, 32px) !important; align-items:start !important;
      }
      #header { grid-area:header; width:100% !important; max-width:none !important; box-sizing:border-box !important; }
      #nav { grid-area:nav; float:none !important; width:auto !important; max-width:none !important; margin:0 !important; box-sizing:border-box !important; }
      #content { grid-area:content; float:none !important; width:auto !important; max-width:none !important; margin:0 !important; min-width:0 !important; box-sizing:border-box !important; overflow-wrap:anywhere !important; }
      #organDonor { grid-area:organ; width:100% !important; max-width:none !important; box-sizing:border-box !important; }
      #footer { grid-area:footer; width:100% !important; max-width:none !important; box-sizing:border-box !important; }
      img, video, iframe, table, select, input, textarea { max-width:100% !important; box-sizing:border-box !important; }
      #vacancyTable_wrapper, #vacancyTable_wrapper .dt-layout-cell { width:100% !important; max-width:none !important; min-width:0 !important; box-sizing:border-box !important; }
      #vacancyTable_wrapper .dt-layout-table { overflow-x:hidden !important; display:flex !important; justify-content:center !important; }
      #vacancyTable { width:100% !important; max-width:100% !important; margin:0 !important; table-layout:auto !important; }
      #vacancyTable th, #vacancyTable td { white-space:normal !important; overflow-wrap:anywhere !important; vertical-align:middle !important; }
      #vacancyTable tbody td { padding:1px 3px !important; }
      #vacancyTable.tm-font-custom th, #vacancyTable.tm-font-custom td { font-family: var(--tm-table-font-family, inherit) !important; }
      #vacancyTable.tm-font-custom-size th, #vacancyTable.tm-font-custom-size td { font-size: var(--tm-table-font-size, 12px) !important; }

      /* Base table stripes - disabled during fun mode so animations can run! */
      body:not(.tm-fun-mode) #vacancyTable tbody tr.odd td { background-color: var(--tm-stripe-odd, #eee) !important; }
      body:not(.tm-fun-mode) #vacancyTable tbody tr.even td { background-color: var(--tm-stripe-even, #fff) !important; }

      #vacancyTable .tm-compare-cell, #vacancyTable .tm-compare-header { width:1% !important; text-align:center !important; white-space:nowrap !important; }
      #vacancyTable th:nth-child(2), #vacancyTable td:nth-child(2),
      #vacancyTable th:nth-child(4), #vacancyTable td:nth-child(4),
      #vacancyTable th:nth-child(5), #vacancyTable td:nth-child(5),
      #vacancyTable th:nth-child(6), #vacancyTable td:nth-child(6),
      #vacancyTable th:nth-child(8), #vacancyTable td:nth-child(8) { width: 1% !important; white-space: nowrap !important; text-align: center !important; }
      #vacancyTable th:nth-child(3), #vacancyTable td:nth-child(3) { min-width: clamp(220px, 32vw, 620px) !important; }
      #vacancyTable.tm-agency-wide th:nth-child(7), #vacancyTable.tm-agency-wide td:nth-child(7) { min-width:clamp(110px, 12vw, 170px) !important; }
      #vacancyTable.tm-agency-wide th:nth-child(3), #vacancyTable.tm-agency-wide td:nth-child(3) { min-width:clamp(240px, 30vw, 520px) !important; }
      #vacancyTable_wrapper .dt-paging.paging_full_numbers { display:flex !important; flex-wrap:nowrap !important; align-items:center !important; justify-content:center !important; gap:4px !important; width:100% !important; }
      #vacancyTable_wrapper .dt-paging.paging_full_numbers button, #vacancyTable_wrapper .dt-paging.paging_full_numbers span { display:inline-flex !important; align-items:center !important; }
      #tm-statejobsny-mobile-nav-toggle { grid-area:nav; display:inline-flex !important; align-items:center !important; justify-content:flex-start !important; gap:6px !important; width:100% !important; max-width:220px !important; margin:8px 0 !important; padding:6px 10px !important; border:1px solid #b0b0b0 !important; border-radius:4px !important; background:#eee !important; cursor:pointer !important; font-size:13px !important; z-index:2; }
      #mainContent.tm-nav-collapsed { grid-template-columns:44px minmax(0, 1fr) !important; column-gap:10px !important; }
      #mainContent.tm-nav-collapsed #nav { display:block !important; width:0 !important; min-width:0 !important; max-width:0 !important; overflow:hidden !important; margin:0 !important; padding:0 !important; border:0 !important; }

      @media (max-width: 980px) {
        #mainContent { grid-template-columns:minmax(0, 1fr) !important; grid-template-areas:"header" "nav" "content" "organ" "footer" !important; row-gap:12px !important; }
        #mainContent.tm-nav-collapsed { grid-template-columns:minmax(0, 1fr) !important; column-gap:0 !important; }
        #mainContent.tm-nav-collapsed #content { width:100% !important; margin-left:0 !important; }
        #tm-statejobsny-mobile-nav-toggle { max-width:100% !important; margin-bottom:2px !important; }
        #nav, #content { width:100% !important; }
      }
    `;
    document.head.appendChild(style);
    return style;
  };

  const ensureBaseUiStyle = () => {
    let style = document.getElementById(BASE_UI_STYLE_ID);
    if (style) return style;

    style = document.createElement('style');
    style.id = BASE_UI_STYLE_ID;
    style.textContent = `
      #${SETTINGS_MODAL_ID}, #${COMPARE_OVERLAY_ID}, #${PREVIEW_BOX_ID} { position:fixed !important; z-index:10000 !important; background:#fff !important; border:1px solid #7a7a7a !important; box-shadow:0 6px 18px rgba(0,0,0,0.25) !important; }
      #${SETTINGS_MODAL_ID} { width:min(540px, calc(100vw - 24px)) !important; top:50% !important; left:50% !important; transform:translate(-50%, -50%) !important; display:none; }
      #${SETTINGS_MODAL_ID} .tm-settings-header, #${COMPARE_OVERLAY_ID} .tm-compare-header, #${PREVIEW_BOX_ID} .tm-preview-header { background:#e9e9e9 !important; border-bottom:1px solid #b8b8b8 !important; padding:8px 10px !important; font-weight:700 !important; display:flex !important; align-items:center !important; justify-content:space-between !important; }
      #${SETTINGS_MODAL_ID} .tm-settings-body { padding:10px !important; display:grid !important; gap:10px !important; max-height:70vh !important; overflow:auto !important; }
      #${SETTINGS_MODAL_ID} .tm-settings-row { display:flex !important; flex-wrap:wrap !important; gap:8px !important; align-items:center !important; }
      #${SETTINGS_MODAL_ID} .tm-settings-note { font-size:12px !important; color:#555 !important; margin-left:24px !important; }
      .tm-close-btn { border:1px solid #888 !important; background:#fff !important; border-radius:3px !important; padding:1px 8px !important; cursor:pointer !important; font-size:12px !important; }
      #${COMPARE_OVERLAY_ID} { display:none; width:min(980px, calc(100vw - 20px)); max-height:80vh; top:50%; left:50%; transform:translate(-50%, -50%); overflow:hidden; }
      #${COMPARE_OVERLAY_ID} .tm-compare-body { overflow:auto; max-height:calc(80vh - 48px); padding:8px; }
      #${COMPARE_OVERLAY_ID} .tm-compare-controls { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
      #${COMPARE_OVERLAY_ID} table { width:100%; border-collapse:collapse; }
      #${COMPARE_OVERLAY_ID} th, #${COMPARE_OVERLAY_ID} td { border:1px solid #ddd; padding:6px; vertical-align:top; text-align:left; }
      #${COMPARE_OVERLAY_ID} td.tm-compare-diff { background:#fff7cc; }
      #${COMPARE_BUTTON_ID}, #${CLEAR_BUTTON_ID} { margin-left:10px; }
      #${COMPARE_ERROR_ID} { color:#b00020; font-size:12px; margin-top:6px; }

      /* Reduced Preview Box Size */
      #${PREVIEW_BOX_ID} { display:none; width:min(1000px, calc(100vw - 24px)); max-height:55vh; overflow:auto; padding:10px; font-size:12px; line-height:1.3; }
      #${PREVIEW_BOX_ID} .tm-preview-header { margin:-10px -10px 10px; border:1px solid #b8b8b8; cursor:move; user-select:none; }
      #${PREVIEW_BOX_ID} .tm-preview-tab-title { margin:10px 0 6px; font-weight:700; border-bottom:1px solid #d0d0d0; padding-bottom:2px; }
      #${PREVIEW_BOX_ID} .tm-preview-section-title { margin:8px 0 4px; font-weight:700; color:#011a77; }
      #${PREVIEW_BOX_ID} .tm-preview-section-content { margin:0 0 8px; }

      .tm-close-deadline-row-hidden { display:none !important; }
      #tm-close-deadline-link { display:inline-block; margin-top:4px; }

      /* Enhanced Deadline Shading */
      .tm-urgent-deadline { background-color: #ffe6e6 !important; color:#8b0000 !important; font-weight:700 !important; }
      #vacancyTable td.tm-deadline-pulse { font-weight:700 !important; }

      #${SALARY_LOADING_TOAST_ID} {
        position: fixed !important; top: 10px !important; left: 50% !important; transform: translateX(-50%) !important;
        z-index: 10050 !important; background: #1f2937 !important; color: #fff !important; border-radius: 999px !important;
        padding: 8px 14px !important; font-size: 13px !important; display: inline-flex !important; align-items: center !important;
        gap: 8px !important; box-shadow: 0 4px 10px rgba(0,0,0,0.25) !important; transition: color 0.3s ease;
      }
      #${SALARY_LOADING_TOAST_ID} .tm-spinner { width: 14px !important; height: 14px !important; border: 2px solid rgba(255,255,255,0.35) !important; border-top-color: currentColor !important; border-radius: 50% !important; animation: tm-spin 0.7s linear infinite !important; }
      #tm-salary-loaded { font-weight: 700; color: #a0c4ff; }
      @keyframes tm-spin { to { transform: rotate(360deg); } }

      body:not(.tm-responsive-enabled) .tm-compare-header, body:not(.tm-responsive-enabled) .tm-compare-cell,
      body:not(.tm-responsive-enabled) #${COMPARE_BUTTON_ID}, body:not(.tm-responsive-enabled) #${CLEAR_BUTTON_ID},
      body:not(.tm-responsive-enabled) #${COMPARE_ERROR_ID} { display: none !important; }

      @media (max-width: 980px) {
        #${SETTINGS_MODAL_ID} { width: 85vw !important; height: 85vh !important; max-width: none !important; max-height: none !important; margin: auto; }
        #${SETTINGS_MODAL_ID} .tm-settings-body { max-height: calc(85vh - 50px) !important; padding: 15px !important; }
        #${SETTINGS_MODAL_ID} .tm-settings-row { font-size: 16px !important; white-space: normal !important; word-wrap: break-word !important; }
        #${SETTINGS_MODAL_ID} .tm-settings-note { font-size: 14px !important; white-space: normal !important; word-wrap: break-word !important; margin-left: 0 !important; margin-bottom: 10px !important; }
        #${SETTINGS_MODAL_ID} input[type="text"], #${SETTINGS_MODAL_ID} input[type="number"], #${SETTINGS_MODAL_ID} select { font-size: 16px !important; padding: 6px !important; max-width: 100% !important; }
      }
    `;
    document.head.appendChild(style);
    return style;
  };

  const removeStyle = () => {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  };

  // --- DATA TABLES & ROWS ---
  const getColumnIndexByHeader = (label) => {
    const headers = Array.from(document.querySelectorAll('#vacancyTable thead th'));
    const idx = headers.findIndex((th) => th.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === label.toLowerCase());
    return idx >= 0 ? idx + 1 : null;
  };
  const getDeadlineColumnIndex = () => getColumnIndexByHeader('Deadline');

  const ensureLengthOptions = () => {
    const lengthSelect = document.querySelector('select[name="vacancyTable_length"], #vacancyTable_wrapper .dt-length select');
    if (!lengthSelect) return null;
    [ { value: '250', text: '250' }, { value: '500', text: '500' }, { value: '9999', text: 'All' } ].forEach((item) => {
      if (!Array.from(lengthSelect.options).some((o) => o.value === item.value)) lengthSelect.add(new Option(item.text, item.value));
    });
    return lengthSelect;
  };

  const removeCustomLengthOptions = () => {
    const lengthSelect = document.querySelector('select[name="vacancyTable_length"], #vacancyTable_wrapper .dt-length select');
    if (!lengthSelect) return;
    let changed = false;
    Array.from(lengthSelect.options).forEach(opt => {
      if (['250', '500', '9999'].includes(opt.value)) { opt.remove(); changed = true; }
    });
    if (changed && (!lengthSelect.value || ['250', '500', '9999'].includes(lengthSelect.value))) {
      lengthSelect.value = lengthSelect.querySelector('option[value="100"]') ? '100' : lengthSelect.options[0].value;
      lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const applyDefaultEntriesPerPage = () => {
    if (!enabled || defaultLengthApplied || !isVacancyTablePage()) return true;
    const lengthSelect = ensureLengthOptions();
    if (!lengthSelect) return false;
    const desired = settings.defaultEntriesPerPage || '100';
    const has = Array.from(lengthSelect.options).some((o) => o.value === desired);
    const valueToSet = has ? desired : '100';
    if (lengthSelect.value !== valueToSet) {
      lengthSelect.value = valueToSet;
      lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    defaultLengthApplied = true;
    return true;
  };

  const retrySetLength = () => {
    if (!enabled || !isVacancyTablePage()) return;
    applyDefaultEntriesPerPage();
  };

  const startLengthObserver = () => {
    if (lengthObserver) lengthObserver.disconnect();
    if (!enabled || !isVacancyTablePage()) return;
    lengthObserver = new MutationObserver(() => {
      if (!enabled || !isVacancyTablePage()) return;
      ensureLengthOptions();
      if (applyDefaultEntriesPerPage()) stopLengthObserver();
    });
    const wrapper = document.getElementById('vacancyTable_wrapper') || document.body;
    lengthObserver.observe(wrapper, { childList: true, subtree: true });
  };

  const stopLengthObserver = () => {
    if (lengthObserver) { lengthObserver.disconnect(); lengthObserver = null; }
  };

  const normalizeVacancyRowStriping = () => {
    if (!enabled) return;
    const rows = document.querySelectorAll('#vacancyTable tbody tr');
    rows.forEach((row, index) => {
      row.classList.remove('odd', 'even');
      row.classList.add(index % 2 === 0 ? 'odd' : 'even');
    });
    applyStripeColor();
  };

  const applyTableTypography = () => {
    const table = document.getElementById('vacancyTable');
    if (!table) return;
    const font = (settings.tableFontFamily || '').trim();
    const size = Math.max(10, Math.min(24, Number(settings.tableFontSizePx) || 12));
    table.classList.toggle('tm-font-custom', Boolean(font));
    table.classList.toggle('tm-font-custom-size', true);
    table.style.setProperty('--tm-table-font-family', font || 'inherit');
    table.style.setProperty('--tm-table-font-size', `${size}px`);
    applyGradeSalaryFontSize();
  };

  const applyStripeColor = () => {
    const table = document.getElementById('vacancyTable');
    if (!table) return;
    const odd = STRIPE_PALETTE.includes(settings.stripeColor) ? settings.stripeColor : '#eee';
    table.style.setProperty('--tm-stripe-odd', odd);
    table.style.setProperty('--tm-stripe-even', '#fff');
  };

  const applyAgencyColumnMode = () => {
    const table = document.getElementById('vacancyTable');
    if (!table) return;
    table.classList.toggle('tm-agency-wide', Boolean(settings.widenAgencyColumn));
  };

  const ensureGradeAscendingSort = () => {
    if (!enabled || !isVacancyTablePage()) return;
    const gradeHeader = Array.from(document.querySelectorAll('#vacancyTable thead th')).find((th) => /grade/i.test(th.textContent || ''));
    if (!gradeHeader) return;
    if (gradeHeader.getAttribute('aria-sort') === 'ascending') return;
    gradeHeader.click();
  };

  // --- DEADLINES & TIMERS ---
  const stopDeadlinePulseTimer = () => {
    if (deadlinePulseTimer) { window.clearInterval(deadlinePulseTimer); deadlinePulseTimer = null; }
  };

  const tickDeadlinePulse = () => {
    const now = Date.now();
    const active = Math.floor(now / 650) % 2 === 0;
    document.querySelectorAll('#vacancyTable td.tm-deadline-pulse').forEach((cell) => {
      const baseColor = cell.dataset.tmPulseBaseColor || window.getComputedStyle(cell).backgroundColor || 'transparent';
      if (active) {
        cell.style.setProperty('background-color', '#8b0000', 'important');
        cell.style.setProperty('color', '#fff', 'important');
      } else {
        cell.style.setProperty('background-color', baseColor, 'important');
        cell.style.setProperty('color', '#8b0000', 'important');
      }
    });
  };

  const ensureDeadlinePulseTimer = () => {
    stopDeadlinePulseTimer();
    if (funModeActive || !settings.deadlinePulse || !enabled || !isVacancyTablePage()) return;
    tickDeadlinePulse();
    deadlinePulseTimer = window.setInterval(tickDeadlinePulse, 650);
  };

  const applyDeadlineStyling = () => {
    if (!enabled) return;
    const deadlineIdx = getDeadlineColumnIndex();
    if (!funModeActive && deadlineIdx) {
      document.querySelectorAll(`#vacancyTable tbody tr td:nth-child(${deadlineIdx})`).forEach((cell) => {
        const apply = settings.highlightDeadlineApproaching && isApproachingDate(cell.textContent);
        cell.classList.toggle('tm-urgent-deadline', apply);
        const dueDate = parseDate(cell.textContent);
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const isToday = dueDate && dueDate.getTime() === now.getTime();
        if (settings.deadlinePulse && isToday) {
          cell.dataset.tmPulseBaseColor = window.getComputedStyle(cell).backgroundColor || 'transparent';
          cell.classList.add('tm-deadline-pulse');
        } else {
          cell.classList.remove('tm-deadline-pulse');
          delete cell.dataset.tmPulseBaseColor;
          cell.style.removeProperty('background-color');
          cell.style.removeProperty('color');
        }
      });
    }
    const row = Array.from(document.querySelectorAll('#content p.row')).find((p) => {
      const left = p.querySelector('.leftCol');
      return left && /Applications Due/i.test(left.textContent || '');
    });
    if (row) {
      const right = row.querySelector('.rightCol');
      if (right) right.classList.toggle('tm-urgent-deadline', settings.highlightDeadlineApproaching && isApproachingDate(right.textContent));
    }
    applyCloseDeadlineFilter();
    updateCloseDeadlineLink();
    ensureDeadlinePulseTimer();
  };

  const updateCloseDeadlineLink = () => {
    const link = document.getElementById('tm-close-deadline-link');
    if (!link) return;
    link.textContent = closeDeadlineFilterActive ? 'All Postings' : 'Close to Deadline Postings';
    link.setAttribute('aria-pressed', String(closeDeadlineFilterActive));
  };

  const applyCloseDeadlineFilter = () => {
    if (!isVacancyTablePage()) return;
    const deadlineIdx = getDeadlineColumnIndex();
    if (!deadlineIdx) return;
    document.querySelectorAll('#vacancyTable tbody tr').forEach((row) => {
      const cell = row.children[deadlineIdx - 1];
      const isClose = cell ? isApproachingDate(cell.textContent) : false;
      row.classList.toggle('tm-close-deadline-row-hidden', closeDeadlineFilterActive && !isClose);
    });
  };

  const ensureCloseDeadlineLink = () => {
    if (!isVacancyTablePage() || document.getElementById('tm-close-deadline-link')) return;
    const yesterdayLink = Array.from(document.querySelectorAll('#content a')).find((anchor) => /Yesterday's Postings/i.test(anchor.textContent || ''));
    if (!yesterdayLink || !yesterdayLink.parentElement) return;

    const link = document.createElement('a');
    link.id = 'tm-close-deadline-link';
    if (closeDeadlineFilterActive) {
      link.textContent = 'All Postings';
      const url = new URL(window.location.href);
      url.searchParams.delete('tmCloseDeadline');
      link.href = url.pathname + url.search;
    } else {
      link.textContent = 'Close to Deadline Postings';
      link.href = window.location.pathname + '?searchResults=yes&tmCloseDeadline=1';
    }
    link.setAttribute('aria-pressed', String(closeDeadlineFilterActive));
    yesterdayLink.parentElement.appendChild(document.createElement('br'));
    yesterdayLink.parentElement.appendChild(link);
  };

  // --- SALARY FETCHING & POOLING ---
  const formatSalaryK = (value) => `$${Math.max(0, Math.round(value / 1000))}k`;
  const parseMoneyTextToNumber = (valueText) => {
    const parsed = Number(String(valueText || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const shouldThrottleSalaryLoad = () => {
    const lengthSelect = document.querySelector('select[name="vacancyTable_length"], #vacancyTable_wrapper .dt-length select');
    if (!lengthSelect) return false;
    const selectedValue = Number(lengthSelect.value);
    return Number.isFinite(selectedValue) && selectedValue > 100;
  };

  const extractSalaryRangeFromHtml = (htmlText) => {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const basicsPanel = doc.querySelector('#information');
    if (!basicsPanel) return '';
    const salaryRow = Array.from(basicsPanel.querySelectorAll('p.row')).find((row) => {
      const left = row.querySelector('.leftCol');
      return left && /^salary range$/i.test(left.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, ''));
    });
    if (!salaryRow) return '';
    const salaryRight = salaryRow.querySelector('.rightCol');
    if (!salaryRight) return '';
    const salaryText = salaryRight.textContent.replace(/\s+/g, ' ').trim();
    debugState.salaryLastRawText = salaryText;
    const match = salaryText.match(/From\s*\$?\s*([\d,]+(?:\.\d+)?)\s*to\s*\$?\s*([\d,]+(?:\.\d+)?)\s*Annually/i);
    if (!match) return '';
    const from = parseMoneyTextToNumber(match[1]);
    const to = parseMoneyTextToNumber(match[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
      const range = `${formatSalaryK(from)}-${formatSalaryK(to)}`;
      debugState.salaryLastExtractedRange = range;
      return range;
    }
    return '';
  };

  const applyGradeSalaryFontSize = () => {
    const px = Math.max(8, (Math.max(10, Math.min(24, Number(settings.tableFontSizePx) || 12)) - 2));
    document.querySelectorAll('.tm-grade-salary-range').forEach((el) => { el.style.fontSize = `${px}px`; });
  };

  const showSalaryLoadingToast = (totalRows) => {
    let toast = document.getElementById(SALARY_LOADING_TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = SALARY_LOADING_TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="tm-spinner"></span><span><span id="tm-salary-status">Loading salaries...</span> (<span id="tm-salary-loaded">0</span> of <span id="tm-salary-total">${totalRows}</span>)</span>`;
    toast.style.color = '#fff';
  };

  const updateSalaryToastProgress = (loaded, total, statusMsg = null) => {
    const loadedEl = document.getElementById('tm-salary-loaded');
    const totalEl = document.getElementById('tm-salary-total');
    const statusEl = document.getElementById('tm-salary-status');
    const toast = document.getElementById(SALARY_LOADING_TOAST_ID);
    if (loadedEl) loadedEl.textContent = String(loaded);
    if (totalEl) totalEl.textContent = String(total);
    if (statusEl && toast) {
      if (statusMsg) {
        statusEl.textContent = statusMsg;
        toast.style.color = '#ffb3ba';
      } else {
        statusEl.textContent = 'Loading salaries...';
        toast.style.color = '#fff';
      }
    }
  };

  const hideSalaryLoadingToast = () => {
    const toast = document.getElementById(SALARY_LOADING_TOAST_ID);
    if (toast) toast.remove();
  };

  const resetSalaryLoadState = () => {
    salaryLoadPassDone = false;
    salaryLoadPassPromise = null;
  };

  const processSingleSalaryRow = async (url, gradeCell) => {
    let range = salaryRangeCache.get(url);
    if (typeof range === 'undefined') {
      const html = await loadRawPreviewHtml(url);
      range = extractSalaryRangeFromHtml(html);
      salaryRangeCache.set(url, range || '');
    }
    if (range) {
      const span = document.createElement('span');
      span.className = 'tm-grade-salary-range';
      span.style.display = 'block';
      span.style.lineHeight = '1.2';
      span.textContent = range;
      gradeCell.appendChild(span);
      gradeCell.dataset.tmSalaryBound = '1';
      debugState.salaryRowsLoaded += 1;
      console.log(`[StateJobsNY] Fetched salary: ${range} for URL: ${url}`);
    } else {
      console.log(`[StateJobsNY] Salary parsing missed or unavailable for URL: ${url}`);
    }
  };

  const augmentGradeColumnWithSalaryConcurrent = async (rowsToProcess, initialThrottle) => {
    let concurrencyLimit = initialThrottle ? 2 : 5;
    let baseDelayMs = initialThrottle ? 100 : 0;
    let loadedCount = 0;
    const total = rowsToProcess.length;
    const executing = new Set();
    let globalBackoffPromise = null;

    for (const { url, gradeCell } of rowsToProcess) {
      if (globalBackoffPromise) await globalBackoffPromise;
      const promise = (async () => {
        let success = false;
        let retries = 0;
        while (!success && retries < 3) {
          try {
            if (globalBackoffPromise) await globalBackoffPromise;
            await processSingleSalaryRow(url, gradeCell);
            success = true;
            loadedCount++;
            updateSalaryToastProgress(loadedCount, total);
          } catch (err) {
            retries++;
            console.warn(`[StateJobsNY] Throttled or network error on ${url}. Retrying (${retries}/3)...`, err);
            concurrencyLimit = Math.max(1, concurrencyLimit - 1);
            baseDelayMs = Math.min(1500, baseDelayMs + 300);
            updateSalaryToastProgress(loadedCount, total, "Throttled - Slowing down...");
            if (!globalBackoffPromise) {
               globalBackoffPromise = wait(2000 * retries).then(() => {
                   globalBackoffPromise = null;
                   updateSalaryToastProgress(loadedCount, total);
               });
            }
            await globalBackoffPromise;
          }
        }
        if (!success) {
          loadedCount++;
          updateSalaryToastProgress(loadedCount, total);
        }
      })();

      executing.add(promise);
      promise.then(() => executing.delete(promise));
      if (executing.size >= concurrencyLimit) await Promise.race(executing);
      if (baseDelayMs > 0) await wait(baseDelayMs);
    }
    await Promise.all(executing);
  };

  const augmentGradeColumnWithSalarySequential = async (rowsToProcess, throttleLoads) => {
    let loadedCount = 0;
    const total = rowsToProcess.length;
    let delayMs = throttleLoads ? 250 : 50;

    for (const { url, gradeCell } of rowsToProcess) {
      let success = false;
      let retries = 0;
      while (!success && retries < 3) {
        try {
          await processSingleSalaryRow(url, gradeCell);
          success = true;
        } catch (err) {
          retries++;
          delayMs += 500;
          updateSalaryToastProgress(loadedCount, total, "Throttled (Seq) - Pausing...");
          await wait(3000 * retries);
          updateSalaryToastProgress(loadedCount, total);
        }
      }
      loadedCount++;
      updateSalaryToastProgress(loadedCount, total);
      if (delayMs > 0) await wait(delayMs);
    }
  };

  const augmentGradeColumnWithSalary = async () => {
    if (!enabled || !isVacancyTablePage() || funModeActive || salaryLazyLoading) return;
    const gradeIdx = getColumnIndexByHeader('Grade');
    if (!gradeIdx) return;

    const rows = Array.from(document.querySelectorAll('#vacancyTable tbody tr'));
    const rowsToProcess = [];
    for (const row of rows) {
      const titleLink = row.querySelector('td a[href*="vacancyDetailsView.cfm"]');
      const gradeCell = row.children[gradeIdx - 1];
      if (titleLink && gradeCell && gradeCell.dataset.tmSalaryBound !== '1') {
        rowsToProcess.push({ url: titleLink.href, gradeCell });
      }
    }

    if (rowsToProcess.length === 0) {
      salaryLoadPassDone = true;
      return;
    }

    salaryLazyLoading = true;
    showSalaryLoadingToast(rowsToProcess.length);

    try {
      const throttleLoads = shouldThrottleSalaryLoad();
      debugState.salaryLastViewportRange = `0-${Math.max(0, rowsToProcess.length - 1)}`;
      debugState.salaryRowsConsidered += rows.length;

      try {
        await augmentGradeColumnWithSalaryConcurrent(rowsToProcess, throttleLoads);
      } catch (concurrentError) {
        console.warn('[StateJobsNY] Concurrent salary fetch failed. Falling back to sequential.', concurrentError);
        await augmentGradeColumnWithSalarySequential(rowsToProcess, throttleLoads);
      }

      salaryLoadPassDone = true;
      applyGradeSalaryFontSize();
    } finally {
      salaryLazyLoading = false;
      hideSalaryLoadingToast();
    }
  };

  const scheduleLazySalaryLoad = () => {
    if (salaryLazyTickScheduled) return;
    salaryLazyTickScheduled = true;
    window.requestAnimationFrame(() => {
      salaryLazyTickScheduled = false;
      debugState.salaryLazySchedules += 1;

      // Detailed, visible logging of the scheduler
      console.info(`[StateJobsNY] Lazy salary load scheduled (Trigger #${debugState.salaryLazySchedules}). Polling table state...`);

      if (!salaryLoadPassDone) {
        if (!salaryLoadPassPromise) {
          console.info(`[StateJobsNY] Initiating new salary batch processing cycle...`);
          salaryLoadPassPromise = augmentGradeColumnWithSalary().finally(() => {
            console.info(`[StateJobsNY] Salary batch processing cycle completed.`);
            salaryLoadPassPromise = null;
          });
        }
      }
    });
  };

  const bindLazySalaryLoader = () => {
    if (salaryLazyBound) return;
    salaryLazyBound = true;
    const bind = (target, eventName) => {
      if (!target) return;
      target.addEventListener(eventName, scheduleLazySalaryLoad, { passive: true });
      salaryLazyListeners.push({ target, eventName });
    };
    bind(window, 'scroll'); bind(window, 'resize'); bind(document, 'scroll');
    bind(document.getElementById('content'), 'scroll');
    bind(document.querySelector('#vacancyTable_wrapper .dt-layout-table'), 'scroll');
  };

  const startLazySalaryPoller = () => {
    if (salaryLazyPoller) return;
    salaryLazyPoller = window.setInterval(() => {
      if (!enabled || !isVacancyTablePage() || funModeActive) return;
      scheduleLazySalaryLoad();
    }, 900);
  };

  const stopLazySalaryPoller = () => {
    if (!salaryLazyPoller) return;
    window.clearInterval(salaryLazyPoller);
    salaryLazyPoller = null;
  };

  // --- PREVIEWS ---
  const loadRawPreviewHtml = async (url) => {
    if (previewRawCache.has(url)) return previewRawCache.get(url);
    const response = await fetch(url, { credentials: 'include' });
    if (response.status === 429 || response.status === 503 || response.status === 504) {
      throw new Error(`Throttled:${response.status}`);
    }
    if (!response.ok) return '';
    const html = await response.text();
    previewRawCache.set(url, html);
    return html;
  };

  const loadPreviewContent = async (url) => {
    if (previewCache.has(url)) return previewCache.get(url);
    try {
        const html = await loadRawPreviewHtml(url);
        if (!html) return '<em>Preview could not be loaded.</em>';
        const extracted = extractPreviewHtml(html);
        previewCache.set(url, extracted);
        return extracted;
    } catch (_e) {
        return '<em>Preview temporarily unavailable (Server Throttled).</em>';
    }
  };

  const extractSectionBlocks = (section, fallbackText) => {
    if (!section) return `<em>${fallbackText}</em>`;
    const blocks = [];
    section.querySelectorAll('p.row').forEach((row) => {
      const left = row.querySelector('.leftCol');
      const right = row.querySelector('.rightCol');
      if (!left || !right) return;
      const leftClone = left.cloneNode(true);
      leftClone.querySelectorAll('.help, .colorTipContainer, .colorTip').forEach((n) => n.remove());
      const label = leftClone.textContent.replace(/\s+/g, ' ').trim();
      const content = right.innerHTML.trim();
      if (!label || !content) return;
      blocks.push(`<div class="tm-preview-section-title">${label}</div><div class="tm-preview-section-content">${content}</div>`);
    });
    if (!blocks.length) return `<em>${fallbackText}</em>`;
    return blocks.join('');
  };

  const extractPreviewHtml = (htmlText) => {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const jobSpecifics = extractSectionBlocks(doc.querySelector('#jobspecifics'), 'Job Specifics preview unavailable.');
    const basics = extractSectionBlocks(doc.querySelector('#information'), 'Basics preview unavailable.');
    return `<div class="tm-preview-tab-title">Job Specifics</div>${jobSpecifics}<div class="tm-preview-tab-title">Basics</div>${basics}`;
  };

  const ensurePreviewBox = () => {
    let box = document.getElementById(PREVIEW_BOX_ID);
    if (box) return box;
    box = document.createElement('div');
    box.id = PREVIEW_BOX_ID;
    box.innerHTML = `<div class="tm-preview-header"><span>Job Specifics Preview</span><button type="button" class="tm-close-btn tm-preview-close">X</button></div><div class="tm-preview-body"></div>`;
    box.style.display = 'none';
    document.body.appendChild(box);

    const close = box.querySelector('.tm-preview-close');
    const header = box.querySelector('.tm-preview-header');
    close.addEventListener('click', () => hidePreviewBox());

    let dragOffsetX = 0, dragOffsetY = 0;
    const onMove = (event) => {
      if (!previewIsDragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, event.clientX - dragOffsetX));
      const top = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, event.clientY - dragOffsetY));
      box.style.left = `${left}px`; box.style.top = `${top}px`;
      previewPinnedPosition = { left, top };
    };
    const onUp = () => { previewIsDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    header.addEventListener('mousedown', (event) => {
      if (event.target === close) return;
      previewIsDragging = true;
      const rect = box.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left; dragOffsetY = event.clientY - rect.top;
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });

    document.addEventListener('mousedown', (event) => {
      if (box.style.display !== 'none' && !box.contains(event.target)) hidePreviewBox();
    });
    return box;
  };

  const hidePreviewBox = () => {
    const box = document.getElementById(PREVIEW_BOX_ID);
    if (!box) return;
    box.style.display = 'none';
    const body = box.querySelector('.tm-preview-body');
    if (body) body.innerHTML = '';
  };

  const positionPreviewBox = (event) => {
    const box = document.getElementById(PREVIEW_BOX_ID);
    if (!box || box.style.display === 'none' || previewIsDragging) return;
    if (previewPinnedPosition) {
      box.style.left = `${previewPinnedPosition.left}px`; box.style.top = `${previewPinnedPosition.top}px`;
      return;
    }
    const pad = 12; const boxRect = box.getBoundingClientRect();
    let left = event.clientX + 16, top = event.clientY + 16;
    if (left + boxRect.width > window.innerWidth - pad) left = Math.max(pad, event.clientX - boxRect.width - 16);
    if (top + boxRect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - boxRect.height - pad);
    box.style.left = `${left}px`; box.style.top = `${top}px`;
    previewPinnedPosition = { left, top };
  };

  const clampPreviewToViewport = () => {
    const box = document.getElementById(PREVIEW_BOX_ID);
    if (!box || box.style.display === 'none') return;
    const pad = 8; const rect = box.getBoundingClientRect();
    let left = rect.left, top = rect.top;
    if (rect.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (rect.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (rect.left < pad) left = pad; if (rect.top < pad) top = pad;
    box.style.left = `${left}px`; box.style.top = `${top}px`;
    previewPinnedPosition = { left, top };
  };

  const wireTitleHoverPreview = () => {
    if (!enabled || !isVacancyTablePage()) { hidePreviewBox(); return; }
    const titleIdx = getColumnIndexByHeader('Title');
    if (!titleIdx) return;
    const links = document.querySelectorAll(`#vacancyTable tbody td:nth-child(${titleIdx}) a`);
    if (!links.length) return;

    const box = ensurePreviewBox();
    links.forEach((link) => {
      if (link.dataset.tmPreviewBound === '1') return;
      link.dataset.tmPreviewBound = '1';
      let hoverFrame = null, hoverToken = 0;

      const cancelPendingHover = () => { hoverToken += 1; if (hoverFrame) { window.cancelAnimationFrame(hoverFrame); hoverFrame = null; } };

      link.addEventListener('mouseenter', (event) => {
        if (isSettingsModalOpen()) return;
        cancelPendingHover();
        const token = hoverToken;
        const start = performance.now();
        const delay = Math.max(0, Number(settings.previewHoverDelayMs) || 0);

        const tick = async (now) => {
          if (token !== hoverToken) return;
          if (now - start < delay) { hoverFrame = window.requestAnimationFrame(tick); return; }

          const body = box.querySelector('.tm-preview-body');
          if (body) body.innerHTML = '<em>Loading preview…</em>';
          box.style.display = 'block';
          if (!previewPinnedPosition) positionPreviewBox(event);

          const content = await loadPreviewContent(link.href);
          if (token === hoverToken && box.style.display !== 'none' && body) {
            body.innerHTML = content;
            clampPreviewToViewport();
          }
        };
        hoverFrame = window.requestAnimationFrame(tick);
      });
      link.addEventListener('mousemove', (event) => positionPreviewBox(event));
      link.addEventListener('mouseleave', () => cancelPendingHover());
    });
  };

  // --- COMPARE TOOL ---
  const ensureCompareOverlay = () => {
    let overlay = document.getElementById(COMPARE_OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = COMPARE_OVERLAY_ID;
    overlay.innerHTML = `<div class="tm-compare-header"><span>Vacancy Comparison</span><button type="button" class="tm-close-btn" id="tm-compare-close">X</button></div><div class="tm-compare-body"></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#tm-compare-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    return overlay;
  };

  const updateCompareButtonState = () => {
    const button = document.getElementById(COMPARE_BUTTON_ID);
    const clearButton = document.getElementById(CLEAR_BUTTON_ID);
    const count = selectedCompareUrls.size;
    if (button) button.disabled = count < 2 || count > 3;
    if (clearButton) clearButton.disabled = count < 1;
  };

  const setCompareValidation = (message, sourceInput = null) => {
    compareValidationMessage = message || '';
    const host = document.getElementById(COMPARE_ERROR_ID);
    if (host) { host.textContent = compareValidationMessage; host.style.display = compareValidationMessage ? 'block' : 'none'; }
    document.querySelectorAll('.tm-compare-checkbox').forEach((input) => {
      input.setCustomValidity(compareValidationMessage || '');
      if (!compareValidationMessage) input.removeAttribute('aria-invalid');
    });
    if (compareValidationMessage && sourceInput) { sourceInput.setAttribute('aria-invalid', 'true'); sourceInput.reportValidity(); }
    updateCompareButtonState();
  };

  const extractComparisonData = (htmlText) => {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const out = {};
    const addField = (group, label, value) => {
      const cleanLabel = (label || '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
      const cleanValue = (value || '').replace(/\s+/g, ' ').trim();
      if (cleanLabel) out[`${group} > ${cleanLabel}`] = cleanValue;
    };
    doc.querySelectorAll('#content p.row').forEach((row) => {
      if (row.closest('#vacancyDetails')) return;
      const left = row.querySelector('.leftCol'), right = row.querySelector('.rightCol');
      if (left && right) addField('Overview', left.textContent, right.textContent);
    });

    const tabsRoot = doc.querySelector('#vacancyDetails');
    if (tabsRoot) {
      const tabNameByPanelId = {};
      tabsRoot.querySelectorAll('.ui-tabs-nav a[href^="#"]').forEach((a) => {
        const id = (a.getAttribute('href') || '').slice(1);
        if (id) tabNameByPanelId[id] = a.textContent.replace(/\s+/g, ' ').trim() || id;
      });
      tabsRoot.querySelectorAll(':scope > div[id]').forEach((panel) => {
        const tabName = tabNameByPanelId[panel.id] || panel.id;
        let foundRows = 0;
        panel.querySelectorAll('p.row').forEach((row) => {
          const left = row.querySelector('.leftCol'), right = row.querySelector('.rightCol');
          if (left && right) { addField(tabName, left.textContent, right.textContent); foundRows += 1; }
        });
        if (!foundRows) {
          const text = panel.textContent.replace(/\s+/g, ' ').trim();
          if (text) addField(tabName, 'Content', text.slice(0, 1000));
        }
      });
    }
    return out;
  };

  const loadComparisonData = async (url) => {
    if (compareCache.has(url)) return compareCache.get(url);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const data = extractComparisonData(await res.text());
      compareCache.set(url, data);
      return data;
    } catch (_e) { return null; }
  };

  const getComparisonTitle = (url) => {
    const input = document.querySelector(`.tm-compare-checkbox[data-compare-url="${CSS.escape(url)}"]`);
    const row = input ? input.closest('tr') : null;
    const titleLink = row ? row.querySelector('td a[href*="vacancyDetailsView.cfm"]') : null;
    const title = titleLink ? titleLink.textContent.replace(/\s+/g, ' ').trim() : '';
    return title || url;
  };

  const renderComparisonTable = (body, valid) => {
    const allKeys = new Set();
    valid.forEach((item) => Object.keys(item.data).forEach((k) => allKeys.add(k)));
    const keys = Array.from(allKeys);
    if (!keys.length) { body.innerHTML = '<em>No comparable fields were found.</em>'; return; }

    const controls = document.createElement('div');
    controls.className = 'tm-compare-controls';
    controls.innerHTML = '<label><input type="checkbox" id="tm-compare-highlight-diff" checked> Highlight differences</label>';

    const table = document.createElement('table');
    const head = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = '<th>Field</th>' + valid.map((item, i) => `<th title="${getComparisonTitle(item.url)}">Selection ${i + 1}: ${getComparisonTitle(item.url)}</th>`).join('');
    head.appendChild(trh); table.appendChild(head);

    const tbody = document.createElement('tbody');
    keys.forEach((key) => {
      const values = valid.map((v) => v.data[key] || '');
      const differs = new Set(values).size > 1;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${key}</strong></td>` + values.map((val) => `<td>${val}</td>`).join('');
      if (differs) { tr.querySelectorAll('td:not(:first-child)').forEach((cell) => { cell.classList.add('tm-compare-diff'); cell.dataset.diff = '1'; }); }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.innerHTML = ''; body.appendChild(controls); body.appendChild(table);

    const toggle = body.querySelector('#tm-compare-highlight-diff');
    toggle.addEventListener('change', () => { body.querySelectorAll('td[data-diff="1"]').forEach((cell) => { cell.classList.toggle('tm-compare-diff', toggle.checked); }); });
  };

  const openComparisonOverlay = async () => {
    if (isSettingsModalOpen()) return;
    const selected = Array.from(selectedCompareUrls);
    if (selected.length < 2 || selected.length > 3) { updateCompareButtonState(); return; }
    const overlay = ensureCompareOverlay();
    const body = overlay.querySelector('.tm-compare-body');
    body.innerHTML = '<em>Loading comparison…</em>';
    overlay.style.display = 'block';

    const dataList = await Promise.all(selected.map((u) => loadComparisonData(u)));
    const valid = dataList.map((data, i) => ({ url: selected[i], data })).filter((d) => d.data);
    if (valid.length < 2) { body.innerHTML = '<em>Not enough rows loaded to compare.</em>'; return; }
    renderComparisonTable(body, valid);
  };

  const clearSelectedComparisons = () => {
    selectedCompareUrls.clear();
    document.querySelectorAll('.tm-compare-checkbox').forEach((input) => { input.checked = false; input.setCustomValidity(''); input.removeAttribute('aria-invalid'); });
    setCompareValidation('');
  };

  const resetVacancyUiState = () => {
    closeDeadlineFilterActive = false;
    selectedCompareUrls.clear();
    compareValidationMessage = '';
    document.querySelectorAll('.tm-close-deadline-row-hidden').forEach((row) => row.classList.remove('tm-close-deadline-row-hidden'));
    const link = document.getElementById('tm-close-deadline-link');
    if (link) {
      link.textContent = 'Close to Deadline Postings';
      link.setAttribute('aria-pressed', 'false');
      const url = new URL(window.location.href); url.searchParams.delete('tmCloseDeadline'); link.href = url.pathname + url.search;
    }
    document.querySelectorAll('.tm-compare-checkbox').forEach((input) => { input.checked = false; input.setCustomValidity(''); input.removeAttribute('aria-invalid'); });
    document.querySelectorAll('#vacancyTable td.tm-deadline-pulse').forEach((cell) => { cell.classList.remove('tm-deadline-pulse'); delete cell.dataset.tmPulseBaseColor; cell.style.removeProperty('background-color'); cell.style.removeProperty('color'); });
    const error = document.getElementById(COMPARE_ERROR_ID);
    if (error) { error.textContent = ''; error.style.display = 'none'; }
  };

  const ensureCompareButton = () => {
    if (!isVacancyTablePage()) return;
    const lengthWrap = document.querySelector('#vacancyTable_wrapper .dt-length');
    if (!lengthWrap) return;
    let button = document.getElementById(COMPARE_BUTTON_ID);
    if (!button) {
      button = document.createElement('button'); button.id = COMPARE_BUTTON_ID; button.type = 'button'; button.textContent = 'Compare Selected';
      button.addEventListener('click', () => openComparisonOverlay());
      lengthWrap.appendChild(button);
    }
    let clearButton = document.getElementById(CLEAR_BUTTON_ID);
    if (!clearButton) {
      clearButton = document.createElement('button'); clearButton.id = CLEAR_BUTTON_ID; clearButton.type = 'button'; clearButton.textContent = 'Clear Selected';
      clearButton.addEventListener('click', () => clearSelectedComparisons());
      lengthWrap.appendChild(clearButton);
    }
    let error = document.getElementById(COMPARE_ERROR_ID);
    if (!error) {
      error = document.createElement('div'); error.id = COMPARE_ERROR_ID; error.style.display = 'none';
      lengthWrap.insertAdjacentElement('afterend', error);
    }
    updateCompareButtonState();
  };

  const ensureCompareColumn = () => {
    if (!isVacancyTablePage()) return;
    const table = document.getElementById('vacancyTable');
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('.tm-compare-header')) {
      const th = document.createElement('th'); th.className = 'tm-compare-header'; th.textContent = 'Compare'; th.setAttribute('data-dt-order', 'disable');
      headerRow.insertBefore(th, headerRow.firstElementChild);
    }
    table.querySelectorAll('tbody tr').forEach((row) => {
      if (row.querySelector('.tm-compare-cell')) return;
      const titleLink = row.querySelector('td a[href*="vacancyDetailsView.cfm"]');
      const td = document.createElement('td'); td.className = 'tm-compare-cell';
      const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'tm-compare-checkbox'; input.disabled = !titleLink;
      if (titleLink) { input.dataset.compareUrl = titleLink.href; input.checked = selectedCompareUrls.has(titleLink.href); }
      input.addEventListener('change', (event) => {
        const url = event.target.dataset.compareUrl;
        if (!url) return;
        if (event.target.checked) {
          if (selectedCompareUrls.size >= 3) { event.target.checked = false; setCompareValidation('Please select no more than 3 entries to compare.', event.target); return; }
          selectedCompareUrls.add(url);
        } else {
          selectedCompareUrls.delete(url);
        }
        if (selectedCompareUrls.size <= 3) setCompareValidation('');
      });
      td.appendChild(input);
      row.insertBefore(td, row.firstElementChild);
    });
  };


  // --- FUN MODE ---
  const stopFunModeAnimation = () => {
    funModeActive = false;
    if (funModeFrame) { window.cancelAnimationFrame(funModeFrame); funModeFrame = null; }
    document.body.classList.remove('tm-fun-mode');
    const button = document.getElementById(JUST_FOR_FUN_BUTTON_ID);
    if (button) { button.textContent = 'just for fun'; button.setAttribute('aria-pressed', 'false'); }
    document.querySelectorAll('#vacancyTable tbody td').forEach(cell => {
      cell.style.removeProperty('background-color'); cell.style.removeProperty('color');
    });
    normalizeVacancyRowStriping();
    applyDeadlineStyling();
    ensureDeadlinePulseTimer();
  };

  const startFunModeAnimation = () => {
    if (!isVacancyTablePage()) return;
    funModeActive = true;
    stopDeadlinePulseTimer();
    document.querySelectorAll('#vacancyTable tbody td').forEach(cell => {
      cell.style.removeProperty('background-color'); cell.style.removeProperty('color');
    });
    document.body.classList.add('tm-fun-mode');
    const button = document.getElementById(JUST_FOR_FUN_BUTTON_ID);
    if (button) { button.textContent = 'just for fun (on)'; button.setAttribute('aria-pressed', 'true'); }

    funModeCells = [];
    const tbody = document.querySelector('#vacancyTable tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    let maxCols = 0;
    rows.forEach((row, rIdx) => {
      const cells = Array.from(row.children);
      maxCols = Math.max(maxCols, cells.length);
      cells.forEach((cell, cIdx) => funModeCells.push({ el: cell, x: cIdx, y: rIdx }));
    });

    const centerX = (maxCols - 1) / 2;
    const centerY = (rows.length - 1) / 2;

    funModeCells.forEach(c => {
      const dx = c.x - centerX, dy = c.y - centerY;
      c.distEuclidean = Math.sqrt(dx * dx + dy * dy);
      c.distManhattan = Math.max(Math.abs(dx), Math.abs(dy));
    });

    const render = (time) => {
      if (!funModeActive) return;
      const t = time / 1000;
      const cycle = Math.floor(t / 15) % 3;
      const phase = t * 2.5;
      const hueBase = t * 15;

      funModeCells.forEach(c => {
        let pulseRaw = 0;
        if (cycle === 0) pulseRaw = Math.sin(c.distEuclidean * 0.4 - phase);
        else if (cycle === 1) { const isEven = (c.x + c.y) % 2 === 0; pulseRaw = Math.sin(phase) * (isEven ? 1 : -1); }
        else pulseRaw = Math.sin(c.distManhattan * 0.4 - phase);

        const pulseNorm = (pulseRaw + 1) / 2;
        const l = 75 + (pulseNorm * 20);
        const h = (hueBase + c.distEuclidean * 10) % 360;

        c.el.style.setProperty('background-color', `hsl(${h}, 80%, ${l}%)`, 'important');
        c.el.style.setProperty('color', '#111', 'important');
      });
      funModeFrame = window.requestAnimationFrame(render);
    };
    funModeFrame = window.requestAnimationFrame(render);
  };

  const toggleFunModeAnimation = () => { funModeActive ? stopFunModeAnimation() : startFunModeAnimation(); };

  const ensureJustForFunButton = () => {
    if (document.getElementById(JUST_FOR_FUN_BUTTON_ID)) return;
    const nav = document.getElementById('nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.id = JUST_FOR_FUN_BUTTON_ID; button.type = 'button'; button.textContent = 'just for fun'; button.setAttribute('aria-pressed', 'false');
    button.style.marginTop = '6px'; button.style.padding = '3px 8px';
    button.addEventListener('click', () => toggleFunModeAnimation());
    const helpfulSection = Array.from(nav.querySelectorAll('.navSection, h3, h4, p, div')).find((node) => /Helpful Links/i.test(node.textContent || ''));
    if (helpfulSection) helpfulSection.insertAdjacentElement('afterend', button);
    else nav.appendChild(button);
  };

  // --- SETTINGS UI ---
  const ensureMobileNavToggle = () => {
    let button = document.getElementById(MOBILE_NAV_TOGGLE_ID);
    if (button) return button;
    const nav = document.getElementById('nav'); const content = document.getElementById('content');
    if (!nav || !content || !content.parentElement) return null;
    button = document.createElement('button'); button.id = MOBILE_NAV_TOGGLE_ID; button.type = 'button'; button.style.display = 'none';
    button.addEventListener('click', () => {
      const mainContent = document.getElementById('mainContent');
      if (!mainContent) return;
      mobileNavCollapsed = !mainContent.classList.contains('tm-nav-collapsed');
      mainContent.classList.toggle('tm-nav-collapsed', mobileNavCollapsed);
      button.textContent = mobileNavCollapsed ? '☰ >' : 'Collapse Left Navigation';
      button.setAttribute('aria-expanded', String(!mobileNavCollapsed));
    });
    nav.insertAdjacentElement('beforebegin', button);
    return button;
  };

  const applyMobileNavState = () => {
    const mainContent = document.getElementById('mainContent');
    const button = ensureMobileNavToggle();
    if (!mainContent || !button) return;
    if (!enabled) { button.style.display = 'none'; mainContent.classList.remove('tm-nav-collapsed'); return; }
    button.style.display = 'inline-flex';
    mainContent.classList.toggle('tm-nav-collapsed', mobileNavCollapsed);
    button.textContent = mobileNavCollapsed ? '☰ >' : 'Collapse Left Navigation';
    button.setAttribute('aria-expanded', String(!mobileNavCollapsed));
  };

  const syncSettingsDefaultLengthSelect = () => {
    const modal = document.getElementById(SETTINGS_MODAL_ID);
    if (!modal || modal.style.display === 'none') return;
    const select = modal.querySelector('#tm-setting-length');
    if (!select) return;
    const pageSelect = ensureLengthOptions();
    const options = pageSelect ? Array.from(pageSelect.options).map((o) => ({ value: o.value, text: o.textContent })) : [
      { value: '10', text: '10' }, { value: '25', text: '25' }, { value: '50', text: '50' }, { value: '100', text: '100' },
      { value: '250', text: '250' }, { value: '500', text: '500' }, { value: '9999', text: 'All' },
    ];
    const existing = Array.from(select.options).map((o) => `${o.value}:${o.textContent}`).join('|');
    const incoming = options.map((o) => `${o.value}:${o.text}`).join('|');
    if (existing !== incoming) { select.innerHTML = ''; options.forEach((opt) => select.add(new Option(opt.text, opt.value))); }
    if (!options.some((o) => o.value === settings.defaultEntriesPerPage)) {
      settings.defaultEntriesPerPage = options.some((o) => o.value === '100') ? '100' : options[0]?.value || '10';
      saveSettings();
    }
    select.value = settings.defaultEntriesPerPage;
  };

  const ensureSettingsModal = () => {
    let modal = document.getElementById(SETTINGS_MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div'); modal.id = SETTINGS_MODAL_ID;
    modal.innerHTML = `
      <div class="tm-settings-header"><span>Page Settings</span><button type="button" class="tm-close-btn" id="tm-settings-close">X</button></div>
      <div class="tm-settings-body">
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-responsive"> Responsive layout</label><div class="tm-settings-note">Uses the full viewport and responsive grid layout for main content.</div>
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-agency"> Widen Agency column</label><div class="tm-settings-note">Recommended: leave off if you want to avoid accidental width changes.</div>
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-deadline"> Is Deadline Approaching</label><div class="tm-settings-note">Highlights deadlines that are due within 3 days.</div>
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-deadline-pulse"> Deadline Pulse</label><div class="tm-settings-note">For deadlines due today, pulse between red and the row color.</div>
        <label class="tm-settings-row">Table Font family:<input id="tm-setting-font-family" type="text" placeholder="inherit" style="width:200px;"></label><div class="tm-settings-note">Example: Arial, "Open Sans", Georgia, monospace.</div>
        <label class="tm-settings-row">Table Font size (px):<input id="tm-setting-font-size" type="number" min="10" max="24" step="1" style="width:90px;"></label><div class="tm-settings-note">Also controls Grade salary-range helper text at 2px smaller.</div>
        <label class="tm-settings-row">Stripe color:<select id="tm-setting-stripe-color" class="tm-stripe-color-picker"></select></label><div class="tm-settings-note">Select a row stripe tint from the color-only dropdown.</div>
        <label class="tm-settings-row">Default Entries per Page:<select id="tm-setting-length"></select></label><div class="tm-settings-note">Automatically applies after table load.</div>
        <label class="tm-settings-row">Job Specifics Preview hover delay (milliseconds):<input id="tm-setting-hover-delay" type="number" min="0" max="5000" step="10" style="width:120px;"></label><div class="tm-settings-note">Lower numbers make previews appear faster on hover.</div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#tm-settings-close').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.querySelector('#tm-setting-responsive').addEventListener('change', (e) => updateSetting('responsiveLayout', e.target.checked));
    modal.querySelector('#tm-setting-agency').addEventListener('change', (e) => updateSetting('widenAgencyColumn', e.target.checked));
    modal.querySelector('#tm-setting-deadline').addEventListener('change', (e) => updateSetting('highlightDeadlineApproaching', e.target.checked));
    modal.querySelector('#tm-setting-deadline-pulse').addEventListener('change', (e) => updateSetting('deadlinePulse', e.target.checked));
    modal.querySelector('#tm-setting-font-family').addEventListener('input', (e) => updateSetting('tableFontFamily', e.target.value || ''));
    modal.querySelector('#tm-setting-font-size').addEventListener('input', (e) => updateSetting('tableFontSizePx', Math.max(10, Math.min(24, Number(e.target.value) || 12))));
    modal.querySelector('#tm-setting-stripe-color').addEventListener('change', (e) => { e.target.style.backgroundColor = e.target.value; updateSetting('stripeColor', e.target.value); });
    modal.querySelector('#tm-setting-length').addEventListener('change', (e) => updateSetting('defaultEntriesPerPage', e.target.value));
    modal.querySelector('#tm-setting-hover-delay').addEventListener('input', (e) => updateSetting('previewHoverDelayMs', Math.max(0, Math.min(5000, Number(e.target.value) || 0))));

    const stripeSelect = modal.querySelector('#tm-setting-stripe-color');
    STRIPE_PALETTE.forEach((color) => {
      const option = document.createElement('option'); option.value = color; option.textContent = ' '; option.style.backgroundColor = color;
      stripeSelect.appendChild(option);
    });
    return modal;
  };

  const openSettingsModal = () => {
    const modal = ensureSettingsModal();
    hidePreviewBox();
    const compareOverlay = document.getElementById(COMPARE_OVERLAY_ID);
    if (compareOverlay) compareOverlay.style.display = 'none';
    modal.querySelector('#tm-setting-responsive').checked = settings.responsiveLayout;
    modal.querySelector('#tm-setting-agency').checked = settings.widenAgencyColumn;
    modal.querySelector('#tm-setting-deadline').checked = settings.highlightDeadlineApproaching;
    modal.querySelector('#tm-setting-deadline-pulse').checked = settings.deadlinePulse;
    modal.querySelector('#tm-setting-font-family').value = settings.tableFontFamily || '';
    modal.querySelector('#tm-setting-font-size').value = String(settings.tableFontSizePx || 12);
    modal.querySelector('#tm-setting-stripe-color').value = STRIPE_PALETTE.includes(settings.stripeColor) ? settings.stripeColor : '#eee';
    modal.querySelector('#tm-setting-stripe-color').style.backgroundColor = modal.querySelector('#tm-setting-stripe-color').value;
    modal.querySelector('#tm-setting-hover-delay').value = String(settings.previewHoverDelayMs);
    modal.style.display = 'block';
    syncSettingsDefaultLengthSelect();
  };

  const insertSettingsEntryInNav = () => {
    if (document.getElementById(SETTINGS_ENTRY_ID)) return;
    const navList = document.querySelector('#nav > ul');
    if (!navList) return;
    const li = document.createElement('li'); li.id = SETTINGS_ENTRY_ID; li.className = 'localNavItem';
    const link = document.createElement('a'); link.href = '#'; link.textContent = '⚙ Page Settings';
    link.addEventListener('click', (e) => { e.preventDefault(); openSettingsModal(); });
    li.appendChild(link);
    const otherListingsLink = Array.from(navList.querySelectorAll('a')).find((anchor) => (anchor.getAttribute('href') || '').includes('/employees/offsitePostings.cfm'));
    const insertAfter = otherListingsLink ? otherListingsLink.closest('li') : navList.lastElementChild;
    if (insertAfter && insertAfter.parentElement === navList) insertAfter.insertAdjacentElement('afterend', li);
    else navList.appendChild(li);
  };

  // --- CORE EXECUTION ---
  const scheduleVacancyRefresh = () => {
    if (vacancyRefreshScheduled) return;
    vacancyRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      vacancyRefreshScheduled = false;
      normalizeVacancyRowStriping();
      applyTableTypography();
      applyAgencyColumnMode();
      applyDeadlineStyling();
      ensureCompareColumn();
      ensureCompareButton();
      ensureCloseDeadlineLink();
      resetSalaryLoadState();
      bindLazySalaryLoader();
      startLazySalaryPoller();
      scheduleLazySalaryLoad();
      wireTitleHoverPreview();
    });
  };

  const startStripeObserver = () => {
    if (stripeObserver) stripeObserver.disconnect();
    if (!enabled || !isVacancyTablePage()) return;
    normalizeVacancyRowStriping();
    applyTableTypography();
    applyAgencyColumnMode();
    applyDeadlineStyling();
    ensureCompareColumn();
    ensureCompareButton();
    resetSalaryLoadState();
    bindLazySalaryLoader();
    startLazySalaryPoller();
    scheduleLazySalaryLoad();

    const tbody = document.querySelector('#vacancyTable tbody');
    if (!tbody) return;
    stripeObserver = new MutationObserver(() => scheduleVacancyRefresh());
    stripeObserver.observe(tbody, { childList: true, subtree: false });
  };

  const stopStripeObserver = () => {
    if (stripeObserver) { stripeObserver.disconnect(); stripeObserver = null; }
  };

  const applyState = () => {
    ensureBaseUiStyle();
    document.body.classList.toggle('tm-responsive-enabled', enabled);

    if (enabled) {
      ensureStyle();
      retrySetLength();
      startLengthObserver();
      startStripeObserver();
      applyMobileNavState();
      applyAgencyColumnMode();
      applyTableTypography();
      applyDeadlineStyling();
      ensureCloseDeadlineLink();
      ensureJustForFunButton();
      wireTitleHoverPreview();
      ensureGradeAscendingSort();
      updateCompareButtonState();
    } else {
      removeCustomLengthOptions();
      stopDeadlinePulseTimer();
      stopLazySalaryPoller();
      stopFunModeAnimation();
      resetSalaryLoadState();
      hideSalaryLoadingToast();
      resetVacancyUiState();
      removeStyle();
      stopLengthObserver();
      stopStripeObserver();
      hidePreviewBox();
      const compare = document.getElementById(COMPARE_OVERLAY_ID);
      if (compare) compare.style.display = 'none';
      const compareBtn = document.getElementById(COMPARE_BUTTON_ID);
      if (compareBtn) compareBtn.disabled = true;
      const clearBtn = document.getElementById(CLEAR_BUTTON_ID);
      if (clearBtn) clearBtn.disabled = true;
      applyMobileNavState();
    }
  };

  // --- INIT ---
  insertSettingsEntryInNav();
  ensureJustForFunButton();
  ensureBaseUiStyle();
  ensureSettingsModal();
  applyState();
  window.addEventListener('resize', applyMobileNavState);
  window.addEventListener('resize', clampPreviewToViewport);

})();

//# sourceURL=StateJobsNY_Responsive_v3.js
