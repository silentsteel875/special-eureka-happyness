// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Force Bootstrap)
// @namespace    https://pro.ai.ny.gov/
// @version      1.2.0
// @description  Forces the AI Pro app to re-bootstrap from the root once tokens are injected.
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
  const SYNC_KEY = 'tm_aipro_session_transfer';

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
      const syncSessionToStorage = () => {
        const msalKeys = Object.keys(sessionStorage).filter(key => key.includes('msal') || key.includes('login'));
        const hasAppUI = !!document.querySelector('textarea, [contenteditable="true"]');
        
        if (msalKeys.length > 0 && hasAppUI) {
          const sessionData = {};
          msalKeys.forEach(k => sessionData[k] = sessionStorage.getItem(k));
          
          localStorage.setItem(SYNC_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: sessionData
          }));
          
          setTimeout(() => window.close(), 1000);
        }
      };
      setInterval(syncSessionToStorage, 1000);
      return;
    }

    // --- IFRAME LOGIC ---
    if (window !== window.top) {
      window.addEventListener('storage', (event) => {
        if (event.key === SYNC_KEY && event.newValue) {
          try {
            const { data } = JSON.parse(event.newValue);
            console.log('[AI Pro Iframe] Auth found. Synchronizing and forcing bootstrap...');
            
            Object.keys(data).forEach(k => sessionStorage.setItem(k, data[k]));
            
            // Instead of reload(), force navigate to the root to restart the app
            // We add a "ts" param to bypass any cached error pages
            window.location.href = APP_ORIGIN + '/?auth_sync=' + Date.now();
          } catch (e) { console.error('Sync failed', e); }
        }
      });

      const errorObserver = new MutationObserver(() => {
        if (document.body.innerText.includes('Authentication Failed') || document.body.innerText.includes('redirect_in_iframe')) {
          // If we ALREADY have tokens, don't show the button, just force a reset
          if (Object.keys(sessionStorage).some(k => k.includes('msal'))) {
              window.location.href = APP_ORIGIN + '/?auth_retry=' + Date.now();
              return;
          }
          injectLoginButton();
          errorObserver.disconnect();
        }
      });
      errorObserver.observe(document.documentElement, { childList: true, subtree: true });

      function injectLoginButton() {
        const container = document.createElement('div');
        container.className = 'tm-login-container';
        container.innerHTML = `
          <h3 style="margin:0">AI Pro Restricted</h3>
          <p style="color:#666; font-size:14px; margin:10px 0 20px;">Side-panels require a secure login bridge.</p>
          <button class="tm-login-button">Authorize & Launch</button>
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
    iframe.allow = "popups; clipboard-write; clipboard-read";

    panel.appendChild(iframe);
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    toggle.onclick = () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && iframe.contentWindow) {
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
