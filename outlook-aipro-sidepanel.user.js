    // ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (CSP Compliant)
// @namespace    https://pro.ai.ny.gov/
// @version      0.7.0
// @description  Bypasses strict CSP and MSAL iframe restrictions using CSS injection and DOM observation.
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

  // 1. CSS Injection - Using GM_addStyle to bypass page CSP
  const css = `
    .tm-login-container {
        height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; font-family: sans-serif;
        background: #fff; text-align: center; padding: 20px;
    }
    .tm-login-button {
        padding: 12px 24px; background: #005ea2; color: #fff;
        border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
        margin-top: 15px;
    }
    #${TOGGLE_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px; background: #005ea2; color: #fff; padding: 10px 14px; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
    #${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: 520px; height: calc(100vh - 24px); z-index: 2147483646; border: 1px solid #ccc; border-radius: 12px; background: #fff; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    #${PANEL_ID}.open { display: flex; }
    #${IFRAME_ID} { flex-grow: 1; border: none; }
  `;
  GM_addStyle(css);

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

    // --- PART B: Monitor for the "Authentication Failed" UI ---
    const observer = new MutationObserver(() => {
      // Check if the app's error message is visible
      if (document.body && (document.body.innerText.includes('Authentication Failed') || document.body.innerText.includes('redirect_in_iframe'))) {
        injectLoginButton();
        observer.disconnect(); // Stop looking once we've replaced it
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    function injectLoginButton() {
      console.info(`${LOG_PREFIX} Overriding app error UI with login button.`);
      
      const container = document.createElement('div');
      container.className = 'tm-login-container';

      const msg = document.createElement('h3');
      msg.textContent = "AI Pro Authentication";
      
      const subMsg = document.createElement('p');
      subMsg.textContent = "Please sign in to use this tool within Outlook.";

      const btn = document.createElement('button');
      btn.className = 'tm-login-button';
      btn.textContent = "Sign In Now";

      btn.onclick = () => {
        // Trigger the popup via user gesture
        window.open(window.location.href, 'aipro_auth_popup', 'width=600,height=700');
      };

      container.appendChild(msg);
      container.appendChild(subMsg);
      container.appendChild(btn);
      
      // Clear the body and inject our clean button
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

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.textContent = 'AI Pro';

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    
    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = APP_ORIGIN;
    iframe.allow = "popups; clipboard-write"; // Essential for MSAL

    panel.appendChild(iframe);
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    toggle.onclick = () => {
        panel.classList.toggle('open');
    };
  };

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi);
  } else {
    ensureUi();
  }
})();
