// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge
// @namespace    https://pro.ai.ny.gov/
// @version      0.2.0
// @description  Injects an Outlook Web AI Pro launcher panel that opens AI Pro in a top-level window and sends lightweight context.
// @author       You
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://*.office.com/*
// @match        https://pro.ai.ny.gov/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-aipro-panel';
  const TOGGLE_ID = 'tm-aipro-toggle';
  const OPEN_TAB_ID = 'tm-aipro-open-tab';
  const STYLE_ID = 'tm-aipro-style';
  const APP_ORIGIN = 'https://pro.ai.ny.gov';
  const APP_FALLBACK_URL = `${APP_ORIGIN}/`;
  const LAUNCH_ID = 'tm-aipro-launch';
  const LOG_PREFIX = '[AI Pro sidepanel]';
  const CONTEXT_STORAGE_KEY = 'tm-aipro-latest-outlook-context';
  let launchedWindow = null;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const css = `
      #${TOGGLE_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        border: 0;
        border-radius: 999px;
        background: #005ea2;
        color: #fff;
        font: 600 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        padding: 10px 14px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
      }

      #${PANEL_ID} {
        position: fixed;
        top: 12px;
        right: 12px;
        width: min(520px, calc(100vw - 24px));
        height: calc(100vh - 24px);
        z-index: 2147483646;
        border: 1px solid rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        overflow: hidden;
        background: #fff;
        display: none;
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.32);
      }

      #${PANEL_ID}.open { display: block; }

      #${PANEL_ID} .tm-aipro-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: #f1f4f8;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }

      #${PANEL_ID} .tm-aipro-toolbar button {
        border: 1px solid #b9c6d6;
        background: #fff;
        border-radius: 8px;
        padding: 6px 10px;
        font: 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        cursor: pointer;
      }

      #${PANEL_ID} .tm-aipro-toolbar .tm-spacer {
        margin-left: auto;
      }

      #${PANEL_ID} .tm-aipro-body {
        padding: 10px 12px 12px;
        font: 500 12px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #1f2937;
      }

      #${PANEL_ID} .tm-aipro-warning {
        background: #fff7ed;
        color: #9a3412;
        border: 1px solid #fed7aa;
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 8px;
      }

      #${PANEL_ID} .tm-aipro-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
    `;
    if (typeof GM_addStyle === 'function') {
      const styleNode = GM_addStyle(css);
      if (styleNode) {
        styleNode.id = STYLE_ID;
      }
      return;
    }

    console.warn(`${LOG_PREFIX} GM_addStyle unavailable; rendering without custom CSS.`);
  };

  const safeText = (value) => {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim();
  };

  const getContextPayload = () => {
    const subjectNode = document.querySelector('[role="heading"]');
    const subject = safeText(subjectNode && subjectNode.textContent);

    let selectedText = '';
    if (typeof window.getSelection === 'function') {
      selectedText = safeText(String(window.getSelection() || ''));
    }

    const composer = document.querySelector('[aria-label="Message body"], [aria-label="Message body, press Alt+F10 to exit"]');
    const composeText = safeText(composer && composer.textContent);
    const composeSnippet = composeText.slice(0, 2400);

    return {
      source: 'outlook-web',
      pageTitle: document.title,
      url: window.location.href,
      subject,
      selectedText,
      composeSnippet,
      capturedAt: new Date().toISOString()
    };
  };

  const postContextToFrame = () => {
    const context = getContextPayload();
    const encoded = encodeURIComponent(JSON.stringify(context));
    const url = `${APP_FALLBACK_URL}#ext_context=${encoded}`;

    if (launchedWindow && !launchedWindow.closed) {
      launchedWindow.location = url;
      launchedWindow.focus();
      return;
    }

    launchedWindow = window.open(url, 'aipro_window', 'noopener,noreferrer');
    if (!launchedWindow) {
      console.warn(`${LOG_PREFIX} popup blocked while launching AI Pro.`);
      return;
    }

    try {
      launchedWindow.name = JSON.stringify({ ext_context: context });
    } catch (_error) {
      // Ignore cross-window access errors.
    }

    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      try {
        if (!launchedWindow || launchedWindow.closed) {
          window.clearInterval(intervalId);
          return;
        }

        launchedWindow.postMessage(
          {
            type: 'AI_PRO_CONTEXT_V1',
            payload: context
          },
          APP_ORIGIN
        );
      } catch (_error) {
        // Ignore transient cross-origin timing errors while window initializes.
      }

      if (attempts >= 20) {
        window.clearInterval(intervalId);
      }
    }, 500);
  };

  const ensureUi = () => {
    if (document.getElementById(PANEL_ID) && document.getElementById(TOGGLE_ID)) {
      return;
    }

    if (!document.body) {
      return;
    }

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.textContent = 'AI Pro';

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;

    const toolbar = document.createElement('div');
    toolbar.className = 'tm-aipro-toolbar';

    const heading = document.createElement('strong');
    heading.textContent = 'AI Pro';

    const spacer = document.createElement('div');
    spacer.className = 'tm-spacer';

    const openTabButton = document.createElement('button');
    openTabButton.id = OPEN_TAB_ID;
    openTabButton.type = 'button';
    openTabButton.textContent = 'Open base tab';

    const launchButton = document.createElement('button');
    launchButton.id = LAUNCH_ID;
    launchButton.type = 'button';
    launchButton.textContent = 'Launch AI Pro';

    toolbar.appendChild(heading);
    toolbar.appendChild(spacer);
    toolbar.appendChild(openTabButton);

    const body = document.createElement('div');
    body.className = 'tm-aipro-body';
    const warning = document.createElement('div');
    warning.className = 'tm-aipro-warning';
    warning.textContent = 'Embedded iframe login is blocked by MSAL redirect-in-iframe policy. Use top-level launch.';

    const detail = document.createElement('div');
    detail.textContent = 'Launch opens AI Pro in a normal tab/window and includes Outlook context in URL hash.';

    const actions = document.createElement('div');
    actions.className = 'tm-aipro-actions';
    actions.appendChild(launchButton);

    body.appendChild(warning);
    body.appendChild(detail);
    body.appendChild(actions);

    panel.appendChild(toolbar);
    panel.appendChild(body);

    toggle.addEventListener('click', () => {
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        postContextToFrame();
      }
    });

    launchButton.addEventListener('click', () => {
      postContextToFrame();
    });

    openTabButton.addEventListener('click', () => {
      window.open(APP_FALLBACK_URL, '_blank', 'noopener,noreferrer');
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);
  };

  const boot = () => {
    ensureStyle();
    ensureUi();
  };

  const startKeepAlive = () => {
    window.setInterval(() => {
      ensureStyle();
      ensureUi();
    }, 2000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    document.addEventListener('DOMContentLoaded', startKeepAlive, { once: true });
    return;
  }

  const parseContextHash = () => {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#ext_context=')) {
      return null;
    }

    const raw = hash.slice('#ext_context='.length);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch (_error) {
      return null;
    }
  };

  const getLatestContextFromAnySource = () => {
    const fromHash = parseContextHash();
    if (fromHash) {
      return fromHash;
    }

    try {
      const named = JSON.parse(window.name || '{}');
      if (named && named.ext_context) {
        return named.ext_context;
      }
    } catch (_error) {
      // Ignore malformed window.name values.
    }

    try {
      const stored = window.sessionStorage.getItem(CONTEXT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (_error) {
      return null;
    }
  };

  const buildPromptFromContext = (context) => {
    if (!context) {
      return '';
    }

    return [
      'Outlook context:',
      `- Page: ${context.pageTitle || ''}`,
      `- URL: ${context.url || ''}`,
      `- Subject: ${context.subject || ''}`,
      `- Selected text: ${context.selectedText || ''}`,
      `- Compose snippet: ${context.composeSnippet || ''}`,
      `- Captured at: ${context.capturedAt || ''}`,
      '',
      'Please assist with this email context.'
    ].join('\n');
  };

  const applyContextToAiProInput = (context) => {
    if (!context) {
      return false;
    }

    const textarea = document.querySelector('textarea');
    if (!textarea) {
      return false;
    }

    const prompt = buildPromptFromContext(context);
    if (!prompt) {
      return false;
    }

    if (!textarea.value || textarea.value.indexOf('Outlook context:') === -1) {
      textarea.value = prompt;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return true;
  };

  const initAiProReceiver = () => {
    window.addEventListener('message', (event) => {
      if (
        event.origin !== 'https://outlook.office.com' &&
        event.origin !== 'https://outlook.office365.com' &&
        !event.origin.endsWith('.office.com')
      ) {
        return;
      }

      const data = event.data || {};
      if (data.type !== 'AI_PRO_CONTEXT_V1' || !data.payload) {
        return;
      }

      try {
        window.sessionStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(data.payload));
      } catch (_error) {
        // Ignore storage errors.
      }

      applyContextToAiProInput(data.payload);
      console.info(`${LOG_PREFIX} received Outlook context via postMessage.`);
    });

    const context = getLatestContextFromAnySource();
    if (!context) {
      return;
    }

    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (applyContextToAiProInput(context) || tries >= 20) {
        window.clearInterval(timer);
      }
    }, 500);
  };

  if (window.location.hostname === 'pro.ai.ny.gov') {
    initAiProReceiver();
    console.info(`${LOG_PREFIX} AI Pro receiver initialized.`);
    return;
  }

  boot();
  startKeepAlive();
  console.info(`${LOG_PREFIX} initialized on ${window.location.hostname}`);
})();
