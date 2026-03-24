// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Storage Sync)
// @namespace    https://pro.ai.ny.gov/
// @version      0.9.0
// @description  Uses localStorage events to sync authentication between popup and sidepanel.
// @author       You
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://*.office.com/*
// @match        https://pro.ai.ny.gov/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-aipro-panel';
  const TOGGLE_ID = 'tm-aipro-toggle';
  const IFRAME_ID = 'tm-aipro-iframe';
  const APP_ORIGIN = 'https://pro.ai.ny.gov';
  const SYNC_KEY = 'tm_aipro_auth_sync';

  // 1. Inject UI Styles
  GM_addStyle(`
    .tm-login-container { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: sans-serif; background: #fff; text-align: center; padding: 30px; }
    .tm-login-button { padding: 14px 28px; background: #005ea2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 20px; font-size: 16px; }
    #${TOGGLE_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px; background: #005ea2; color: #fff; padding: 10px 14px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
    #${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: 520px; height: calc(100vh - 24px); z-index: 2147483646; border: 1px solid #ccc; border-radius: 12px; background: #fff; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
    #${PANEL_ID}.open { display: flex; }
    #${IFRAME_ID} { flex-grow: 1; border: none; }
  `);

  // =========================================================================
  // 1. AI PRO DOMAIN LOGIC (pro.ai.ny.gov)
  // =========================================================================
  if (window.location.hostname === 'pro.ai.ny.gov') {
    
    // --- POPUP LOGIC ---
    if (window.opener) {
      const notifyAndClose = () => {
        const isAppLoaded = !!document.querySelector('textarea') || window.location.hash.includes('code=');
        if (isAppLoaded) {
          console.log('[AI Pro] Login success. Updating storage sync.');
          // Update localStorage to trigger the 'storage' event in the iframe
          localStorage.setItem(SYNC_KEY, Date.now().toString());
          setTimeout(() => window.close(), 500);
        }
      };
      setInterval(notifyAndClose, 1000);
      return;
    }

    // --- IFRAME LOGIC ---
    if (window !== window.top) {
      // 1. Listen for the 'storage' event (Sync via LocalStorage)
      window.addEventListener('storage', (event) => {
        if (event.key === SYNC_KEY) {
          console.log('[AI Pro] Auth sync detected. Reloading...');
          window.location.reload();
        }
      });

      // 2. Watch for the app's error screen to show our manual button
      const errorObserver = new MutationObserver(() => {
        const bodyText = document.body.innerText;
        if (bodyText.includes('Authentication Failed') || bodyText.includes('redirect_in_iframe')) {
          injectLoginButton();
          errorObserver.disconnect();
        }
      });
      errorObserver.observe(document.documentElement, { childList: true, subtree: true });

      function injectLoginButton() {
        const container = document.createElement('div');
        container.className = 'tm-login-container';
        container.innerHTML = `
          <h3 style="margin:0">Sign-in Required</h3>
          <p style="color:#666">Click to authorize AI Pro for Outlook.</p>
          <button class="tm-login-button">Authorize Now</button>
        `;
        container.querySelector('button').onclick = () => {
          window.open(window.location.href, 'aipro_auth_popup', 'width=600,height=750');
        };
        document.body.replaceChildren(container);
      }
    }
    return;
  }

  // =========================================================================
  // 2. OUTLOOK DOMAIN LOGIC (outlook.office.com)
  // =========================================================================
  const ensureUi = () => {
    if (document.getElementById(PANEL_ID)) return;
    if (!document.body) return;

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.textContent = 'AI Pro';

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    
    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = APP_ORIGIN;
    iframe.allow = "popups; clipboard-write";

    panel.appendChild(iframe);
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    toggle.onclick = () => {
      const isOpen = panel.classList.toggle('open');
      if (isOpen && iframe.contentWindow) {
          // Send context
          const ctx = {
            subject: document.querySelector('[role="heading"]')?.textContent || '',
            selectedText: window.getSelection()?.toString() || ''
          };
          iframe.contentWindow.postMessage({ type: 'AI_PRO_CONTEXT_V1', payload: ctx }, APP_ORIGIN);
      }
    };
  };

  document.addEventListener('DOMContentLoaded', ensureUi);
  setInterval(ensureUi, 3000);

})();

