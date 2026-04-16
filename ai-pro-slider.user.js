// ==UserScript==
// @name         AI Pro - The Puppet Master (v6.2.0 IT Architect)
// @namespace    https://pro.ai.ny.gov/
// @version      6.2.0
// @description  Z-index menu fixes, universal menu closing, and IT-specific meeting templates.
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://outlook.cloud.microsoft/*
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const TARGET_APP_URL = 'https://pro.ai.ny.gov/';
    const PANEL_WIDTH = 450;
    const RETRACT_POS = -500;
    const CONTAINER_ID = 'ai-pro-sidebar-container';

    // UI Button IDs
    const TOGGLE_BTN_ID = 'ai-pro-toggle-btn';
    const REPLY_BTN_ID = 'ai-pro-reply-btn';
    const COMPOSE_BTN_ID = 'ai-pro-compose-btn';
    const MEETING_BTN_ID = 'ai-pro-meeting-btn';

    // ==========================================
    // --- TEXT EXTRACTION & SANITIZATION ---
    // ==========================================
    function getCleanEmailBody() {
        let selectedText = window.getSelection().toString();
        if (selectedText && selectedText.trim() !== "") return selectedText;

        const preciseBody = document.querySelector('#Item\\.MessageUniqueBody') || document.querySelector('[aria-label="Message body"]');
        if (preciseBody) return preciseBody.innerText;

        const readingPane = document.querySelector('[aria-label="Reading Pane"]');
        if (readingPane) {
            const clone = readingPane.cloneNode(true);
            const junkElements = clone.querySelectorAll('button, [role="button"], [role="toolbar"], [role="menu"], [role="tablist"], svg, img');
            junkElements.forEach(el => el.remove());
            return clone.innerText;
        }
        return null;
    }

    function sanitizeText(raw) {
        if (!raw) return "";
        return raw.replace(/[\uFFFC\uFFFD\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
                  .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "")
                  .replace(/\xA0/g, " ")
                  .replace(/\r\n|\r|\u2028|\u2029/g, "\n")
                  .replace(/[ \t]+/g, " ")
                  .replace(/^ +| +$/gm, "")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim();
    }

    // ==========================================
    // 1. DOMAIN ROUTING (Popup & Iframe Agents)
    // ==========================================
    if (window.location.hostname === 'pro.ai.ny.gov') {
        if (window.opener && window.top === window.self) {
            const scrapeInterval = setInterval(() => {
                const hasTokens = Object.keys(sessionStorage).some(k => k.toLowerCase().includes('accesstoken')) ||
                                  Object.keys(localStorage).some(k => k.toLowerCase().includes('accesstoken'));
                if (hasTokens) {
                    clearInterval(scrapeInterval);
                    const cache = { session: {}, local: {} };
                    for (let i = 0; i < sessionStorage.length; i++) cache.session[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
                    for (let i = 0; i < localStorage.length; i++) cache.local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
                    GM_setValue('ai_pro_msal_vault', JSON.stringify(cache));
                    setTimeout(() => window.close(), 1000);
                }
            }, 500);
        }

        if (window.top !== window.self) {
            let injectAttempts = 0;
            const injectInterval = setInterval(() => {
                const vault = GM_getValue('ai_pro_msal_vault');
                if (vault) {
                    clearInterval(injectInterval);
                    try {
                        const c = JSON.parse(vault);
                        Object.keys(c.session).forEach(k => sessionStorage.setItem(k, c.session[k]));
                        Object.keys(c.local).forEach(k => localStorage.setItem(k, c.local[k]));
                    } catch(e) {}
                } else if (++injectAttempts > 20) clearInterval(injectInterval);
            }, 500);

            window.addEventListener('load', () => {
                const prompt = GM_getValue('ai_pro_pending_prompt');
                if (!prompt) return;

                const typeInt = setInterval(() => {
                    const box = document.querySelector('textarea, [placeholder*="message" i], [placeholder*="ask" i]');
                    if (box) {
                        clearInterval(typeInt);
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                        setter.call(box, prompt);
                        box.dispatchEvent(new Event('input', { bubbles: true}));
                        GM_setValue('ai_pro_pending_prompt', '');
                    }
                }, 500);
            });
        }
        return;
    }

    // ==========================================
    // 2. OUTLOOK ORCHESTRATOR & UI
    // ==========================================
    function injectStyles() {
        if (document.getElementById('ai-pro-styles')) return;
        const style = document.createElement('style');
        style.id = 'ai-pro-styles';
        style.innerHTML = `
            @keyframes ai-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .ai-spinner { border: 4px solid #f3f2f1; border-top: 4px solid #005ea2; border-radius: 50%; width: 40px; height: 40px; animation: ai-spin 1s linear infinite; margin-bottom: 20px; }
            .ai-loader-container { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; z-index:10; padding: 20px; text-align: center; }
            .ai-status-text { font-family: 'Segoe UI', Tahoma, sans-serif; color: #323130; font-size: 14px; font-weight: 600; margin-bottom: 15px; }
            .ai-progress { width: 80%; height: 6px; border-radius: 3px; appearance: none; border: none; }
            .ai-progress::-webkit-progress-bar { background-color: #edebe9; border-radius: 3px; }
            .ai-progress::-webkit-progress-value { background-color: #005ea2; border-radius: 3px; transition: width 0.4s ease; }

            /* Dynamic Floating Action Buttons */
            .ai-fab-base { position: fixed; right: 20px; height: 40px; border-radius: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); transition: right 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1); z-index: 9999998; display: flex; align-items: center; white-space: nowrap; font-family: 'Segoe UI', Tahoma, sans-serif; }
            .ai-fab-base.ai-menu-open { z-index: 10000001; /* Bumps active menu to front */ }
            .ai-fab-text, .ai-fab-divider, .ai-fab-arrow { transition: opacity 0.2s, display 0.2s; }

            /* Specific Button Positions & Colors */
            .ai-btn-toggle { bottom: 20px; width: 140px; background: #005ea2; color: white; border: none; cursor: pointer; justify-content: center; font-weight: bold; font-size: 13px; z-index: 9999999; }
            .ai-btn-reply { bottom: 70px; width: 155px; background: #107c41; }
            .ai-btn-compose { bottom: 120px; width: 145px; background: #0078d4; }
            .ai-btn-meeting { bottom: 70px; width: 165px; background: #d83b01; }

            /* Split Button Architecture */
            .ai-split-main { background: none; border: none; color: white; cursor: pointer; flex-grow: 1; height: 100%; display: flex; align-items: center; justify-content: flex-start; padding: 0 0 0 15px; font-weight: bold; font-size: 13px; border-radius: 20px 0 0 20px; }
            .ai-split-main:hover { background: rgba(255,255,255,0.1); }
            .ai-fab-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.4); }
            .ai-fab-arrow { background: none; border: none; color: white; cursor: pointer; width: 35px; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 0 20px 20px 0; }
            .ai-fab-arrow:hover { background: rgba(0,0,0,0.1); }

            /* Un-Squish Logic (Only squish if NOT hovering) */
            .ai-collapsed:not(:hover) { width: 40px !important; border-radius: 50% !important; }
            .ai-collapsed:not(:hover) .ai-fab-text,
            .ai-collapsed:not(:hover) .ai-fab-divider,
            .ai-collapsed:not(:hover) .ai-fab-arrow { display: none !important; }
            .ai-collapsed:not(:hover) .ai-split-main { padding: 0; justify-content: center; border-radius: 50%; }

            /* Dropdown Menu */
            .ai-dropdown-menu { position: absolute; bottom: 45px; right: 0; background: white; border: 1px solid #e1dfdd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: none; flex-direction: column; overflow: hidden; width: 220px; z-index: 10000000; }
            .ai-tone-btn { padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; color: #323130; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f2f1; transition: background 0.2s; display: flex; align-items: center; gap: 10px; }
            .ai-tone-btn:last-child { border-bottom: none; }
            .ai-tone-btn:hover { background: #f3f2f1; }
        `;
        document.head.appendChild(style);
    }

    function syncUIPositions(isOpen) {
        const container = document.getElementById(CONTAINER_ID);
        const offset = isOpen ? PANEL_WIDTH + 20 : 20;

        if (container) container.style.right = isOpen ? "0px" : `${RETRACT_POS}px`;

        [TOGGLE_BTN_ID, REPLY_BTN_ID, COMPOSE_BTN_ID, MEETING_BTN_ID].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.right = `${offset}px`;
                if (isOpen) btn.classList.add('ai-collapsed');
                else btn.classList.remove('ai-collapsed');
            }
        });

        // Universal Menu Sweep: Close all dropdowns whenever the panel toggles (open or close)
        document.querySelectorAll('.ai-dropdown-menu').forEach(m => m.style.display = 'none');
        document.querySelectorAll('.ai-fab-base').forEach(b => b.classList.remove('ai-menu-open'));
    }

    // --- TEMPLATES & PROMPTS ---
    const COMPOSE_TEMPLATES = [
        { id: 'pm', icon: '📊', label: 'Status Update (PM)', prompt: 'a Project Status Update. Include sections for Current Progress, Blockers, and Next Steps.' },
        { id: 'arch', icon: '🏗️', label: 'Arch Proposal', prompt: 'a Technical Architecture Proposal. Keep it high-level but structured.' },
        { id: 'ba', icon: '📋', label: 'Req Sign-off (BA)', prompt: 'a Business Requirements Sign-off request for stakeholders.' },
        { id: 'dev', icon: '💻', label: 'Code Review Request', prompt: 'a Code Review Request for a fellow developer. Include placeholders for PR link and key changes.' },
        { id: 'mgr', icon: '📢', label: 'Team Update (Mgr)', prompt: 'a Team Update or Announcement. Keep the tone encouraging and professional.' },
        { id: 'sup', icon: '🔥', label: 'Incident Escalation', prompt: 'an Incident Escalation Notice. Needs to be concise, factual, and denote urgency.' }
    ];

    const MEETING_TEMPLATES = [
        { id: 'req', icon: '📋', label: 'Requirements Gathering (BA)', type: 'Business Requirements Gathering session' },
        { id: 'arch', icon: '📐', label: 'Architecture Review', type: 'Technical Architecture Review' },
        { id: 'sprint', icon: '🏃', label: 'Sprint Planning', type: 'Sprint Planning and Backlog Grooming' },
        { id: 'code', icon: '💻', label: 'Code Review Sync', type: 'Peer Code Review Sync' },
        { id: 'kickoff', icon: '🚀', label: 'Project Kickoff (PM)', type: 'Project Kickoff Meeting' },
        { id: 'rca', icon: '🔍', label: 'Incident Post-Mortem', type: 'Major Incident Post-Mortem (RCA)' },
        { id: 'gono', icon: '🚦', label: 'Go/No-Go Decision', type: 'Release Go/No-Go Decision Meeting' },
        { id: 'oneonone', icon: '🤝', label: '1:1 Supervisor Sync', type: '1:1 Supervisor / Direct Report Sync' }
    ];

    function dispatchPrompt(promptText) {
        GM_setValue('ai_pro_pending_prompt', promptText);
        const liveCont = document.getElementById(CONTAINER_ID);
        if (!liveCont) return;

        syncUIPositions(true);
        const iframe = liveCont.querySelector('iframe');
        const needsAuth = iframe && (!iframe.src || !iframe.src.includes('pro.ai.ny.gov'));

        if (needsAuth) {
            const w=500, h=600, l=(screen.width/2)-250, t=(screen.height/2)-300;
            const authWin = window.open(TARGET_APP_URL, 'AI_PRO_AUTH', `width=${w},height=${h},top=${t},left=${l}`);
            startAuthFlow(iframe, authWin);
        } else if (iframe) {
            iframe.src = iframe.src;
        }
    }

    // --- AUTH ORCHESTRATOR ---
    function startAuthFlow(iframeElement, win) {
        const loader = document.getElementById('ai-pro-loader');
        const spinner = document.getElementById('ai-pro-spinner');
        const status = document.getElementById('ai-pro-status');
        const prog = document.getElementById('ai-pro-progress');

        if (!loader || !status) return;

        loader.style.display = 'flex';
        iframeElement.style.opacity = '0';
        spinner.style.display = 'block';
        status.style.color = '#323130';

        const updateLoader = (msg, val) => { status.innerText = msg; prog.value = val; };
        updateLoader("Step 1 of 3: Opening secure popup...", 10);
        GM_setValue('ai_pro_msal_vault', '');

        if (!win) return updateLoader("⚠️ Popup Blocked! Please allow popups.", 0) || (spinner.style.display = 'none', status.style.color = '#d83b01');

        updateLoader("Step 2 of 3: Waiting for Microsoft Entra ID...", 30);
        let retries = 0;
        const poll = setInterval(() => {
            if (win.closed) {
                clearInterval(poll);
                const vault = GM_getValue('ai_pro_msal_vault');
                if (vault && vault.length > 10) {
                    updateLoader("Step 3 of 3: Loading AI Pro session...", 80);
                    iframeElement.src = TARGET_APP_URL;
                    setTimeout(() => updateLoader("Almost ready...", 95), 1000);
                    setTimeout(() => {
                        updateLoader("Ready!", 100);
                        setTimeout(() => { loader.style.display = 'none'; iframeElement.style.opacity = '1'; }, 400);
                    }, 2500);
                } else {
                    spinner.style.display = 'none'; status.style.color = '#d83b01'; updateLoader("⚠️ Authentication failed.", 0);
                }
            } else {
                retries++;
                if (retries % 4 === 0) updateLoader(`Step 2 of 3: Waiting... (Retry ${retries/4})`, 30 + Math.min(retries, 40));
                if (retries > 60) { clearInterval(poll); win.close(); spinner.style.display = 'none'; status.style.color = '#d83b01'; updateLoader("⚠️ Timeout.", 0); }
            }
        }, 500);
    }

    // --- FACTORY FOR SPLIT BUTTONS ---
    function buildSplitButton(id, cssClass, icon, label, mainAction, menuItems, menuAction) {
        if (document.getElementById(id)) return;
        const cont = document.createElement('div');
        cont.id = id;
        cont.className = `ai-fab-base ${cssClass}`;

        let menuHTML = menuItems.map(item => `<button class="ai-tone-btn" data-id="${item.id}">${item.icon} ${item.label}</button>`).join('');

        cont.innerHTML = `
            <button class="ai-split-main"><span style="font-size: 15px;">${icon}</span><span class="ai-fab-text" style="margin-left: 8px;">${label}</span></button>
            <div class="ai-fab-divider"></div>
            <button class="ai-fab-arrow">⏷</button>
            <div class="ai-dropdown-menu">${menuHTML}</div>
        `;
        document.body.appendChild(cont);

        cont.querySelector('.ai-split-main').onclick = (e) => { e.preventDefault(); mainAction(e); };

        cont.querySelector('.ai-fab-arrow').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const menu = cont.querySelector('.ai-dropdown-menu');
            const isOpening = menu.style.display !== 'flex';

            // Sweep all other menus closed and reset z-indexes
            document.querySelectorAll('.ai-dropdown-menu').forEach(m => m.style.display = 'none');
            document.querySelectorAll('.ai-fab-base').forEach(b => b.classList.remove('ai-menu-open'));

            if (isOpening) {
                menu.style.display = 'flex';
                cont.classList.add('ai-menu-open'); // Bump this button to the front
            }
        };

        cont.querySelectorAll('.ai-tone-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                cont.querySelector('.ai-dropdown-menu').style.display = 'none';
                cont.classList.remove('ai-menu-open');
                menuAction(btn.dataset.id, e);
            };
        });
    }

    function startOutlookInjection() {
        function checkUI() {
            // Context Aware Routing
            const isCalendar = window.location.pathname.includes('/calendar');
            const isMail = !isCalendar;

            let cont = document.getElementById(CONTAINER_ID);
            if (!cont) {
                injectStyles();
                cont = document.createElement('div');
                cont.id = CONTAINER_ID;
                cont.style.cssText = `position:fixed; top:0; right:${RETRACT_POS}px; width:${PANEL_WIDTH}px; height:100vh; background:#fff; box-shadow:-2px 0 10px rgba(0,0,0,0.1); z-index:999999; transition:right 0.3s ease; border-left:1px solid #e1dfdd;`;

                const loaderDiv = document.createElement('div');
                loaderDiv.innerHTML = `<div id="ai-pro-loader" class="ai-loader-container" style="display:none;"><div class="ai-spinner" id="ai-pro-spinner"></div><div id="ai-pro-status" class="ai-status-text">Initializing...</div><progress id="ai-pro-progress" class="ai-progress" max="100" value="0"></progress></div>`;
                cont.appendChild(loaderDiv);

                const iframe = document.createElement('iframe');
                iframe.id = 'ai-pro-iframe';
                iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
                iframe.style.cssText = "width:100%; height:100%; border:none; opacity:0; transition: opacity 0.4s ease;";
                cont.appendChild(iframe);
                document.body.appendChild(cont);

                // Global close for dropdowns when clicking anywhere else
                document.addEventListener('click', (e) => {
                    if (!e.target.closest('.ai-fab-base')) {
                        document.querySelectorAll('.ai-dropdown-menu').forEach(m => m.style.display = 'none');
                        document.querySelectorAll('.ai-fab-base').forEach(b => b.classList.remove('ai-menu-open'));
                    }
                });
            }

            // Base Toggle Button
            if (!document.getElementById(TOGGLE_BTN_ID)) {
                const b = document.createElement('button');
                b.id = TOGGLE_BTN_ID;
                b.className = 'ai-fab-base ai-btn-toggle';
                b.innerHTML = `<span style="color: #facc15; font-size: 16px; text-shadow: 0 0 5px rgba(250, 204, 21, 0.5);">✨</span><span class="ai-fab-text" style="margin-left: 8px;">ITS AI Pro</span>`;
                b.onclick = (e) => { e.preventDefault(); GM_setValue('ai_pro_pending_prompt', ''); const liveCont = document.getElementById(CONTAINER_ID); if(!liveCont) return; const isOpening = liveCont.style.right !== "0px"; syncUIPositions(isOpening); const iframe = liveCont.querySelector('iframe'); if (isOpening && iframe && (!iframe.src || !iframe.src.includes('pro.ai.ny.gov'))) { startAuthFlow(iframe, window.open(TARGET_APP_URL, 'AI_PRO_AUTH', 'width=500,height=600')); } };
                document.body.appendChild(b);
            }

            // Mail Tools
            buildSplitButton(REPLY_BTN_ID, 'ai-btn-reply', '📝', 'Auto-Reply',
                () => { let r = getCleanEmailBody(); if(!r) return alert("⚠️ Select email text first."); dispatchPrompt("Please draft a professional reply to:\n\n" + sanitizeText(r)); },
                [{id:'executive', icon:'📊', label:'Executive'}, {id:'friendly', icon:'👋', label:'Friendly'}, {id:'concise', icon:'✂️', label:'Concise'}],
                (id) => { let r = getCleanEmailBody(); if(!r) return alert("⚠️ Select email text first."); dispatchPrompt(`Please draft a ${id} reply to:\n\n${sanitizeText(r)}`); }
            );

            buildSplitButton(COMPOSE_BTN_ID, 'ai-btn-compose', '✏️', 'Compose',
                () => { dispatchPrompt("Please help me draft a professional email for a NYS ITS environment. Ask me for the specifics."); },
                COMPOSE_TEMPLATES,
                (id) => { const tmpl = COMPOSE_TEMPLATES.find(t => t.id === id); dispatchPrompt(`Please help me draft an email for a NYS ITS environment regarding: ${tmpl.prompt}\n\nPlease prompt me for the specific details.`); }
            );

            // Calendar Tools
            buildSplitButton(MEETING_BTN_ID, 'ai-btn-meeting', '📅', 'New Meeting',
                () => { dispatchPrompt("Please help me draft a meeting invitation. Ask me for the topic and attendees."); },
                MEETING_TEMPLATES,
                (id) => { const tmpl = MEETING_TEMPLATES.find(t => t.id === id); dispatchPrompt(`Please help me draft a meeting invitation for a ${tmpl.type}.\n\nPlease use the exact following structure:\n\n**Purpose:** [Draft purpose here based on meeting type]\n\n**Agenda:**\n* Intro / Background\n* Action Items\n* Next Steps\n\nPlease provide the draft and prompt me for any missing specific details.`); }
            );

            // Apply Context-Aware Visibility
            const replyBtn = document.getElementById(REPLY_BTN_ID);
            const compBtn = document.getElementById(COMPOSE_BTN_ID);
            const meetBtn = document.getElementById(MEETING_BTN_ID);

            if (replyBtn) replyBtn.style.display = isMail ? 'flex' : 'none';
            if (compBtn) compBtn.style.display = isMail ? 'flex' : 'none';
            if (meetBtn) meetBtn.style.display = isCalendar ? 'flex' : 'none';
        }
        setInterval(checkUI, 2000);
    }

    if (window.location.hostname.includes('outlook')) {
        const start = setInterval(() => { if (document.body) { clearInterval(start); startOutlookInjection(); } }, 100);
    }
})();
