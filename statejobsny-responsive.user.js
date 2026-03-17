// ==UserScript==
// @name         StateJobsNY responsive/full-width layout
// @namespace    https://statejobsny.com/
// @version      3.0.0
// @description  Makes StateJobsNY public and employee pages use the full viewport with configurable page settings.
// @author       You
// @match        https://statejobsny.com/public/*
// @match        https://statejobsny.com/employees/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STYLE_ID = 'tm-statejobsny-responsive';
  const SETTINGS_KEY = 'tm-statejobsny-settings';
  const SETTINGS_ENTRY_ID = 'tm-statejobsny-settings-entry';
  const SETTINGS_MODAL_ID = 'tm-statejobsny-settings-modal';
  const MOBILE_NAV_TOGGLE_ID = 'tm-statejobsny-mobile-nav-toggle';
  const PREVIEW_BOX_ID = 'tm-statejobsny-link-preview';
  const COMPARE_OVERLAY_ID = 'tm-statejobsny-compare-overlay';

  const DEFAULT_SETTINGS = {
    responsiveLayout: true,
    widenAgencyColumn: false,
    highlightDeadlineApproaching: false,
    defaultEntriesPerPage: '100',
    previewHoverDelayMs: 220,
  };

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
  const compareCache = new Map();
  const selectedCompareUrls = new Set();
  let vacancyRefreshScheduled = false;

  const isVacancyTablePage = () => Boolean(document.getElementById('vacancyTable'));

  const saveSettings = () => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_e) {
      // ignore storage errors
    }
  };

  const updateSetting = (key, value) => {
    settings[key] = value;
    enabled = settings.responsiveLayout;
    saveSettings();
    defaultLengthApplied = false;
    applyState();
  };

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
      #vacancyTable.tm-agency-wide th:nth-child(7), #vacancyTable.tm-agency-wide td:nth-child(7) { min-width:clamp(110px, 12vw, 170px) !important; }
      #vacancyTable.tm-agency-wide th:nth-child(3), #vacancyTable.tm-agency-wide td:nth-child(3) { min-width:clamp(240px, 30vw, 520px) !important; }
      #vacancyTable .tm-compare-cell, #vacancyTable .tm-compare-header { width:1% !important; text-align:center !important; white-space:nowrap !important; }

      #tm-statejobsny-mobile-nav-toggle {
        grid-area:nav; display:inline-flex !important; align-items:center !important; justify-content:flex-start !important;
        gap:6px !important; width:100% !important; max-width:220px !important; margin:8px 0 !important;
        padding:6px 10px !important; border:1px solid #b0b0b0 !important; border-radius:4px !important;
        background:#eee !important; cursor:pointer !important; font-size:13px !important; z-index:2;
      }
      #mainContent.tm-nav-collapsed { grid-template-columns:44px minmax(0, 1fr) !important; column-gap:10px !important; }
      #mainContent.tm-nav-collapsed #nav { display:block !important; width:0 !important; min-width:0 !important; max-width:0 !important; overflow:hidden !important; margin:0 !important; padding:0 !important; border:0 !important; }

      #${SETTINGS_MODAL_ID}, #${COMPARE_OVERLAY_ID}, #${PREVIEW_BOX_ID} {
        position:fixed; z-index:10000; background:#fff; border:1px solid #7a7a7a; box-shadow:0 6px 18px rgba(0,0,0,0.25);
      }
      #${SETTINGS_MODAL_ID} {
        width:min(540px, calc(100vw - 24px)); top:50%; left:50%; transform:translate(-50%, -50%); display:none;
      }
      #${SETTINGS_MODAL_ID} .tm-settings-header,
      #${COMPARE_OVERLAY_ID} .tm-compare-header,
      #${PREVIEW_BOX_ID} .tm-preview-header {
        background:#e9e9e9; border-bottom:1px solid #b8b8b8; padding:8px 10px; font-weight:700;
        display:flex; align-items:center; justify-content:space-between;
      }
      #${SETTINGS_MODAL_ID} .tm-settings-body { padding:10px; display:grid; gap:10px; max-height:70vh; overflow:auto; }
      #${SETTINGS_MODAL_ID} .tm-settings-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      #${SETTINGS_MODAL_ID} .tm-settings-note { font-size:12px; color:#555; margin-left:24px; }
      .tm-close-btn { border:1px solid #888; background:#fff; border-radius:3px; padding:1px 8px; cursor:pointer; font-size:12px; }

      #${PREVIEW_BOX_ID} { display:none; width:min(560px, calc(100vw - 24px)); max-height:min(70vh, 560px); overflow:auto; padding:10px; font-size:13px; line-height:1.35; }
      #${PREVIEW_BOX_ID} .tm-preview-header { margin:-10px -10px 10px; border:1px solid #b8b8b8; cursor:move; user-select:none; }
      #${PREVIEW_BOX_ID} .tm-preview-tab-title { margin:10px 0 6px; font-weight:700; border-bottom:1px solid #d0d0d0; padding-bottom:2px; }
      #${PREVIEW_BOX_ID} .tm-preview-section-title { margin:8px 0 4px; font-weight:700; color:#011a77; }
      #${PREVIEW_BOX_ID} .tm-preview-section-content { margin:0 0 8px; }

      #${COMPARE_OVERLAY_ID} { display:none; width:min(980px, calc(100vw - 20px)); max-height:80vh; top:50%; left:50%; transform:translate(-50%, -50%); overflow:hidden; }
      #${COMPARE_OVERLAY_ID} .tm-compare-body { overflow:auto; max-height:calc(80vh - 48px); padding:8px; }
      #${COMPARE_OVERLAY_ID} table { width:100%; border-collapse:collapse; }
      #${COMPARE_OVERLAY_ID} th, #${COMPARE_OVERLAY_ID} td { border:1px solid #ddd; padding:6px; vertical-align:top; text-align:left; }

      .tm-urgent-deadline { color:#8b0000 !important; font-weight:600 !important; }

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

  const removeStyle = () => {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  };

  const getColumnIndexByHeader = (label) => {
    const headers = Array.from(document.querySelectorAll('#vacancyTable thead th'));
    const idx = headers.findIndex((th) => th.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === label.toLowerCase());
    return idx >= 0 ? idx + 1 : null;
  };

  const ensureLengthOptions = () => {
    const lengthSelect = document.querySelector('select[name="vacancyTable_length"], #vacancyTable_wrapper .dt-length select');
    if (!lengthSelect) return null;
    [
      { value: '250', text: '250' },
      { value: '500', text: '500' },
      { value: '9999', text: 'All' },
    ].forEach((item) => {
      if (!Array.from(lengthSelect.options).some((o) => o.value === item.value)) {
        lengthSelect.add(new Option(item.text, item.value));
      }
    });
    return lengthSelect;
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
      if (applyDefaultEntriesPerPage()) {
        stopLengthObserver();
      }
    });

    const wrapper = document.getElementById('vacancyTable_wrapper') || document.body;
    lengthObserver.observe(wrapper, { childList: true, subtree: true });
  };

  const stopLengthObserver = () => {
    if (lengthObserver) {
      lengthObserver.disconnect();
      lengthObserver = null;
    }
  };

  const normalizeVacancyRowStriping = () => {
    if (!enabled) return;
    const rows = document.querySelectorAll('#vacancyTable tbody tr');
    rows.forEach((row, index) => {
      row.classList.remove('odd', 'even');
      row.classList.add(index % 2 === 0 ? 'odd' : 'even');
    });
  };

  const applyAgencyColumnMode = () => {
    const table = document.getElementById('vacancyTable');
    if (!table) return;
    table.classList.toggle('tm-agency-wide', Boolean(settings.widenAgencyColumn));
  };

  const applyDeadlineStyling = () => {
    if (!enabled) return;
    const deadlineIdx = getColumnIndexByHeader('Deadline');
    if (deadlineIdx) {
      document.querySelectorAll(`#vacancyTable tbody tr td:nth-child(${deadlineIdx})`).forEach((cell) => {
        const apply = settings.highlightDeadlineApproaching && isApproachingDate(cell.textContent);
        cell.classList.toggle('tm-urgent-deadline', apply);
      });
    }

    const row = Array.from(document.querySelectorAll('#content p.row')).find((p) => {
      const left = p.querySelector('.leftCol');
      return left && /Applications Due/i.test(left.textContent || '');
    });
    if (row) {
      const right = row.querySelector('.rightCol');
      if (right) {
        const apply = settings.highlightDeadlineApproaching && isApproachingDate(right.textContent);
        right.classList.toggle('tm-urgent-deadline', apply);
      }
    }
  };

  const ensureGradeAscendingSort = () => {
    if (!enabled) return;
    const gradeHeader = Array.from(document.querySelectorAll('#vacancyTable thead th')).find((th) => /grade/i.test(th.textContent || ''));
    if (!gradeHeader) return;
    if (gradeHeader.getAttribute('aria-sort') === 'ascending') return;
    gradeHeader.click();
    window.setTimeout(() => {
      if (gradeHeader.getAttribute('aria-sort') !== 'ascending') gradeHeader.click();
    }, 80);
  };

  const ensureMobileNavToggle = () => {
    let button = document.getElementById(MOBILE_NAV_TOGGLE_ID);
    if (button) return button;
    const nav = document.getElementById('nav');
    const content = document.getElementById('content');
    if (!nav || !content || !content.parentElement) return null;

    button = document.createElement('button');
    button.id = MOBILE_NAV_TOGGLE_ID;
    button.type = 'button';
    button.style.display = 'none';
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
    if (!enabled) {
      button.style.display = 'none';
      mainContent.classList.remove('tm-nav-collapsed');
      return;
    }
    button.style.display = 'inline-flex';
    mainContent.classList.toggle('tm-nav-collapsed', mobileNavCollapsed);
    button.textContent = mobileNavCollapsed ? '☰ >' : 'Collapse Left Navigation';
    button.setAttribute('aria-expanded', String(!mobileNavCollapsed));
  };

  const ensureSettingsModal = () => {
    let modal = document.getElementById(SETTINGS_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = SETTINGS_MODAL_ID;
    modal.innerHTML = `
      <div class="tm-settings-header">
        <span>Page Settings</span>
        <button type="button" class="tm-close-btn" id="tm-settings-close">X</button>
      </div>
      <div class="tm-settings-body">
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-responsive"> Responsive layout</label>
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-agency"> Widen Agency column</label>
        <div class="tm-settings-note">Recommended: leave off if you want to avoid accidental width changes.</div>
        <label class="tm-settings-row"><input type="checkbox" id="tm-setting-deadline"> Is Deadline Approaching</label>
        <label class="tm-settings-row">Default Entries per Page:
          <select id="tm-setting-length"></select>
        </label>
        <label class="tm-settings-row">Job Specifics Preview hover delay (milliseconds):
          <input id="tm-setting-hover-delay" type="number" min="0" max="5000" step="10" style="width:120px;">
        </label>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#tm-settings-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.querySelector('#tm-setting-responsive').addEventListener('change', (e) => updateSetting('responsiveLayout', e.target.checked));
    modal.querySelector('#tm-setting-agency').addEventListener('change', (e) => updateSetting('widenAgencyColumn', e.target.checked));
    modal.querySelector('#tm-setting-deadline').addEventListener('change', (e) => updateSetting('highlightDeadlineApproaching', e.target.checked));
    modal.querySelector('#tm-setting-length').addEventListener('change', (e) => updateSetting('defaultEntriesPerPage', e.target.value));
    modal.querySelector('#tm-setting-hover-delay').addEventListener('input', (e) => {
      const next = Math.max(0, Math.min(5000, Number(e.target.value) || 0));
      updateSetting('previewHoverDelayMs', next);
    });

    return modal;
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
    if (existing !== incoming) {
      select.innerHTML = '';
      options.forEach((opt) => select.add(new Option(opt.text, opt.value)));
    }

    if (!options.some((o) => o.value === settings.defaultEntriesPerPage)) {
      settings.defaultEntriesPerPage = options.some((o) => o.value === '100') ? '100' : options[0]?.value || '10';
      saveSettings();
    }
    select.value = settings.defaultEntriesPerPage;
  };

  const openSettingsModal = () => {
    const modal = ensureSettingsModal();
    modal.querySelector('#tm-setting-responsive').checked = settings.responsiveLayout;
    modal.querySelector('#tm-setting-agency').checked = settings.widenAgencyColumn;
    modal.querySelector('#tm-setting-deadline').checked = settings.highlightDeadlineApproaching;
    modal.querySelector('#tm-setting-hover-delay').value = String(settings.previewHoverDelayMs);
    modal.style.display = 'block';
    syncSettingsDefaultLengthSelect();
  };

  const insertSettingsEntryInNav = () => {
    if (document.getElementById(SETTINGS_ENTRY_ID)) return;
    const navList = document.querySelector('#nav > ul');
    if (!navList) return;
    const li = document.createElement('li');
    li.id = SETTINGS_ENTRY_ID;
    li.className = 'localNavItem';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = '⚙ Page Settings';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
    li.appendChild(link);

    const otherListingsLink = Array.from(navList.querySelectorAll('a')).find((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return href.includes('/employees/offsitePostings.cfm');
    });
    const insertAfter = otherListingsLink ? otherListingsLink.closest('li') : navList.lastElementChild;
    if (insertAfter && insertAfter.parentElement === navList) insertAfter.insertAdjacentElement('afterend', li);
    else navList.appendChild(li);
  };

  const ensurePreviewBox = () => {
    let box = document.getElementById(PREVIEW_BOX_ID);
    if (box) return box;

    box = document.createElement('div');
    box.id = PREVIEW_BOX_ID;
    box.innerHTML = `
      <div class="tm-preview-header"><span>Job Specifics Preview</span><button type="button" class="tm-close-btn tm-preview-close">X</button></div>
      <div class="tm-preview-body"></div>
    `;
    box.style.display = 'none';
    document.body.appendChild(box);

    const close = box.querySelector('.tm-preview-close');
    const header = box.querySelector('.tm-preview-header');
    close.addEventListener('click', () => hidePreviewBox());

    let dragOffsetX = 0;
    let dragOffsetY = 0;
    const onMove = (event) => {
      if (!previewIsDragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, event.clientX - dragOffsetX));
      const top = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, event.clientY - dragOffsetY));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      previewPinnedPosition = { left, top };
    };
    const onUp = () => {
      previewIsDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    header.addEventListener('mousedown', (event) => {
      if (event.target === close) return;
      previewIsDragging = true;
      const rect = box.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    document.addEventListener('mousedown', (event) => {
      if (box.style.display === 'none') return;
      if (!box.contains(event.target)) hidePreviewBox();
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
      box.style.left = `${previewPinnedPosition.left}px`;
      box.style.top = `${previewPinnedPosition.top}px`;
      return;
    }
    const pad = 12;
    const boxRect = box.getBoundingClientRect();
    let left = event.clientX + 16;
    let top = event.clientY + 16;
    if (left + boxRect.width > window.innerWidth - pad) left = Math.max(pad, event.clientX - boxRect.width - 16);
    if (top + boxRect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - boxRect.height - pad);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    previewPinnedPosition = { left, top };
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

  const loadPreviewContent = async (url) => {
    if (previewCache.has(url)) return previewCache.get(url);
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return '<em>Preview could not be loaded.</em>';
      const html = await response.text();
      const extracted = extractPreviewHtml(html);
      previewCache.set(url, extracted);
      return extracted;
    } catch (_e) {
      return '<em>Preview could not be loaded.</em>';
    }
  };

  const wireTitleHoverPreview = () => {
    if (!enabled || !isVacancyTablePage()) {
      hidePreviewBox();
      return;
    }
    const titleIdx = getColumnIndexByHeader('Title');
    if (!titleIdx) return;
    const links = document.querySelectorAll(`#vacancyTable tbody td:nth-child(${titleIdx}) a`);
    if (!links.length) return;

    const box = ensurePreviewBox();
    links.forEach((link) => {
      if (link.dataset.tmPreviewBound === '1') return;
      link.dataset.tmPreviewBound = '1';
      let hoverTimer = null;

      link.addEventListener('mouseenter', (event) => {
        hoverTimer = window.setTimeout(async () => {
          const body = box.querySelector('.tm-preview-body');
          if (body) body.innerHTML = '<em>Loading preview…</em>';
          box.style.display = 'block';
          if (!previewPinnedPosition) positionPreviewBox(event);
          const content = await loadPreviewContent(link.href);
          if (box.style.display !== 'none' && body) body.innerHTML = content;
        }, Number(settings.previewHoverDelayMs) || 0);
      });

      link.addEventListener('mousemove', (event) => positionPreviewBox(event));
      link.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          window.clearTimeout(hoverTimer);
          hoverTimer = null;
        }
      });
    });
  };

  const ensureCompareOverlay = () => {
    let overlay = document.getElementById(COMPARE_OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = COMPARE_OVERLAY_ID;
    overlay.innerHTML = `
      <div class="tm-compare-header">
        <span>Vacancy Comparison</span>
        <button type="button" class="tm-close-btn" id="tm-compare-close">X</button>
      </div>
      <div class="tm-compare-body"></div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#tm-compare-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    });
    return overlay;
  };

  const extractComparisonData = (htmlText) => {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const out = {};
    doc.querySelectorAll('#content p.row').forEach((row) => {
      const left = row.querySelector('.leftCol');
      const right = row.querySelector('.rightCol');
      if (!left || !right) return;
      const label = left.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, '');
      const value = right.textContent.replace(/\s+/g, ' ').trim();
      if (label && value) out[label] = value;
    });
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
    } catch (_e) {
      return null;
    }
  };

  const updateComparisonOverlay = async () => {
    const overlay = ensureCompareOverlay();
    const body = overlay.querySelector('.tm-compare-body');
    const selected = Array.from(selectedCompareUrls);
    if (selected.length < 2) {
      overlay.style.display = 'none';
      return;
    }

    body.innerHTML = '<em>Loading comparison…</em>';
    overlay.style.display = 'block';

    const dataList = await Promise.all(selected.map((u) => loadComparisonData(u)));
    const valid = dataList.map((data, i) => ({ url: selected[i], data })).filter((d) => d.data);
    if (valid.length < 2) {
      body.innerHTML = '<em>Not enough rows loaded to compare.</em>';
      return;
    }

    const keys = new Set();
    valid.forEach((item) => Object.keys(item.data).forEach((k) => keys.add(k)));
    const differingKeys = Array.from(keys).filter((k) => {
      const values = valid.map((item) => item.data[k] || '');
      return new Set(values).size > 1;
    });

    if (!differingKeys.length) {
      body.innerHTML = '<em>No differences found across selected rows.</em>';
      return;
    }

    const table = document.createElement('table');
    const head = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = '<th>Field</th>' + valid.map((v, i) => `<th>Selection ${i + 1}</th>`).join('');
    head.appendChild(trh);
    table.appendChild(head);

    const tbody = document.createElement('tbody');
    differingKeys.forEach((key) => {
      const tr = document.createElement('tr');
      const tds = [`<td><strong>${key}</strong></td>`].concat(valid.map((v) => `<td>${v.data[key] || ''}</td>`));
      tr.innerHTML = tds.join('');
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.innerHTML = '';
    body.appendChild(table);
  };


  const scheduleVacancyRefresh = () => {
    if (vacancyRefreshScheduled) return;
    vacancyRefreshScheduled = true;
    window.requestAnimationFrame(() => {
      vacancyRefreshScheduled = false;
      normalizeVacancyRowStriping();
      applyAgencyColumnMode();
      applyDeadlineStyling();
      ensureCompareColumn();
      wireTitleHoverPreview();
    });
  };

  const ensureCompareColumn = () => {
    if (!isVacancyTablePage()) return;
    const table = document.getElementById('vacancyTable');
    if (!table) return;

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('.tm-compare-header')) {
      const th = document.createElement('th');
      th.className = 'tm-compare-header';
      th.textContent = 'Compare';
      th.setAttribute('data-dt-order', 'disable');
      headerRow.insertBefore(th, headerRow.firstElementChild);
    }

    table.querySelectorAll('tbody tr').forEach((row) => {
      if (row.querySelector('.tm-compare-cell')) return;
      const titleLink = row.querySelector('td a[href*="vacancyDetailsView.cfm"]');
      const td = document.createElement('td');
      td.className = 'tm-compare-cell';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'tm-compare-checkbox';
      input.disabled = !titleLink;
      if (titleLink) {
        input.dataset.compareUrl = titleLink.href;
        input.checked = selectedCompareUrls.has(titleLink.href);
      }
      input.addEventListener('change', (event) => {
        const url = event.target.dataset.compareUrl;
        if (!url) return;
        if (event.target.checked) {
          if (selectedCompareUrls.size >= 3) {
            event.target.checked = false;
            return;
          }
          selectedCompareUrls.add(url);
        } else {
          selectedCompareUrls.delete(url);
        }
        updateComparisonOverlay();
      });
      td.appendChild(input);
      row.insertBefore(td, row.firstElementChild);
    });
  };

  const startStripeObserver = () => {
    if (stripeObserver) stripeObserver.disconnect();
    if (!enabled || !isVacancyTablePage()) return;
    normalizeVacancyRowStriping();
    applyAgencyColumnMode();
    applyDeadlineStyling();
    ensureCompareColumn();

    const tbody = document.querySelector('#vacancyTable tbody');
    if (!tbody) return;

    stripeObserver = new MutationObserver(() => {
      scheduleVacancyRefresh();
    });

    stripeObserver.observe(tbody, { childList: true, subtree: false });
  };

  const stopStripeObserver = () => {
    if (stripeObserver) {
      stripeObserver.disconnect();
      stripeObserver = null;
    }
  };

  const applyState = () => {
    if (enabled) {
      ensureStyle();
      retrySetLength();
      startLengthObserver();
      startStripeObserver();
      applyMobileNavState();
      applyAgencyColumnMode();
      applyDeadlineStyling();
      wireTitleHoverPreview();
      if (isVacancyTablePage()) {
        window.setTimeout(ensureGradeAscendingSort, 50);
      }
    } else {
      removeStyle();
      stopLengthObserver();
      stopStripeObserver();
      hidePreviewBox();
      const compare = document.getElementById(COMPARE_OVERLAY_ID);
      if (compare) compare.style.display = 'none';
      applyMobileNavState();
    }
  };

  insertSettingsEntryInNav();
  ensureSettingsModal();
  applyState();
  window.addEventListener('resize', applyMobileNavState);
})();
