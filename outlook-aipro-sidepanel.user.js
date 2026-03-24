// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Token Injection)
// @namespace    https://pro.ai.ny.gov/
// @version      1.1.0
// @description  Bypasses MSAL session limits by mirroring tokens from popup to iframe.
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
    
    // --- POPUP LOGIC: Mirror Session to LocalStorage ---
    if (window.opener) {
      const syncSessionToStorage = () => {
        const msalKeys = Object.keys(sessionStorage).filter(key => key.includes('msal') || key.includes('login'));
        
        if (msalKeys.length > 0 && !!document.querySelector('textarea, [contenteditable="true"]')) {
          console.log('[AI Pro Popup] Found MSAL tokens. Mirroring to Iframe...');
          
          const sessionData = {};
          msalKeys.forEach(k => sessionData[k] = sessionStorage.getItem(k));
          
          // Write the entire session to a shared LocalStorage key
          localStorage.setItem(SYNC_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: sessionData
          }));
          
          setTimeout(() => window.close(), 800);
        }
      };
      setInterval(syncSessionToStorage, 1000);
      return;
    }

    // --- IFRAME LOGIC: Inject Mirror and Reload ---
    if (window !== window.top) {
      const handleSync = (event) => {
        if (event.key === SYNC_KEY && event.newValue) {
          try {
            const { data } = JSON.parse(event.newValue);
            console.log('[AI Pro Iframe] Injecting tokens into session...');
            
            // Inject all tokens from the popup into the iframe's session
            Object.keys(data).forEach(k => sessionStorage.setItem(k, data[k]));
            
            // Critical: Stop the current redirect loop and reload
            window.location.reload();
          } catch (e) { console.error('Sync failed', e); }
        }
      };

      window.addEventListener('storage', handleSync);

      // UI Intervention: Catch the error message and show our "Unlock" button
      const errorObserver = new MutationObserver(() => {
        const bodyText = document.body.innerText;
        if (bodyText.includes('Authentication Failed') || bodyText.includes('redirect_in_iframe')) {
          // Check if we already have tokens first
          if (Object.keys(sessionStorage).some(k => k.includes('msal'))) {
             // If we have tokens but still see an error, the app might just need one more refresh
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
          <h3 style="margin:0">Authentication Blocked</h3>
          <p style="color:#666; font-size:14px; margin-top:10px;">Microsoft prevents login inside side-panels. Click below to authorize securely.</p>
          <button class="tm-login-button">Authorize AI Pro</button>
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
