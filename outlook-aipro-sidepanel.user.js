// ==UserScript==
// @name         Outlook Web + AI Pro sidepanel bridge (MSAL Intercept)
// @namespace    https://pro.ai.ny.gov/
// @version      0.5.0
// @description  Injects an Outlook panel, embeds AI Pro via iframe, and intercepts MSAL redirects to force a popup flow.
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
  const OPEN_TAB_ID = 'tm-aipro-open-tab';
  const STYLE_ID = 'tm-aipro-style';
  const IFRAME_ID = 'tm-aipro-iframe';
  const APP_ORIGIN = 'https://pro.ai.ny.gov';
  const APP_FALLBACK_URL = `${APP_ORIGIN}/`;
  const LOG_PREFIX = '[AI Pro sidepanel]';
  const CONTEXT_STORAGE_KEY = 'tm-aipro-latest-outlook-context';

  // =========================================================================
  // 1. AI PRO APP CONTEXT (Runs inside the iframe and popups)
  // =========================================================================
  if (window.location.hostname === 'pro.ai.ny.gov') {
    
    // --- POPUP HANDLER: If we are the returning auth popup ---
    const isAuthCallback = window.location.search.includes('code=') || window.location.hash.includes('code=') || window.location.hash.includes('state=');
    if (window.opener && isAuthCallback) {
      console.info(`${LOG_PREFIX} Auth popup returning. Sending token URL to iframe.`);
      // Send the URL with the auth hash back to the iframe
      window.opener.postMessage({ type: 'AI_PRO_AUTH_CALLBACK', url: window.location.href }, '*');
      // Stop the app from loading in the popup and close it
      window.stop(); 
      window.close();
      return; 
    }

    // --- IFRAME HANDLER: Intercept MSAL Redirects ---
    if (window !== window.top) {
      const originalAssign = window.location.assign;
      const originalReplace = window.location.replace;

      const handlePossibleRedirect = (url, originalMethod) => {
        if (typeof url === 'string' && (url.includes('login.microsoftonline.com') || url.includes('login.windows.net'))) {
          console.info(`${LOG_PREFIX} Intercepted MSAL redirect. Launching popup.`);
          
          // Show a waiting screen in the iframe
          const showWaiting = () => {
            if (document.body) {
              document.body.innerHTML = `
                <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;text-align:center;padding:20px;">
                  <h3>Authentication Required</h3>
                  <p>Please complete the login in the pop-up window.</p>
                </div>`;
            } else {
              window.requestAnimationFrame(showWaiting);
            }
          };
          showWaiting();

          // Open the MSAL login URL in a popup
          window.open(url, 'aipro_auth_popup', 'width=600,height=700,menubar=no,toolbar=no');
          return; // Block the iframe from navigating and crashing
        }
        return originalMethod.call(window.location, url);
      };

      // Monkey-patch the navigation methods
      window.location.assign = function(url) { return handlePossibleRedirect(url, originalAssign); };
      window.location.replace = function(url) { return handlePossibleRedirect(url, originalReplace); };

      // Listen for the popup to send the auth URL back
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AI_PRO_AUTH_CALLBACK' && event.data.url) {
          console.info(`${LOG_PREFIX} Received auth callback URL from popup. Applying to iframe.`);
          // Replace the iframe's URL so MSAL picks up the tokens
          window.location.replace(event.data.url);
        }
      });
    }

    // --- STANDARD RECEIVER: Apply Outlook context to textarea ---
    const initAiProReceiver = () => {
      const applyContextToAiProInput = (context) => {
        if (!context) return false;
        const textarea = document.querySelector('textarea');
        if (!textarea) return false;
        
        const prompt = [
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

        if (!textarea.value || textarea.value.indexOf('Outlook context:') === -1) {
          textarea.value = prompt;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      };

      const observeTextareaForContext = (context) => {
        let done = false;
        const tryApply = () => {
          if (done) return;
          if (applyContextToAiProInput(context)) {
            done = true;
            console.info(`${LOG_PREFIX} applied Outlook context into AI Pro textarea.`);
          }
        };

        tryApply();
        const observer = new MutationObserver(() => tryApply());
        observer.observe(document.documentElement, { subtree: true, childList: true });
        window.setTimeout(() => observer.disconnect(), 60000);
      };

      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AI_PRO_CONTEXT_V1' && event.data.payload) {
          try { window.sessionStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(event.data.payload)); } catch (_e) {}
          observeTextareaForContext(event.data.payload);
        }
      });

      try {
        const stored = window.sessionStorage.getItem(CONTEXT_STORAGE_KEY);
        if (stored) observeTextareaForContext(JSON.parse(stored));
      } catch (_e) {}
    };

    // Wait for the DOM to load before initializing the receiver
    document.addEventListener('DOMContentLoaded', initAiProReceiver);
    return; // Stop script execution here for pro.ai.ny.gov
  }

  // =========================================================================
  // 2. OUTLOOK WEB CONTEXT (Runs on the parent window)
  // =========================================================================
  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${TOGGLE_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px; background: #005ea2; color: #fff; font: 600 13px/1 system-ui, sans-serif; padding: 10px 14px; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.28); }
      #${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: min(520px, calc(100vw - 24px)); height: calc(100vh - 24px); z-index: 2147483646; border: 1px solid rgba(0,0,0,0.2); border-radius: 12px; overflow: hidden; background: #fff; display: none; box-shadow: 0 14px 32px rgba(0,0,0,0.32); flex-direction: column; }
      #${PANEL_ID}.open { display: flex; }
      #${PANEL_ID} .tm-aipro-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px; background: #f1f4f8; border-bottom: 1px solid rgba(0,0,0,0.12); flex-shrink: 0; }
      #${PANEL_ID} .tm-aipro-toolbar button { border: 1px solid #b9c6d6; background: #fff; border-radius: 8px; padding: 6px 10px; font: 500 12px/1.2 system-ui, sans-serif; cursor: pointer; }
      #${PANEL_ID} .tm-aipro-toolbar .tm-spacer { margin-left: auto; }
      #${PANEL_ID} .tm-aipro-body { flex-grow: 1; width: 100%; height: 100%; padding: 0; }
      #${IFRAME_ID} { width: 100%; height: 100%; border: none; display: block; }
    `;
    if (typeof GM_addStyle === 'function') {
      const styleNode = GM_addStyle(css);
      if (styleNode) styleNode.id = STYLE_ID;
    }
  };

  const getContextPayload = () => {
    const safeText = (v) => (typeof v !== 'string' ? '' : v.trim());
    const subjectNode = document.querySelector('[role="heading"]');
    const composer = document.querySelector('[aria-label="Message body"], [aria-label="Message body, press Alt+F10 to exit"]');
    
    return {
      source: 'outlook-web',
      pageTitle: document.title,
      url: window.location.href,
      subject: safeText(subjectNode?.textContent),
      selectedText: safeText(String(window.getSelection?.() || '')),
      composeSnippet: safeText(composer?.textContent).slice(0, 2400),
      capturedAt: new Date().toISOString()
    };
  };

  const postContextToFrame = () => {
    const iframe = document.getElementById(IFRAME_ID);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'AI_PRO_CONTEXT_V1', payload: getContextPayload() }, APP_ORIGIN);
    }
  };

  const ensureUi = () => {
    if (document.getElementById(PANEL_ID)) return;

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.textContent = 'AI Pro';

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;

    const toolbar = document.createElement('div');
    toolbar.className = 'tm-aipro-toolbar';
    toolbar.innerHTML = '<strong>AI Pro</strong><div class="tm-spacer"></div><button id="tm-aipro-open-tab">Open base tab</button>';

    const body = document.createElement('div');
    body.className = 'tm-aipro-body';
    
    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = APP_FALLBACK_URL;
    iframe.allow = 'popups; clipboard-read; clipboard-write'; 
    
    body.appendChild(iframe);
    panel.appendChild(toolbar);
    panel.appendChild(body);

    toggle.addEventListener('click', () => {
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen) postContextToFrame();
    });

    iframe.addEventListener('load', () => {
      if (panel.classList.contains('open')) postContextToFrame();
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    document.getElementById('tm-aipro-open-tab').addEventListener('click', () => {
      window.open(APP_FALLBACK_URL, '_blank', 'noopener,noreferrer');
    });
  };

  const boot = () => {
    ensureStyle();
    ensureUi();
    window.setInterval(() => { ensureStyle(); ensureUi(); }, 2000);
  };

  // Wait for the Outlook DOM to load before injecting UI
  document.addEventListener('DOMContentLoaded', boot);

})();
