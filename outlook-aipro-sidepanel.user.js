// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Final Sync)
// @namespace    https://pro.ai.ny.gov/
// @version      1.0.0
// @description  Uses aggressive storage heartbeats to ensure the sidepanel reloads and the popup closes.
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
  const SYNC_KEY = 'tm_aipro_auth_heartbeat';

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
      const monitorPopup = () => {
        // Detect if we are likely logged in:
        // 1. We see a textarea OR 2. The URL no longer contains login/auth keywords
        const hasInput = !!document.querySelector('textarea, [contenteditable="true"]');
        const isAuthUrl = window.location.href.includes('code=') || window.location.href.includes('state=') || window.location.href.includes('login');
        
        // If we have an input OR we are on the base app URL without auth strings...
        if (hasInput || (!isAuthUrl && window.location.pathname.length <= 1)) {
          console.log('[AI Pro Popup] Success detected. Pinging sidepanel.');
          localStorage.setItem(SYNC_KEY, Date.now().toString());
          
          // Give it a moment to ensure the sidepanel sees the storage event before closing
          setTimeout(() => {
              window.close();
          }, 1000);
        }
      };
      
      setInterval(monitorPopup, 1000);
      return;
    }

    // --- IFRAME LOGIC (Sidepanel) ---
    if (window !== window.top) {
      // Listen for the heartbeat from the popup
      window.addEventListener('storage', (event) => {
        if (event.key === SYNC_KEY) {
          console.log('[AI Pro Iframe] Heartbeat received. Refreshing...');
          window.location.reload();
        }
      });

      // Backup: check storage on a timer in case the 'storage' event misses
      let lastHeartbeat = localStorage.getItem(SYNC_KEY);
      setInterval(() => {
          const currentHeartbeat = localStorage.getItem(SYNC_KEY);
          if (currentHeartbeat && currentHeartbeat !== lastHeartbeat) {
              window.location.reload();
          }
      }, 2000);

      // Error screen override
      const errorObserver = new MutationObserver(() => {
        if (document.body.innerText.includes('Authentication Failed') || document.body.innerText.includes('redirect_in_iframe')) {
          injectLoginButton();
          errorObserver.disconnect();
        }
      });
      errorObserver.observe(document.documentElement, { childList: true, subtree: true });

      function injectLoginButton() {
        const container = document.createElement('div');
        container.className = 'tm-login-container';
        container.innerHTML = `
          <h3 style="margin:0">Authentication Required</h3>
          <p style="color:#666">Your session is restricted in the sidepanel.</p>
          <button class="tm-login-button">Unlock AI Pro</button>
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
      panel.classList.toggle('open');
    };
  };

  document.addEventListener('DOMContentLoaded', ensureUi);
  setInterval(ensureUi, 3000);
})();
