// ==UserScript==
// @name         AI Pro - The Puppet Master (v7.2.0 Contextual SDK)
// @namespace    https://pro.ai.ny.gov/
// @version      7.2.0
// @description  Pure Heist SDK with animated, context-aware dynamic stacking buttons.
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://outlook.cloud.microsoft/*
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @updateURL    https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ai-pro-slider.user.js
// @downloadURL  https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ai-pro-slider.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================================================
    // PART 0: THE DOMAIN AGENTS (Runs inside pro.ai.ny.gov to handle MSAL tokens)
    // ==========================================================================
    if (window.location.hostname === 'pro.ai.ny.gov') {
        if (window.opener && window.top === window.self) {
            console.log("👻 [Popup] Searching for MSAL tokens...");
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

    // ==========================================================================
    // PART 1: THE CORE SDK (AIProBridge Class - Pure Heist)
    // ==========================================================================
    class AIProBridge {
        constructor(options = {}) {
            this.targetUrl = options.targetUrl || 'https://pro.ai.ny.gov/';
            this.panelWidth = options.panelWidth || 450;
            this.containerId = 'ai-pro-sdk-container';
            this.isOpen = false;
            
            this.storeData = options.storageSetter || function(k, v) { localStorage.setItem(k, v); };
            this.getData = options.storageGetter || function(k) { return localStorage.getItem(k); };
            this.onStateChange = options.onStateChange || function(isOpen) {};

            this._init();
        }

        _init() {
            if (document.getElementById(this.containerId)) return;
            this._injectStyles();
            this._buildDOM();
        }

        needsAuth() {
            const iframe = document.getElementById('ai-pro-sdk-iframe');
            return iframe && (!iframe.src || !iframe.src.includes(new URL(this.targetUrl).hostname));
        }

        getAuthWindow() {
            const w=500, h=600, l=(screen.width/2)-250, t=(screen.height/2)-300;
            return window.open(this.targetUrl, 'AI_PRO_AUTH', `width=${w},height=${h},top=${t},left=${l}`);
        }

        toggle(authWin = null) {
            this.isOpen ? this.close() : this.open(authWin);
        }

        open(authWin = null) {
            this.isOpen = true;
            const cont = document.getElementById(this.containerId);
            if (cont) cont.style.right = "0px";
            this.onStateChange(true);

            if (this.needsAuth()) {
                this._startAuthFlow(document.getElementById('ai-pro-sdk-iframe'), authWin);
            }
        }

        close() {
            this.isOpen = false;
            const cont = document.getElementById(this.containerId);
            if (cont) cont.style.right = `-${this.panelWidth + 50}px`;
            this.onStateChange(false);
        }

        sendPrompt(promptText, authWin = null) {
            this.storeData('ai_pro_pending_prompt', promptText);
            this.open(authWin);
            const iframe = document.getElementById('ai-pro-sdk-iframe');
            if (!this.needsAuth() && iframe) iframe.src = iframe.src; 
        }

        _injectStyles() {
            if (document.getElementById('ai-pro-sdk-styles')) return;
            const style = document.createElement('style');
            style.id = 'ai-pro-sdk-styles';
            style.innerHTML = `
                @keyframes sdk-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .sdk-spinner { border: 4px solid #f3f2f1; border-top: 4px solid #005ea2; border-radius: 50%; width: 40px; height: 40px; animation: sdk-spin 1s linear infinite; margin-bottom: 20px; }
                .sdk-loader-container { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; z-index:10; padding: 20px; text-align: center; }
                .sdk-status-text { font-family: 'Segoe UI', Tahoma, sans-serif; color: #323130; font-size: 14px; font-weight: 600; margin-bottom: 15px; }
                .sdk-progress { width: 80%; height: 6px; border-radius: 3px; appearance: none; border: none; }
                .sdk-progress::-webkit-progress-bar { background-color: #edebe9; border-radius: 3px; }
                .sdk-progress::-webkit-progress-value { background-color: #005ea2; border-radius: 3px; transition: width 0.4s ease; }
            `;
            document.head.appendChild(style);
        }

        _buildDOM() {
            const cont = document.createElement('div');
            cont.id = this.containerId;
            cont.style.cssText = `position:fixed; top:0; right:-${this.panelWidth + 50}px; width:${this.panelWidth}px; height:100vh; background:#fff; box-shadow:-2px 0 10px rgba(0,0,0,0.1); z-index:999999; transition:right 0.3s ease; border-left:1px solid #e1dfdd;`;
            
            const loaderDiv = document.createElement('div');
            loaderDiv.innerHTML = `<div id="sdk-loader" class="sdk-loader-container" style="display:none;"><div class="sdk-spinner" id="sdk-spinner"></div><div id="sdk-status" class="sdk-status-text">Initializing...</div><progress id="sdk-progress" class="sdk-progress" max="100" value="0"></progress></div>`;
            cont.appendChild(loaderDiv);

            const iframe = document.createElement('iframe');
            iframe.id = 'ai-pro-sdk-iframe';
            iframe.setAttribute('allow', 'clipboard-read; clipboard-write'); 
            iframe.style.cssText = "width:100%; height:100%; border:none; opacity:0; transition: opacity 0.4s ease;";
            cont.appendChild(iframe);
            
            document.body.appendChild(cont);
        }

        // --- PURE HEIST AUTH ---
        _startAuthFlow(iframeElement, win) {
            const loader = document.getElementById('sdk-loader');
            const spinner = document.getElementById('sdk-spinner');
            const status = document.getElementById('sdk-status');
            const prog = document.getElementById('sdk-progress');

            if (!loader || !status) return;

            loader.style.display = 'flex';
            iframeElement.style.opacity = '0';
            spinner.style.display = 'block';
            status.style.color = '#323130'; 

            const updateLoader = (msg, val) => { status.innerText = msg; prog.value = val; };
            updateLoader("Step 1 of 3: Opening secure popup...", 10);
            this.storeData('ai_pro_msal_vault', ''); 

            if (!win) return updateLoader("⚠️ Popup Blocked! Please allow popups.", 0) || (spinner.style.display = 'none', status.style.color = '#d83b01');

            updateLoader("Step 2 of 3: Waiting for Microsoft Entra ID...", 30);
            let retries = 0;
            const poll = setInterval(() => {
                if (win.closed) {
                    clearInterval(poll);
                    const vault = this.getData('ai_pro_msal_vault');
                    if (vault && vault.length > 10) { 
                        updateLoader("Step 3 of 3: Loading AI session...", 80);
                        iframeElement.src = this.targetUrl; 
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
    }

    // ==========================================================================
    // PART 2: THE CONSUMER APPLICATION (Outlook Implementation)
    // ==========================================================================
    
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
        return raw.replace(/[\uFFFC\uFFFD\u200B-\u200F\u202A-\u202E\uFEFF]/g, "").replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "").replace(/\xA0/g, " ").replace(/\r\n|\r|\u2028|\u2029/g, "\n").replace(/[ \t]+/g, " ").replace(/^ +| +$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    }

    const BTNS = { TOGGLE: 'app-btn-toggle', REPLY: 'app-btn-reply', COMPOSE: 'app-btn-compose', MEETING: 'app-btn-meeting' };

    const COMPOSE_TEMPLATES = [
        { id: 'pm', icon: '📊', label: 'Status Update (PM)', prompt: 'a Project Status Update. Include sections for Current Progress, Blockers, and Next Steps.' },
        { id: 'arch', icon: '🏗️', label: 'Arch Proposal', prompt: 'a Technical Architecture Proposal. Keep it high-level but structured.' },
        { id: 'ba', icon: '📋', label: 'Req Sign-off (BA)', prompt: 'a Business Requirements Sign-off request for stakeholders.' },
        { id: 'dev', icon: '💻', label: 'Code Review Request', prompt: 'a Code Review Request for a fellow developer. Include placeholders for PR link and key changes.' },
        { id: 'mgr', icon: '📢', label: 'Team Update (Mgr)', prompt: 'a Team Update or Announcement. Keep the tone encouraging and professional.' },
        { id: 'sup', icon: '🔥', label: 'Incident Escalation', prompt: 'an Incident Escalation Notice. Needs to be concise, factual, and denote urgency.' }
    ];

    const MEETING_TEMPLATES = [
        { id: 'req', icon: '📋', label: 'Req Gathering (BA)', type: 'Business Requirements Gathering session' },
        { id: 'arch', icon: '📐', label: 'Arch Review', type: 'Technical Architecture Review' },
        { id: 'sprint', icon: '🏃', label: 'Sprint Planning', type: 'Sprint Planning and Backlog Grooming' },
        { id: 'code', icon: '💻', label: 'Code Review Sync', type: 'Peer Code Review Sync' },
        { id: 'kickoff', icon: '🚀', label: 'Project Kickoff (PM)', type: 'Project Kickoff Meeting' },
        { id: 'rca', icon: '🔍', label: 'Incident RCA', type: 'Major Incident Post-Mortem (RCA)' },
        { id: 'gono', icon: '🚦', label: 'Go/No-Go Decision', type: 'Release Go/No-Go Decision Meeting' },
        { id: 'oneonone', icon: '🤝', label: '1:1 Sync', type: '1:1 Supervisor / Direct Report Sync' }
    ];

    let sdk; 

    function initHostApp() {
        sdk = new AIProBridge({
            storageSetter: (k, v) => GM_setValue(k, v),
            storageGetter: (k) => GM_getValue(k),
            onStateChange: (isOpen) => {
                const offset = isOpen ? 450 + 20 : 20;
                Object.values(BTNS).forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.right = `${offset}px`;
                        isOpen ? btn.classList.add('app-collapsed') : btn.classList.remove('app-collapsed');
                    }
                });
                document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
                document.querySelectorAll('.app-fab-base').forEach(b => b.classList.remove('app-menu-open'));
            }
        });

        if (!document.getElementById('app-host-styles')) {
            const style = document.createElement('style');
            style.id = 'app-host-styles';
            style.innerHTML = `
                .app-fab-base { position: fixed; right: 20px; height: 40px; border-radius: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 9999998; display: flex; align-items: center; white-space: nowrap; font-family: 'Segoe UI', Tahoma, sans-serif; transform-origin: right center; transition: right 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1), bottom 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease; }
                .app-fab-base.app-menu-open { z-index: 10000001; }
                .app-fab-hidden { transform: scale(0) !important; opacity: 0 !important; pointer-events: none !important; }
                .app-fab-text, .app-fab-divider, .app-fab-arrow { transition: opacity 0.2s, display 0.2s; }
                .app-btn-toggle { width: 140px; background: #005ea2; color: white; border: none; cursor: pointer; justify-content: center; font-weight: bold; font-size: 13px; z-index: 9999999; }
                .app-btn-reply { width: 155px; background: #107c41; }
                .app-btn-compose { width: 145px; background: #0078d4; }
                .app-btn-meeting { width: 165px; background: #d83b01; }
                .app-split-main { background: none; border: none; color: white; cursor: pointer; flex-grow: 1; height: 100%; display: flex; align-items: center; justify-content: flex-start; padding: 0 0 0 15px; font-weight: bold; font-size: 13px; border-radius: 20px 0 0 20px; }
                .app-split-main:hover { background: rgba(255,255,255,0.1); }
                .app-fab-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.4); }
                .app-fab-arrow { background: none; border: none; color: white; cursor: pointer; width: 35px; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 0 20px 20px 0; }
                .app-fab-arrow:hover { background: rgba(0,0,0,0.1); }
                .app-collapsed:not(:hover) { width: 40px !important; border-radius: 50% !important; }
                .app-collapsed:not(:hover) .app-fab-text, .app-collapsed:not(:hover) .app-fab-divider, .app-collapsed:not(:hover) .app-fab-arrow { display: none !important; }
                .app-collapsed:not(:hover) .app-split-main { padding: 0; justify-content: center; border-radius: 50%; }
                .app-dropdown-menu { position: absolute; bottom: 45px; right: 0; background: white; border: 1px solid #e1dfdd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: none; flex-direction: column; overflow: hidden; width: 220px; z-index: 10000000; }
                .app-tone-btn { padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; color: #323130; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f2f1; transition: background 0.2s; display: flex; align-items: center; gap: 10px; }
                .app-tone-btn:last-child { border-bottom: none; }
                .app-tone-btn:hover { background: #f3f2f1; }
            `;
            document.head.appendChild(style);

            document.addEventListener('click', (e) => {
                if (!e.target.closest('.app-fab-base')) {
                    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
                    document.querySelectorAll('.app-fab-base').forEach(b => b.classList.remove('app-menu-open'));
                }
            });
        }
    }

    function buildSplitButton(id, cssClass, icon, label, mainAction, menuItems, menuAction) {
        if (document.getElementById(id)) return;
        const cont = document.createElement('div');
        cont.id = id;
        cont.className = `app-fab-base ${cssClass} app-fab-hidden ${sdk && sdk.isOpen ? 'app-collapsed' : ''}`;
        
        let menuHTML = menuItems.map(item => `<button class="app-tone-btn" data-id="${item.id}">${item.icon} ${item.label}</button>`).join('');
        
        cont.innerHTML = `
            <button class="app-split-main"><span style="font-size: 15px;">${icon}</span><span class="app-fab-text" style="margin-left: 8px;">${label}</span></button>
            <div class="app-fab-divider"></div>
            <button class="app-fab-arrow">⏷</button>
            <div class="app-dropdown-menu">${menuHTML}</div>
        `;
        document.body.appendChild(cont);

        cont.querySelector('.app-split-main').onclick = (e) => { e.preventDefault(); mainAction(e); };
        
        cont.querySelector('.app-fab-arrow').onclick = (e) => {
            e.preventDefault(); e.stopPropagation(); 
            const menu = cont.querySelector('.app-dropdown-menu');
            const isOpening = menu.style.display !== 'flex';
            
            document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
            document.querySelectorAll('.app-fab-base').forEach(b => b.classList.remove('app-menu-open'));
            
            if (isOpening) { menu.style.display = 'flex'; cont.classList.add('app-menu-open'); }
        };

        cont.querySelectorAll('.app-tone-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                cont.querySelector('.app-dropdown-menu').style.display = 'none';
                cont.classList.remove('app-menu-open');
                menuAction(btn.dataset.id, e);
            };
        });
    }

    function maintainOutlookUI() {
        if (!sdk) initHostApp();

        const isCalendar = window.location.pathname.includes('/calendar');
        const isMail = !isCalendar;
        
        // Check if an email is actively selected/open in the reading pane
        const hasEmail = !!(document.querySelector('#Item\\.MessageUniqueBody') || document.querySelector('[aria-label="Reading Pane"]'));

        let currentBottom = 20;

        // 1. Toggle Button
        let bToggle = document.getElementById(BTNS.TOGGLE);
        if (!bToggle) {
            bToggle = document.createElement('button');
            bToggle.id = BTNS.TOGGLE;
            bToggle.className = `app-fab-base app-btn-toggle ${sdk.isOpen ? 'app-collapsed' : ''}`;
            bToggle.innerHTML = `<span style="color: #facc15; font-size: 16px; text-shadow: 0 0 5px rgba(250, 204, 21, 0.5);">✨</span><span class="app-fab-text" style="margin-left: 8px;">ITS AI Pro</span>`;
            bToggle.onclick = (e) => { 
                e.preventDefault(); 
                sdk.storeData('ai_pro_pending_prompt', ''); 
                const win = (!sdk.isOpen && sdk.needsAuth()) ? sdk.getAuthWindow() : null;
                sdk.toggle(win); 
            };
            document.body.appendChild(bToggle);
        }
        bToggle.style.bottom = `${currentBottom}px`;
        currentBottom += 50;

        // 2. Auto-Reply Button (Requires Mail AND an active email)
        buildSplitButton(BTNS.REPLY, 'app-btn-reply', '📝', 'Auto-Reply', 
            () => { let r = getCleanEmailBody(); if(!r) return alert("⚠️ Select email text first."); const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt("Please draft a professional reply to:\n\n" + sanitizeText(r), win); },
            [{id:'executive', icon:'📊', label:'Executive'}, {id:'friendly', icon:'👋', label:'Friendly'}, {id:'concise', icon:'✂️', label:'Concise'}],
            (id) => { let r = getCleanEmailBody(); if(!r) return alert("⚠️ Select email text first."); const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt(`Please draft a ${id} reply to:\n\n${sanitizeText(r)}`, win); }
        );
        const bReply = document.getElementById(BTNS.REPLY);
        if (bReply) {
            if (isMail && hasEmail) {
                bReply.classList.remove('app-fab-hidden');
                bReply.style.bottom = `${currentBottom}px`;
                currentBottom += 50;
            } else {
                bReply.classList.add('app-fab-hidden');
            }
        }

        // 3. Compose Button (Requires Mail)
        buildSplitButton(BTNS.COMPOSE, 'app-btn-compose', '✏️', 'Compose',
            () => { const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt("Please help me draft a professional email for a NYS ITS environment. Ask me for the specifics.", win); },
            COMPOSE_TEMPLATES,
            (id) => { const tmpl = COMPOSE_TEMPLATES.find(t => t.id === id); const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt(`Please help me draft an email for a NYS ITS environment regarding: ${tmpl.prompt}\n\nPlease prompt me for the specific details.`, win); }
        );
        const bComp = document.getElementById(BTNS.COMPOSE);
        if (bComp) {
            if (isMail) {
                bComp.classList.remove('app-fab-hidden');
                bComp.style.bottom = `${currentBottom}px`;
                currentBottom += 50;
            } else {
                bComp.classList.add('app-fab-hidden');
            }
        }

        // 4. Meeting Button (Requires Calendar)
        buildSplitButton(BTNS.MEETING, 'app-btn-meeting', '📅', 'New Meeting',
            () => { const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt("Please help me draft a meeting invitation. Ask me for the topic and attendees.", win); },
            MEETING_TEMPLATES,
            (id) => { const tmpl = MEETING_TEMPLATES.find(t => t.id === id); const win = sdk.needsAuth() ? sdk.getAuthWindow() : null; sdk.sendPrompt(`Please help me draft a meeting invitation for a ${tmpl.type}.\n\nPlease use the exact following structure:\n\n**Purpose:** [Draft purpose here based on meeting type]\n\n**Agenda:**\n* Intro / Background\n* Action Items\n* Next Steps\n\nPlease provide the draft and prompt me for any missing specific details.`, win); }
        );
        const bMeet = document.getElementById(BTNS.MEETING);
        if (bMeet) {
            if (isCalendar) {
                bMeet.classList.remove('app-fab-hidden');
                bMeet.style.bottom = `${currentBottom}px`;
                currentBottom += 50; // Keeps dynamic sizing ready for future buttons
            } else {
                bMeet.classList.add('app-fab-hidden');
            }
        }
    }

    if (window.location.hostname.includes('outlook')) {
        setInterval(maintainOutlookUI, 2000);
    }
})();
