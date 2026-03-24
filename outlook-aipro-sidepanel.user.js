// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge
// @namespace    https://pro.ai.ny.gov/
// @version      0.1.0
// @description  Injects a toggleable AI Pro sidepanel into Outlook Web and sends lightweight page context.
// @author       You
// @match        https://outlook.office.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-aipro-panel';
  const TOGGLE_ID = 'tm-aipro-toggle';
  const REFRESH_ID = 'tm-aipro-refresh';
  const OPEN_TAB_ID = 'tm-aipro-open-tab';
  const IFRAME_ID = 'tm-aipro-frame';
  const STYLE_ID = 'tm-aipro-style';
  const APP_ORIGIN = 'https://pro.ai.ny.gov';
  const APP_EMBED_URL = `${APP_ORIGIN}/embed`;
  const APP_FALLBACK_URL = `${APP_ORIGIN}/`;

  const ensureStyle = () => {
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

      #${PANEL_ID}.open {
        display: grid;
        grid-template-rows: auto 1fr;
      }

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

      #${IFRAME_ID} {
        width: 100%;
        height: 100%;
        border: 0;
        background: #fff;
      }
    `;

    document.head.appendChild(style);
  };

  const getContextPayload = () => {
    const subject = document.querySelector('[role="heading"]')?.textContent?.trim() || '';
    const selectedText = String(window.getSelection?.() || '').trim();
    const composer = document.querySelector('[aria-label="Message body"], [aria-label="Message body, press Alt+F10 to exit"]');
    const composeSnippet = composer?.textContent?.trim()?.slice(0, 2400) || '';

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
    const frame = document.getElementById(IFRAME_ID);
    if (!frame || !frame.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(
      {
        type: 'AI_PRO_CONTEXT_V1',
        payload: getContextPayload()
      },
      APP_ORIGIN
    );
  };

  const ensureUi = () => {
    if (document.getElementById(PANEL_ID) && document.getElementById(TOGGLE_ID)) {
      return;
    }

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.textContent = 'AI Pro';

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="tm-aipro-toolbar">
        <strong>AI Pro</strong>
        <div class="tm-spacer"></div>
        <button id="${REFRESH_ID}" type="button">Refresh context</button>
        <button id="${OPEN_TAB_ID}" type="button">Open in tab</button>
      </div>
      <iframe id="${IFRAME_ID}" src="${APP_EMBED_URL}" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    `;

    toggle.addEventListener('click', () => {
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        postContextToFrame();
      }
    });

    panel.querySelector(`#${REFRESH_ID}`)?.addEventListener('click', () => {
      postContextToFrame();
    });

    panel.querySelector(`#${OPEN_TAB_ID}`)?.addEventListener('click', () => {
      window.open(APP_FALLBACK_URL, '_blank', 'noopener,noreferrer');
    });

    const frame = panel.querySelector(`#${IFRAME_ID}`);
    frame?.addEventListener('load', () => {
      setTimeout(postContextToFrame, 300);
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);
  };

  const boot = () => {
    ensureStyle();
    ensureUi();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    return;
  }

  boot();
})();
