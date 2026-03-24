// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge
// @namespace    https://pro.ai.ny.gov/
// @version      0.2.0
// @description  Injects an Outlook Web AI Pro launcher panel that opens AI Pro in a top-level window and sends lightweight context.
// @author       You
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://*.office.com/*
// @run-at       document-idle
// @grant        none
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
  let launchedWindow = null;

  const ensureStyle = () => {
    if (!document.head) {
      return;
    }

    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
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

    document.head.appendChild(style);
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

  boot();
  startKeepAlive();
  console.info(`${LOG_PREFIX} initialized on ${window.location.hostname}`);
})();
