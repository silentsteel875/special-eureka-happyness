// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Auth Sync)
// @namespace    https://pro.ai.ny.gov/
// @version      0.8.0
// @description  Ensures the sidepanel refreshes automatically once the login popup succeeds.
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
  const LOG_PREFIX = '[AI Pro sidepanel]';

  // 1. CSS Injection
  GM_addStyle(`
    .tm-login-container { height: 100vh; display: flex; flex-direction: column; alignItems: center; justifyContent: center; font-family: sans-serif; background: #fff; text-align: center; padding: 40px; }
    .tm-login-button { padding: 14px 28px; background: #005ea2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 20px; font-size: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    #${TOGGLE_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px; background: #005ea2; color: #fff; padding: 10px 14px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
    #${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: 520px; height: calc(100vh - 24px); z-index: 2147483646; border: 1px solid #ccc; border-radius: 12px; background: #fff; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
    #${PANEL_ID}.open { display: flex; }
    #${IFRAME_ID} { flex-grow: 1; border: none; }
  `);

  // =========================================================================
  // 1. IFRAME & POPUP LOGIC (Runs on pro.ai.ny.gov)
  // =========================================================================
  if (window.location.hostname === 'pro.ai.ny.gov') {
    
    // --- PART A: Logic for the POPUP window ---
    if (window.opener) {
      const checkLoginStatus = () => {
        const hasTextarea = !!document.querySelector('textarea');
        const isAuthCallback = window.location.hash.includes('code=') || window.location.hash.includes('state=');

        if (hasTextarea || isAuthCallback) {
          console.info(`${LOG_PREFIX} Login detected in popup. Notifying sidepanel...`);
          window.opener.postMessage({ type: 'AI_PRO_AUTH_SUCCESS' }, '*');
          
          // If we see the textarea, the user is fully in. We can close.
          if (hasTextarea) {
             setTimeout(() => window.close(), 1000);
          }
        }
      };

      // Check every second for 10 seconds
      const timer = setInterval(checkLoginStatus, 1000);
      setTimeout(() => clearInterval(timer), 10000);
    }

    // --- PART B: Logic for the IFRAME (Sidepanel) ---
    if (window !== window.top && !window.opener) {
      // Listen for the "Success" message from the popup
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AI_PRO_AUTH_SUCCESS') {
          console.info(`${LOG_PREFIX} Auth success signal received. Reloading sidepanel.`);
          window.location.reload();
        }
      });

      // Watch for the error screen to show our manual button
      const errorObserver = new MutationObserver(() => {
        const text = document.body.innerText;
        if (text.includes('Authentication Failed') || text.includes('redirect_in_iframe')) {
          injectLoginButton();
          errorObserver.disconnect();
        }
      });
      errorObserver.observe(document.documentElement, { childList: true, subtree: true });

      function injectLoginButton() {
        const container = document.createElement('div');
        container.className = 'tm-login-container';
        container.innerHTML = `
          <h3 style="margin:0">AI Pro Session Expired</h3>
          <p style="color:#666">Click below to re-authenticate in a secure window.</p>
          <button class="tm-login-button">Sign In to AI Pro</button>
        `;
        
        container.querySelector('button').onclick = () => {
          window.open(window.location.href, 'aipro_auth_popup', 'width=600,height=750');
        };

        document.body.replaceChildren(container);
      }
    }

    // --- PART C: Standard Context Receiver (Applies Outlook data to textarea) ---
    const initReceiver = () => {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AI_PRO_CONTEXT_V1') {
          const ctx = event.data.payload;
          const textarea = document.querySelector('textarea');
          if (textarea && (!textarea.value || !textarea.value.includes('Outlook context:'))) {
            textarea.value = `Outlook context:\n- Subject: ${ctx.subject}\n- Selected: ${ctx.selectedText}\n\n`;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });
    };
    document.addEventListener('DOMContentLoaded', initReceiver);

    return; 
  }

  // =========================================================================
  // 2. OUTLOOK UI LOGIC (Runs on outlook.office.com)
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
        // Scrape context and send to iframe
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

