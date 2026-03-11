// ==UserScript==
// @name         StateJobsNY responsive/full-width layout
// @namespace    https://statejobsny.com/
// @version      2.2.0
// @description  Makes StateJobsNY public and employee pages use the full viewport with an optional persistent on/off toggle.
// @author       You
// @match        https://statejobsny.com/public/*
// @match        https://statejobsny.com/employees/*
// @run-at       document-idle
// @grant        window.close
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tm-statejobsny-responsive-enabled';
  const STYLE_ID = 'tm-statejobsny-responsive';
  const TOGGLE_LI_ID = 'tm-statejobsny-responsive-toggle';
  const MOBILE_NAV_TOGGLE_ID = 'tm-statejobsny-mobile-nav-toggle';
  const PREVIEW_BOX_ID = 'tm-statejobsny-link-preview';

  const isEnabledFromStorage = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored !== 'off';
    } catch (_error) {
      return true;
    }
  };

  const saveEnabledToStorage = (enabled) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (_error) {
      // Ignore storage failures and keep runtime behavior.
    }
  };

  let enabled = isEnabledFromStorage();
  let defaultLengthApplied = false;
  let lengthObserver = null;
  let stripeObserver = null;
  let mobileNavCollapsed = false;

  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (style) {
      return style;
    }

    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html,
      body {
        width: 100% !important;
        max-width: none !important;
        overflow-x: hidden !important;
      }

      #leftShadow,
      #rightShadow,
      #bottomShadowLeft,
      #bottomShadowRight,
      #bottomInnerShadow {
        width: 100vw !important;
        max-width: 100vw !important;
        min-width: 0 !important;
        margin: 0 !important;
        overflow-x: clip !important;
        background-image: none !important;
      }

      #mainContent {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        padding: 0 clamp(12px, 2vw, 28px) 16px !important;

        display: grid !important;
        grid-template-columns: minmax(220px, 300px) minmax(0, 1fr) !important;
        grid-template-areas:
          "header header"
          "nav content"
          "organ organ"
          "footer footer" !important;
        column-gap: clamp(16px, 2vw, 32px) !important;
        align-items: start !important;
      }

      #header {
        grid-area: header;
        width: 100% !important;
        max-width: none !important;
        box-sizing: border-box !important;
      }

      #nav {
        grid-area: nav;
        float: none !important;
        width: auto !important;
        max-width: none !important;
        margin: 0 !important;
        box-sizing: border-box !important;
      }

      #content {
        grid-area: content;
        float: none !important;
        width: auto !important;
        max-width: none !important;
        margin: 0 !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
        overflow-wrap: anywhere !important;
      }

      #organDonor {
        grid-area: organ;
        width: 100% !important;
        max-width: none !important;
        box-sizing: border-box !important;
      }

      #footer {
        grid-area: footer;
        width: 100% !important;
        max-width: none !important;
        box-sizing: border-box !important;
      }

      img,
      video,
      iframe,
      table,
      select,
      input,
      textarea {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      #vacancyTable_wrapper,
      #vacancyTable_wrapper .dt-layout-cell {
        width: 100% !important;
        max-width: none !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      #vacancyTable_wrapper .dt-layout-table {
        overflow-x: hidden !important;
        display: flex !important;
        justify-content: center !important;
      }

      #vacancyTable {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        table-layout: auto !important;
      }

      #vacancyTable th,
      #vacancyTable td {
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        vertical-align: middle !important;
      }

      #vacancyTable tbody td {
        padding: 1px 3px !important;
      }

      /* Right-size narrow metadata columns to content so Title gets more room. */
      #vacancyTable th:nth-child(1),
      #vacancyTable td:nth-child(1),
      #vacancyTable th:nth-child(3),
      #vacancyTable td:nth-child(3),
      #vacancyTable th:nth-child(4),
      #vacancyTable td:nth-child(4),
      #vacancyTable th:nth-child(5),
      #vacancyTable td:nth-child(5),
      #vacancyTable th:nth-child(7),
      #vacancyTable td:nth-child(7) {
        width: 1% !important;
        white-space: nowrap !important;
        text-align: center !important;
      }

      #vacancyTable th:nth-child(2),
      #vacancyTable td:nth-child(2) {
        min-width: clamp(220px, 32vw, 620px) !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
      }

      #vacancyTable.tm-agency-wide th:nth-child(6),
      #vacancyTable.tm-agency-wide td:nth-child(6) {
        min-width: clamp(110px, 12vw, 170px) !important;
      }

      #vacancyTable.tm-agency-wide th:nth-child(2),
      #vacancyTable.tm-agency-wide td:nth-child(2) {
        min-width: clamp(240px, 30vw, 520px) !important;
      }

      #tm-statejobsny-mobile-nav-toggle {
        grid-area: nav;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 6px !important;
        width: 100% !important;
        max-width: 220px !important;
        margin: 8px 0 !important;
        padding: 6px 10px !important;
        border: 1px solid #b0b0b0 !important;
        border-radius: 4px !important;
        background: #eee !important;
        cursor: pointer !important;
        font-size: 13px !important;
        z-index: 2;
      }

      #tm-statejobsny-link-preview {
        position: fixed;
        z-index: 9999;
        width: min(560px, calc(100vw - 24px));
        max-height: min(70vh, 560px);
        overflow: auto;
        border: 1px solid #7a7a7a;
        background: #fff;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        padding: 10px;
        font-size: 13px;
        line-height: 1.35;
      }

      #tm-statejobsny-link-preview .tm-preview-header {
        margin: 0 0 10px;
        padding: 6px 8px;
        font-size: 14px;
        background: #e9e9e9;
        border: 1px solid #b8b8b8;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        cursor: move;
        user-select: none;
      }

      #tm-statejobsny-link-preview .tm-preview-header-title {
        font-weight: 700;
      }

      #tm-statejobsny-link-preview .tm-preview-close {
        border: 1px solid #888;
        background: #fff;
        border-radius: 3px;
        padding: 1px 8px;
        cursor: pointer;
        font-size: 12px;
        line-height: 1.2;
      }

      #tm-statejobsny-link-preview .tm-preview-tab-title {
        margin: 10px 0 6px;
        font-weight: 700;
        color: #1d1d1d;
        border-bottom: 1px solid #d0d0d0;
        padding-bottom: 2px;
      }

      #tm-statejobsny-link-preview .tm-preview-section-title {
        margin: 8px 0 4px;
        font-weight: 700;
        color: #011a77;
      }

      #tm-statejobsny-link-preview .tm-preview-section-content {
        margin: 0 0 8px;
      }

      #mainContent.tm-nav-collapsed {
        grid-template-columns: 44px minmax(0, 1fr) !important;
        column-gap: 10px !important;
      }

      #mainContent.tm-nav-collapsed #nav {
        display: block !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }

      @media (max-width: 980px) {
        #mainContent {
          grid-template-columns: minmax(0, 1fr) !important;
          grid-template-areas:
            "header"
            "nav"
            "content"
            "organ"
            "footer" !important;
          row-gap: 12px !important;
        }

      #mainContent.tm-nav-collapsed {
          grid-template-columns: minmax(0, 1fr) !important;
          column-gap: 0 !important;
        }

        #mainContent.tm-nav-collapsed #content {
          width: 100% !important;
          margin-left: 0 !important;
        }

        #tm-statejobsny-mobile-nav-toggle {
          max-width: 100% !important;
          margin-bottom: 2px !important;
        }

        #nav,
        #content {
          width: 100% !important;
        }

      }
    `;

    document.head.appendChild(style);
    return style;
  };

  const removeStyle = () => {
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
  };

  const setVacancyTablePageLengthTo100 = () => {
    if (!enabled || defaultLengthApplied) {
      return true;
    }

    const lengthSelect = document.querySelector('select[name="vacancyTable_length"], #vacancyTable_wrapper .dt-length select');
    if (!lengthSelect) {
      return false;
    }

    const has100Option = Array.from(lengthSelect.options).some((option) => option.value === '100');
    if (!has100Option) {
      defaultLengthApplied = true;
      return true;
    }

    if (lengthSelect.value !== '100') {
      lengthSelect.value = '100';
      lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    defaultLengthApplied = true;
    return true;
  };

  const retrySetLength = (remainingAttempts = 30) => {
    if (!enabled) {
      return;
    }

    const applied = setVacancyTablePageLengthTo100();
    if (!applied && remainingAttempts > 0) {
      window.setTimeout(() => retrySetLength(remainingAttempts - 1), 250);
    }
  };

  const startLengthObserver = () => {
    if (lengthObserver) {
      lengthObserver.disconnect();
    }

    lengthObserver = new MutationObserver(() => {
      if (!enabled || setVacancyTablePageLengthTo100()) {
        lengthObserver.disconnect();
      }
    });

    lengthObserver.observe(document.body, { childList: true, subtree: true });
  };

  const stopLengthObserver = () => {
    if (lengthObserver) {
      lengthObserver.disconnect();
      lengthObserver = null;
    }
  };

  const normalizeVacancyRowStriping = () => {
    if (!enabled) {
      return;
    }

    const rows = document.querySelectorAll('#vacancyTable tbody tr');
    if (!rows.length) {
      return;
    }

    rows.forEach((row, index) => {
      row.classList.remove('odd', 'even');
      row.classList.add(index % 2 === 0 ? 'odd' : 'even');
    });
  };

  const adjustAgencyColumnWidth = () => {
    const table = document.getElementById('vacancyTable');
    if (!table) {
      return;
    }

    const cells = table.querySelectorAll('tbody td:nth-child(6)');
    let shouldWiden = false;

    cells.forEach((cell) => {
      if (shouldWiden) {
        return;
      }

      const computed = window.getComputedStyle(cell);
      let lineHeight = Number.parseFloat(computed.lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        const fontSize = Number.parseFloat(computed.fontSize) || 16;
        lineHeight = fontSize * 1.2;
      }

      const lineCount = Math.round(cell.scrollHeight / lineHeight);
      if (lineCount >= 3) {
        shouldWiden = true;
      }
    });

    table.classList.toggle('tm-agency-wide', shouldWiden);

    if (shouldWiden) {
      const tableViewport = table.closest('.dt-layout-table');
      if (tableViewport && table.scrollWidth > tableViewport.clientWidth + 1) {
        table.classList.remove('tm-agency-wide');
      }
    }
  };

  const startStripeObserver = () => {
    if (stripeObserver) {
      stripeObserver.disconnect();
    }

    normalizeVacancyRowStriping();
    adjustAgencyColumnWidth();

    const tbody = document.querySelector('#vacancyTable tbody');
    if (!tbody) {
      return;
    }

    stripeObserver = new MutationObserver(() => {
      normalizeVacancyRowStriping();
      adjustAgencyColumnWidth();
      wireTitleHoverPreview();
    });

    stripeObserver.observe(tbody, {
      childList: true,
      subtree: false,
      attributes: true,
      attributeFilter: ['class'],
    });

    const table = document.querySelector('#vacancyTable');
    if (table) {
      table.addEventListener('click', () => {
        window.setTimeout(() => {
          normalizeVacancyRowStriping();
          adjustAgencyColumnWidth();
        }, 0);
      });
    }
  };

  const stopStripeObserver = () => {
    if (stripeObserver) {
      stripeObserver.disconnect();
      stripeObserver = null;
    }
  };


  const ensureMobileNavToggle = () => {
    let button = document.getElementById(MOBILE_NAV_TOGGLE_ID);
    if (button) {
      return button;
    }

    const nav = document.getElementById('nav');
    const content = document.getElementById('content');
    if (!nav || !content || !content.parentElement) {
      return null;
    }

    button = document.createElement('button');
    button.id = MOBILE_NAV_TOGGLE_ID;
    button.type = 'button';
    button.style.display = 'none';
    button.addEventListener('click', () => {
      const mainContent = document.getElementById('mainContent');
      if (!mainContent) {
        return;
      }
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
    if (!mainContent) {
      return;
    }

    const button = ensureMobileNavToggle();
    if (!button) {
      return;
    }

    if (!enabled) {
      button.style.display = 'none';
      mainContent.classList.remove('tm-nav-collapsed');
      button.textContent = '☰ >';
      button.setAttribute('aria-expanded', 'true');
      return;
    }

    button.style.display = 'inline-flex';
    mainContent.classList.toggle('tm-nav-collapsed', mobileNavCollapsed);
    button.textContent = mobileNavCollapsed ? '☰ >' : 'Collapse Left Navigation';
    button.setAttribute('aria-expanded', String(!mobileNavCollapsed));
  };

  const previewCache = new Map();
  let previewPinnedPosition = null;
  let previewIsDragging = false;

  const ensurePreviewBox = () => {
    let box = document.getElementById(PREVIEW_BOX_ID);
    if (box) {
      return box;
    }

    box = document.createElement('div');
    box.id = PREVIEW_BOX_ID;
    box.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'tm-preview-header';

    const title = document.createElement('div');
    title.className = 'tm-preview-header-title';
    title.textContent = 'Job Specifics Preview';

    const close = document.createElement('button');
    close.className = 'tm-preview-close';
    close.type = 'button';
    close.textContent = 'X';

    const body = document.createElement('div');
    body.className = 'tm-preview-body';

    header.appendChild(title);
    header.appendChild(close);
    box.appendChild(header);
    box.appendChild(body);

    const onMove = (event) => {
      if (!previewIsDragging) {
        return;
      }

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

    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', (event) => {
      if (event.target === close) {
        return;
      }
      previewIsDragging = true;
      const rect = box.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    close.addEventListener('click', () => {
      hidePreviewBox();
    });

    document.addEventListener('mousedown', (event) => {
      if (box.style.display === 'none') {
        return;
      }
      if (!box.contains(event.target)) {
        hidePreviewBox();
      }
    });

    document.body.appendChild(box);
    return box;
  };

  const hidePreviewBox = () => {
    const box = document.getElementById(PREVIEW_BOX_ID);
    if (box) {
      box.style.display = 'none';
      const body = box.querySelector('.tm-preview-body');
      if (body) {
        body.innerHTML = '';
      }
    }
  };

  const positionPreviewBox = (event) => {
    const box = document.getElementById(PREVIEW_BOX_ID);
    if (!box || box.style.display === 'none' || previewIsDragging) {
      return;
    }

    if (previewPinnedPosition) {
      box.style.left = `${previewPinnedPosition.left}px`;
      box.style.top = `${previewPinnedPosition.top}px`;
      return;
    }

    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boxRect = box.getBoundingClientRect();

    let left = event.clientX + 16;
    let top = event.clientY + 16;

    if (left + boxRect.width > vw - pad) {
      left = Math.max(pad, event.clientX - boxRect.width - 16);
    }

    if (top + boxRect.height > vh - pad) {
      top = Math.max(pad, vh - boxRect.height - pad);
    }

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    previewPinnedPosition = { left, top };
  };

  const extractSectionBlocks = (section, fallbackText) => {
    if (!section) {
      return `<em>${fallbackText}</em>`;
    }

    const blocks = [];
    const rows = section.querySelectorAll('p.row');

    rows.forEach((row) => {
      const left = row.querySelector('.leftCol');
      const right = row.querySelector('.rightCol');
      if (!left || !right) {
        return;
      }

      const leftClone = left.cloneNode(true);
      leftClone.querySelectorAll('.help, .colorTipContainer, .colorTip').forEach((n) => n.remove());
      const label = leftClone.textContent.replace(/\s+/g, ' ').trim();
      const content = right.innerHTML.trim();

      if (!label || !content) {
        return;
      }

      blocks.push(`<div class="tm-preview-section-title">${label}</div><div class="tm-preview-section-content">${content}</div>`);
    });

    if (!blocks.length) {
      const clone = section.cloneNode(true);
      clone.querySelectorAll('script, style').forEach((n) => n.remove());
      return clone.innerHTML.trim() || `<em>${fallbackText}</em>`;
    }

    return blocks.join('');
  };

  const extractJobSpecificsHtml = (htmlText) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const jobSpecifics = extractSectionBlocks(
      doc.querySelector('#jobspecifics'),
      'Job Specifics preview unavailable.'
    );

    const basics = extractSectionBlocks(
      doc.querySelector('#information'),
      'Basics preview unavailable.'
    );

    return `<div class="tm-preview-tab-title">Job Specifics</div>${jobSpecifics}<div class="tm-preview-tab-title">Basics</div>${basics}`;
  };

  const loadPreviewContent = async (url) => {
    if (previewCache.has(url)) {
      return previewCache.get(url);
    }

    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        return '<em>Preview could not be loaded.</em>';
      }

      const html = await response.text();
      const extracted = extractJobSpecificsHtml(html);
      previewCache.set(url, extracted);
      return extracted;
    } catch (_error) {
      return '<em>Preview could not be loaded.</em>';
    }
  };

  const wireTitleHoverPreview = () => {
    if (!enabled) {
      hidePreviewBox();
      return;
    }

    const links = document.querySelectorAll('#vacancyTable tbody td:nth-child(2) a');
    if (!links.length) {
      return;
    }

    const box = ensurePreviewBox();

    links.forEach((link) => {
      if (link.dataset.tmPreviewBound === '1') {
        return;
      }
      link.dataset.tmPreviewBound = '1';

      let hoverTimer = null;

      link.addEventListener('mouseenter', (event) => {
        if (!enabled) {
          return;
        }

        hoverTimer = window.setTimeout(async () => {
          const body = box.querySelector('.tm-preview-body');
          if (body) {
            body.innerHTML = '<em>Loading preview…</em>';
          }
          box.style.display = 'block';
          if (!previewPinnedPosition) {
            positionPreviewBox(event);
          }

          const content = await loadPreviewContent(link.href);
          if (box.style.display !== 'none' && body) {
            body.innerHTML = content;
            if (!previewPinnedPosition) {
              positionPreviewBox(event);
            }
          }
        }, 500);
      });

      link.addEventListener('mousemove', (event) => {
        positionPreviewBox(event);
      });

      link.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          window.clearTimeout(hoverTimer);
          hoverTimer = null;
        }
      });
    });
  };

  const ensureGradeAscendingSort = () => {
    if (!enabled) {
      return;
    }

    const gradeHeader = document.querySelector('#vacancyTable thead th:nth-child(3)');
    if (!gradeHeader) {
      return;
    }

    const sortState = gradeHeader.getAttribute('aria-sort');
    if (sortState === 'ascending') {
      return;
    }

    gradeHeader.click();
    window.setTimeout(() => {
      const afterFirstClick = gradeHeader.getAttribute('aria-sort');
      if (afterFirstClick !== 'ascending') {
        gradeHeader.click();
      }
    }, 80);
  };

  const applyState = () => {
    if (enabled) {
      ensureStyle();
      retrySetLength();
      startLengthObserver();
      startStripeObserver();
      applyMobileNavState();
      wireTitleHoverPreview();
      window.setTimeout(ensureGradeAscendingSort, 50);
    } else {
      removeStyle();
      stopLengthObserver();
      stopStripeObserver();
      hidePreviewBox();
      applyMobileNavState();
    }

    const checkbox = document.querySelector(`#${TOGGLE_LI_ID} input[type="checkbox"]`);
    if (checkbox) {
      checkbox.checked = enabled;
    }
  };

  const insertToggleInNav = () => {
    if (document.getElementById(TOGGLE_LI_ID)) {
      return;
    }

    const navList = document.querySelector('#nav > ul');
    if (!navList) {
      return;
    }

    const toggleLi = document.createElement('li');
    toggleLi.id = TOGGLE_LI_ID;
    toggleLi.className = 'localNavItem';

    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled;

    const text = document.createElement('span');
    text.textContent = 'Responsive layout';

    label.appendChild(checkbox);
    label.appendChild(text);
    toggleLi.appendChild(label);

    checkbox.addEventListener('change', () => {
      enabled = checkbox.checked;
      saveEnabledToStorage(enabled);
      defaultLengthApplied = false;
      applyState();
    });

    const otherListingsLink = Array.from(navList.querySelectorAll('a')).find((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return href.includes('/employees/offsitePostings.cfm');
    });

    const insertAfter = otherListingsLink ? otherListingsLink.closest('li') : navList.lastElementChild;
    if (insertAfter && insertAfter.parentElement === navList) {
      insertAfter.insertAdjacentElement('afterend', toggleLi);
    } else {
      navList.appendChild(toggleLi);
    }
  };

  insertToggleInNav();
  applyState();
  window.addEventListener('resize', applyMobileNavState);
})();
