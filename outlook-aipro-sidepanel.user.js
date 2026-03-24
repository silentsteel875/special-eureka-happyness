// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (Final Fix)
// @namespace    https://pro.ai.ny.gov/
// @version      0.6.0
// @description  Bypasses TrustedHTML and MSAL iframe restrictions via user-gestured popup.
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

  // =========================================================================
  // 1. IFRAME & POPUP LOGIC (Runs on pro.ai.ny.gov)
  // =========================================================================
  if (window.location.hostname === 'pro.ai.ny.gov') {
    
    // --- PART A: Handle returning from login popup ---
    const isAuthCallback = window.location.hash.includes('code=') || window.location.hash.includes('state=');
    if (window.opener && isAuthCallback) {
      window.opener.postMessage({ type: 'AI_PRO_AUTH_CALLBACK', url: window.location.href }, '*');
      window.stop();
      window.close();
      return;
    }

    // --- PART B: Catch MSAL Errors and show a "Real" Login Button ---
    // We listen for the error MSAL throws when it realizes it's in an iframe
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason;
      if (error && (error.errorCode === 'redirect_in_iframe' || String(error).includes('redirect_in_iframe'))) {
        console.warn(`${LOG_PREFIX} MSAL blocked redirect. Showing manual login button.`);
        showManualLoginUI();
        event.preventDefault();
      }
    });

    function showManualLoginUI() {
      // Avoid innerHTML to bypass "TrustedHTML" policy
      const container = document.createElement('div');
      Object.assign(container.style, {
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
        background: '#fff', textAlign: 'center', padding: '20px'
      });

      const msg = document.createElement('p');
      msg.textContent = "Sign-in required to use AI Pro in Outlook.";
      
      const btn = document.createElement('button');
      btn.textContent = "Sign In";
      Object.assign(btn.style, {
        padding: '12px 24px', background: '#005ea2', color: '#fff',
        border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
      });

      btn.onclick = () => {
        // This is a user-triggered gesture, so the popup won't be blocked!
        // We trigger the login by simply refreshing to the base URL which triggers the app's MSAL
        // But we intercept the next redirect attempt.
        window.open(window.location.href, 'aipro_auth_popup', 'width=600,height=700');
      };

      container.appendChild(msg);
      container.appendChild(btn);
      document.body.replaceChildren(container);
    }

    // Listen for the popup message to refresh the iframe
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'AI_PRO_AUTH_CALLBACK') {
        window.location.replace(event.data.url);
      }
    });

    return; 
  }

  // =========================================================================
  // 2. OUTLOOK UI LOGIC (Runs on outlook.office.com)
  // =========================================================================
  const ensureUi = () => {
    if (document.getElementById(PANEL_ID)) return;
    if (!document.body) return;

    // Inject Styles using DOM to be safe
    const style = document.createElement('style');
    style.textContent = `
      #${TOGGLE_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px; background: #005ea2; color: #fff; padding: 10px 14px; cursor: pointer; }
      #${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: 520px; height: calc(100vh - 24px); z-index: 2147483646; border: 1px solid #ccc; border-radius: 12px; background: #fff; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
      #${PANEL_ID}.open { display: flex; }
      #${IFRAME_ID} { flex-grow: 1; border: none; }
    `;
    document.head.appendChild(style);

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

    toggle.onclick = () => panel.classList.toggle('open');
  };

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi);
  } else {
    ensureUi();
  }
})();
