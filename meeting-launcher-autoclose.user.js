// ==UserScript==
// @name         Meeting Launcher Tab Auto-Close
// @namespace    http://tampermonkey.net/
// @version      2026-03-11
// @description  Shows a countdown and auto-closes meeting tabs, with a safe-kill fallback.
// @author       You
// @match        https://meetny-gov.webex.com/meetny-gov/*
// @match        https://meetny-gov.webex.com/webappng/sites/meetny-gov/meeting/info/*
// @match        https://teams.microsoft.com/dl/launcher/launcher.html*
// @grant        window.close
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Capture the pristine Tampermonkey close function before the page loads
    const tmClose = window.close;

    // Set to 15 seconds for testing; change back to 15 * 60 for the real 15 minutes!
    const COUNTDOWN_SECONDS = 15; 
    const STORAGE_KEY_CANCELLED = 'tm.meetingTabAutoClose.cancelled';
    const STORAGE_KEY_TAB_OPENED_AT = 'tm.meetingTabAutoClose.openedAt';

    if (sessionStorage.getItem(STORAGE_KEY_CANCELLED) === '1') {
        return;
    }

    const now = Date.now();
    const existingOpenedAt = Number(sessionStorage.getItem(STORAGE_KEY_TAB_OPENED_AT));
    const openedAt = Number.isFinite(existingOpenedAt) && existingOpenedAt > 0 ? existingOpenedAt : now;
    sessionStorage.setItem(STORAGE_KEY_TAB_OPENED_AT, String(openedAt));

    let remainingSeconds = Math.max(0, COUNTDOWN_SECONDS - Math.floor((now - openedAt) / 1000));
    let intervalId = null;

    function formatRemaining(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function attemptCloseTab() {
        // Attempt 1: Try the captured Tampermonkey close function
        try {
            tmClose();
        } catch (error) {}

        // Attempt 2: Try the standard close function
        try {
            window.close();
        } catch (error) {}

        // The Ultimate Fallback: If the browser refuses to close the tab, 
        // kill the page content to free up memory and stop background processes.
        setTimeout(() => {
            // Wipe the DOM to stop Webex/Teams scripts
            document.documentElement.innerHTML = `
                <head><title>Tab Disabled</title></head>
                <body style="background: #1a1a1a; color: #888; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: Arial, sans-serif;">
                    <div style="text-align: center;">
                        <h2 style="color: #ccc; margin-bottom: 8px;">Meeting Launched</h2>
                        <p>This tab has been automatically disabled to save resources.<br>You can safely close it manually.</p>
                    </div>
                </body>
            `;
            // Redirect to a blank page to fully terminate the session
            try {
                window.location.replace('about:blank');
            } catch (e) {}
        }, 1000);
    }

    function cancelAutoClose() {
        sessionStorage.setItem(STORAGE_KEY_CANCELLED, '1');
        if (intervalId) {
            clearInterval(intervalId);
        }
        const banner = document.querySelector('#tm-auto-close-banner');
        if (banner) {
            banner.remove();
        }
    }

    function createBanner() {
        const existing = document.querySelector('#tm-auto-close-banner');
        if (existing) {
            return existing;
        }

        const banner = document.createElement('div');
        banner.id = 'tm-auto-close-banner';
        banner.style.position = 'fixed';
        banner.style.top = '14px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.zIndex = '2147483647';
        banner.style.background = 'rgba(20, 20, 20, 0.96)';
        banner.style.color = '#fff';
        banner.style.padding = '12px 14px';
        banner.style.borderRadius = '12px';
        banner.style.fontFamily = 'Arial, sans-serif';
        banner.style.minWidth = '330px';
        banner.style.maxWidth = '90vw';
        banner.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.3)';

        const title = document.createElement('div');
        title.textContent = 'Meeting launch tab will be auto-closed';
        title.style.fontWeight = '700';
        title.style.marginBottom = '6px';

        const countdown = document.createElement('div');
        countdown.id = 'tm-auto-close-countdown';
        countdown.style.marginBottom = '10px';
        countdown.style.fontSize = '13px';

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '8px';

        const closeNowBtn = document.createElement('button');
        closeNowBtn.type = 'button';
        closeNowBtn.textContent = '✕ Close Now';
        closeNowBtn.style.padding = '6px 10px';
        closeNowBtn.style.border = 'none';
        closeNowBtn.style.borderRadius = '8px';
        closeNowBtn.style.cursor = 'pointer';
        closeNowBtn.style.background = '#2e7d32';
        closeNowBtn.style.color = '#fff';
        closeNowBtn.addEventListener('click', attemptCloseTab);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = '⊘ Cancel Auto-Close';
        cancelBtn.style.padding = '6px 10px';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '8px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.background = '#c53939';
        cancelBtn.style.color = '#fff';
        cancelBtn.addEventListener('click', cancelAutoClose);

        buttons.appendChild(closeNowBtn);
        buttons.appendChild(cancelBtn);

        banner.appendChild(title);
        banner.appendChild(countdown);
        banner.appendChild(buttons);

        document.body.appendChild(banner);
        return banner;
    }

    function updateCountdown() {
        const countdownNode = document.querySelector('#tm-auto-close-countdown');
        if (!countdownNode) {
            return;
        }
        countdownNode.textContent = `This tab will close in ${formatRemaining(remainingSeconds)} unless the user cancels.`;
    }

    function startCountdown() {
        createBanner();
        updateCountdown();

        if (remainingSeconds <= 0) {
            attemptCloseTab();
            return;
        }

        intervalId = window.setInterval(() => {
            const currentNow = Date.now();
            remainingSeconds = Math.max(0, COUNTDOWN_SECONDS - Math.floor((currentNow - openedAt) / 1000));

            if (remainingSeconds <= 0) {
                updateCountdown();
                clearInterval(intervalId);
                attemptCloseTab();
                return;
            }
            updateCountdown();
        }, 1000);
    }

    if (document.body) {
        startCountdown();
    } else {
        window.addEventListener('DOMContentLoaded', startCountdown, { once: true });
    }
})();
