// ==UserScript==
// @name         Outlook AI Bridge - Identity Courier
// @namespace    https://pro.ai.ny.gov/
// @version      2.0.0
// @description  Sends Outlook Identity Token to PHP backend to bypass iframe blocks.
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://pro.ai.ny.gov/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const BACKEND_URL = 'https://pro.ai.ny.gov/verify-session.php';
    const IFRAME_ID = 'ai-pro-sidebar-iframe';

    /**
     * Step A: Grab the ID Token. 
     * In an O365 environment, we can often find the user's session hint 
     * or token in the global 'window' objects or by pinging MSAL.
     */
    async function getIdentityAndSync() {
        console.log("[Bridge] Attempting to sync identity with PHP backend...");

        // Note: In a real O365 env, you might use window.msalInstance.acquireTokenSilent()
        // For this POC, we grab the UPN (User Principal Name) as a hint.
        const upnHint = document.querySelector('[role="heading"]')?.textContent || "user@ny.gov"; 

        GM_xmlhttpRequest({
            method: "POST",
            url: BACKEND_URL,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ 
                identity_hint: upnHint,
                source: "outlook_sidebar"
            }),
            onload: function(response) {
                const data = JSON.parse(response.responseText);
                if (data.status === 'success') {
                    console.log("[Bridge] PHP Session established. Loading AI Pro...");
                    loadIframe();
                } else {
                    console.error("[Bridge] Backend validation failed.");
                }
            }
        });
    }

    function loadIframe() {
        const iframe = document.getElementById(IFRAME_ID);
        if (iframe) {
            // Because PHP set a Session Cookie, this loads ALREADY logged in!
            iframe.src = "https://pro.ai.ny.gov/dashboard";
        }
    }

    // Initialize UI and start the handshake
    // (Standard UI injection code from previous versions would go here)
    // ...
})();
