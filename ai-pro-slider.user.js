// ==UserScript==
// @name         AI Pro - The Puppet Master (v11.0.0 Master Agent)
// @namespace    https://pro.ai.ny.gov/
// @version      11.0.0
// @description  Full Autonomous Agent: Auto-renames threads, searches history, and dynamically engineers prompts.
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://outlook.cloud.microsoft/*
// @match        https://*.sharepoint.com/*
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      proapi.ai.ny.gov
// @updateURL    https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ai-pro-slider.user.js
// @downloadURL  https://github.com/silentsteel875/special-eureka-happyness/raw/refs/heads/main/ai-pro-slider.user.js
// @run-at       document-start
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
                const hasTokens = Object.keys(sessionStorage).some(k => k.toLowerCase().includes('accesstoken')) || Object.keys(localStorage).some(k => k.toLowerCase().includes('accesstoken'));
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
    // PART 1: THE CORE SDK (AIProBridge Class)
    // ==========================================================================
    class AIProBridge {
        constructor(options = {}) {
            this.targetUrl = options.targetUrl || 'https://pro.ai.ny.gov/';
            this.apiUrl = 'https://proapi.ai.ny.gov/api/v1/vertexai/multiModalInputList/generateTextContent';
            this.initiateUrl = 'https://proapi.ai.ny.gov/api/v1/vertexai/initiateChat';
            this.historyUrl = 'https://proapi.ai.ny.gov/api/v1/chatHistory/';
            this.historyLabelsUrl = 'https://proapi.ai.ny.gov/api/v1/chatHistory/labels';
            
            this.panelWidth = options.panelWidth || 450;
            this.containerId = 'ai-pro-sdk-container';
            this.isOpen = false;
            
            this.storeData = options.storageSetter || function(k, v) { localStorage.setItem(k, v); };
            this.getData = options.storageGetter || function(k) { return localStorage.getItem(k); };
            this.onStateChange = options.onStateChange || function(isOpen, width) {};

            this._init();
        }

        _init() {
            if (document.getElementById(this.containerId)) return;
            this._injectStyles();
            this._buildDOM();
            this._setupResizer();
        }

        needsAuth() {
            const iframe = document.getElementById('ai-pro-sdk-iframe');
            return iframe && (!iframe.src || !iframe.src.includes(new URL(this.targetUrl).hostname));
        }

        getAuthWindow() {
            const w=500, h=600, l=(screen.width/2)-250, t=(screen.height/2)-300;
            return window.open(this.targetUrl, 'AI_PRO_AUTH', `width=${w},height=${h},top=${t},left=${l}`);
        }

        toggle(authWin = null) { this.isOpen ? this.close() : this.open(authWin); }

        open(authWin = null) {
            this.isOpen = true;
            const cont = document.getElementById(this.containerId);
            if (cont) cont.style.right = "0px";
            this.onStateChange(true, this.panelWidth);
            if (this.needsAuth()) this._startAuthFlow(document.getElementById('ai-pro-sdk-iframe'), authWin);
        }

        close() {
            this.isOpen = false;
            const cont = document.getElementById(this.containerId);
            if (cont) cont.style.right = `-${this.panelWidth + 50}px`;
            this.onStateChange(false, this.panelWidth);
        }

        sendPrompt(promptText, authWin = null) {
            this.storeData('ai_pro_pending_prompt', promptText);
            this.open(authWin);
            const iframe = document.getElementById('ai-pro-sdk-iframe');
            if (!this.needsAuth() && iframe) iframe.src = iframe.src; 
        }

        extractBearerToken() {
            const vaultStr = this.getData('ai_pro_msal_vault');
            if (!vaultStr) return null;
            try {
                const vault = JSON.parse(vaultStr);
                for (let source of [vault.session, vault.local]) {
                    for (let key in source) {
                        if (key.includes('accesstoken')) {
                            const val = source[key];
                            if (typeof val === 'string' && val.startsWith('eyJ')) return val;
                            try {
                                const parsed = JSON.parse(val);
                                if (parsed && parsed.secret) return parsed.secret;
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {}
            return null;
        }

        // --- THE AUTONOMOUS AGENT ORCHESTRATOR ---
        executeHeadlessPrompt(emailText, callback) {
            const token = this.extractBearerToken();
            if (!token) return callback({ error: "No Auth Token" });

            let hasRetried = false;

            // Step 4: Fire the AI Generation payload
            const doGenerate = (convId) => {
                console.log(`🔍 [SmartAgent] Firing payload into Thread ID: ${convId}`);
                
                const sysPrompt = `Analyze the following email thread. Based on the conversation context, roles, and signatures, determine the 3 most logical actions the recipient should take in a reply. \nCRITICAL INSTRUCTIONS: \n1. You MUST output ONLY a valid JSON array of 3 objects. \n2. Do NOT output any conversational text. Do NOT use markdown formatting (\`\`\`).\n3. If the email context is missing or too short, return generic professional options.\n4. Each object must have a "label" (max 4 words) and a "prompt" (a highly specific instruction for an AI to draft the reply, referencing names/dates if available).\nExample Output: [{"label": "Approve Kick-off", "prompt": "Draft an email to Patty and Jeff confirming the May 1st kick-off date."}]\n\nEmail Context:\n${emailText}`;

                const payload = JSON.stringify({ userMessage: sysPrompt, chatModel: "gemini-2.5-flash-lite", conversationId: convId });
                const formData = new FormData();
                formData.append("message", new Blob([payload], { type: "application/json" }), "blob");

                GM_xmlhttpRequest({
                    method: "POST",
                    url: this.apiUrl,
                    headers: { "Authorization": `Bearer ${token}` },
                    data: formData,
                    timeout: 20000,
                    onload: (response) => {
                        // If 404 (thread was deleted server-side), clear cache and search/re-initiate
                        if (response.status === 404 || response.responseText.includes("NOT_FOUND")) {
                            if (!hasRetried) {
                                console.warn("🔍 [SmartAgent] Thread deleted. Requesting a new one...");
                                hasRetried = true;
                                GM_setValue('ai_pro_smart_agent_id', '');
                                return doFindExisting();
                            } else {
                                return callback({ error: "Initiate Retry Failed" });
                            }
                        }

                        try {
                            let rawResponse = response.responseText || "";
                            let flatText = rawResponse.replace(/^data:/gm, '').replace(/\n/g, ' ').trim();
                            const jsonMatch = flatText.match(/\[[\s\S]*\]/);
                            if (!jsonMatch) return callback({ error: "No array found" });

                            const cleanJson = jsonMatch[0];
                            const suggestions = JSON.parse(cleanJson);
                            
                            if (Array.isArray(suggestions) && suggestions.length > 0 && suggestions[0].prompt) {
                                callback({ data: suggestions });
                            } else {
                                callback({ error: "Invalid Schema" });
                            }
                        } catch(e) { callback({ error: "Parse failed" }); }
                    },
                    onerror: () => callback({ error: "Network Error" })
                });
            };

            // Step 3: Rename a brand new chat thread
            const doRename = (newId) => {
                console.log(`🔍 [SmartAgent] Renaming new thread ${newId} to 'AIPro Smart Suggestions'...`);
                GM_xmlhttpRequest({
                    method: "PUT",
                    url: this.historyUrl + newId,
                    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                    data: JSON.stringify({ label: "AIPro Smart Suggestions" }),
                    onload: () => {
                        console.log("🔍 [SmartAgent] Thread successfully renamed.");
                        GM_setValue('ai_pro_smart_agent_id', newId);
                        doGenerate(newId);
                    },
                    onerror: () => {
                        console.warn("🔍 [SmartAgent] Rename failed, but proceeding anyway.");
                        GM_setValue('ai_pro_smart_agent_id', newId);
                        doGenerate(newId);
                    }
                });
            };

            // Step 2: Request a brand new ID
            const doInitiate = () => {
                console.log("🔍 [SmartAgent] Initiating brand new chat session...");
                GM_xmlhttpRequest({
                    method: "GET",
                    url: this.initiateUrl,
                    headers: { "Authorization": `Bearer ${token}` },
                    timeout: 10000,
                    onload: (initRes) => {
                        if (initRes.status >= 400) return callback({ error: "Initiate Failed" });
                        let newId = "";
                        try {
                            const parsed = JSON.parse(initRes.responseText);
                            newId = parsed.conversationId || parsed.id || parsed;
                        } catch(e) {
                            newId = initRes.responseText.replace(/["']/g, "").trim();
                        }

                        if (newId && typeof newId === 'string') doRename(newId);
                        else callback({ error: "Invalid ID returned" });
                    },
                    onerror: () => callback({ error: "Network Error" })
                });
            };

            // Step 1: Scan the server-side Chat History for an existing Smart Agent thread
            const doFindExisting = () => {
                console.log("🔍 [SmartAgent] Scanning server history for existing 'AIPro Smart Suggestions' thread...");
                GM_xmlhttpRequest({
                    method: "GET",
                    url: this.historyLabelsUrl,
                    headers: { "Authorization": `Bearer ${token}` },
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            let foundId = null;
                            
                            // Recursive Scanner to hunt down the exact ID regardless of the JSON shape
                            const findIdInTree = (obj) => {
                                if (Array.isArray(obj)) {
                                    for(let i of obj) { let result = findIdInTree(i); if(result) return result; }
                                } else if (obj && typeof obj === 'object') {
                                    if (obj.label === "AIPro Smart Suggestions" || obj.conversationLabel === "AIPro Smart Suggestions") {
                                        return obj.conversationId || obj.id;
                                    }
                                    for(let key in obj) { let result = findIdInTree(obj[key]); if(result) return result; }
                                }
                                return null;
                            };
                            
                            foundId = findIdInTree(data);

                            if (foundId) {
                                console.log("🔍 [SmartAgent] Found existing history thread:", foundId);
                                GM_setValue('ai_pro_smart_agent_id', foundId);
                                doGenerate(foundId);
                            } else {
                                console.log("🔍 [SmartAgent] Thread not found in history. Must create new.");
                                doInitiate();
                            }
                        } catch(e) {
                            doInitiate(); // Fallback if parse fails
                        }
                    },
                    onerror: () => doInitiate() // Fallback if network fails
                });
            };

            // --- EXECUTION PIPELINE ---
            const cachedId = GM_getValue('ai_pro_smart_agent_id');
            if (cachedId && typeof cachedId === 'string' && cachedId.trim() !== '') {
                doGenerate(cachedId);
            } else {
                doFindExisting();
            }
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
            cont.style.cssText = `position:fixed; top:0; right:-${this.panelWidth + 50}px; width:${this.panelWidth}px; height:100vh; background:#fff; box-shadow:-4px 0 15px rgba(0,0,0,0.15); z-index:2147483647; transition:right 0.3s ease; border-left:1px solid #e1dfdd;`;
            
            const resizer = document.createElement('div');
            resizer.id = 'ai-pro-resizer';
            resizer.style.cssText = `position:absolute; left:-3px; top:0; bottom:0; width:6px; cursor:ew-resize; z-index:11; background:transparent; transition:background 0.2s ease;`;
            resizer.onmouseenter = () => resizer.style.background = 'rgba(0, 94, 162, 0.4)';
            resizer.onmouseleave = () => resizer.style.background = 'transparent';
            cont.appendChild(resizer);

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

        _setupResizer() {
            let isDragging = false;
            const resizer = document.getElementById('ai-pro-resizer');
            const cont = document.getElementById(this.containerId);
            const iframe = document.getElementById('ai-pro-sdk-iframe');
            
            resizer.addEventListener('mousedown', (e) => {
                isDragging = true;
                document.body.style.userSelect = 'none';
                if (iframe) iframe.style.pointerEvents = 'none'; 
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                let newWidth = window.innerWidth - e.clientX;
                newWidth = Math.max(350, Math.min(newWidth, window.innerWidth / 2)); 
                this.panelWidth = newWidth;
                cont.style.width = `${newWidth}px`;
                if (this.isOpen) this.onStateChange(true, newWidth);
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    document.body.style.userSelect = '';
                    if (iframe) iframe.style.pointerEvents = ''; 
                }
            });
        }

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
    // PART 2: THE CONSUMER APPLICATION (Ecosystem Implementation)
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

    function escapeHtml(unsafe) {
        return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    const BTNS = { TOGGLE: 'app-btn-toggle', REPLY: 'app-btn-reply', COMPOSE: 'app-btn-compose', MEETING: 'app-btn-meeting', PEOPLE: 'app-btn-people', TODO: 'app-btn-todo', ONEDRIVE: 'app-btn-onedrive' };

    let currentEmailHash = ""; 
    let isSmartGenerating = false;

    const COMPOSE_TEMPLATES = [
        { label: "Project Management", icon: "📊", items: [{ id: 'pm_stat', icon: '📈', label: 'Status Update', prompt: 'a Project Status Update.' }, { id: 'pm_steer', icon: '🧭', label: 'Steering Comm.', prompt: 'a Steering Committee Briefing.' }] },
        { label: "Collaboration", icon: "🤝", items: [{ id: 'col_intro', icon: '👋', label: 'Team Intro', prompt: 'a Team Introduction email.' }, { id: 'col_ask', icon: '❓', label: 'Request Info', prompt: 'a polite request for information from another team.' }] },
        { label: "Analysis & Design", icon: "📋", items: [{ id: 'ad_req', icon: '📝', label: 'Req Sign-off', prompt: 'a Business Requirements Sign-off request.' }, { id: 'ad_arch', icon: '🏗️', label: 'Arch Proposal', prompt: 'a Technical Architecture Proposal.' }] },
        { label: "Development", icon: "💻", items: [{ id: 'dev_code', icon: '👀', label: 'Code Review', prompt: 'a Code Review Request.' }, { id: 'dev_merge', icon: '🔀', label: 'Merge Notice', prompt: 'a notification that code has been merged.' }] },
        { label: "Quality Assurance", icon: "✅", items: [{ id: 'qa_bug', icon: '🐞', label: 'Bug Report', prompt: 'a detailed Bug Report email.' }, { id: 'qa_uat', icon: '👥', label: 'UAT Sign-off', prompt: 'a UAT Sign-off request.' }] },
        { label: "Security", icon: "🔒", items: [{ id: 'sec_alert', icon: '🚨', label: 'Security Alert', prompt: 'a Security Alert or Notice.' }, { id: 'sec_audit', icon: '📋', label: 'Audit Request', prompt: 'a request for information regarding a Security Audit.' }] },
        { label: "Release Mgmt", icon: "🚀", items: [{ id: 'rm_plan', icon: '📦', label: 'Release Notes', prompt: 'a Release Notes communication.' }, { id: 'rm_inc', icon: '🔥', label: 'Escalation', prompt: 'an Incident Escalation Notice.' }] },
        { label: "Administrative", icon: "👔", items: [{ id: 'adm_all', icon: '📢', label: 'Team Update', prompt: 'a Team Update or Announcement.' }, { id: 'adm_ooo', icon: '🌴', label: 'Out of Office', prompt: 'an Out of Office coverage email.' }] }
    ];

    let REPLY_TEMPLATES = [
        {
            label: "✨ Smart Suggestions", icon: "🧠", isSmart: true, id: "smart-cat", items: [
                { id: 'smart_spin', icon: '⏳', label: 'Analyzing thread...', vector: '' },
            ]
        },
        {
            label: "Tone Overrides", icon: "🎭", items: [
                { id: 'rep_exec', icon: '📊', label: 'Executive Brief', vector: 'exec' },
                { id: 'rep_friend', icon: '👋', label: 'Friendly & Casual', vector: 'friend' },
                { id: 'rep_formal', icon: '👔', label: 'Strictly Formal', vector: 'formal' }
            ]
        },
        ...COMPOSE_TEMPLATES
    ];

    const MEETING_TEMPLATES = [
        { label: "Project Management", icon: "📊", items: [{ id: 'm_pm_kick', icon: '🚀', label: 'Project Kickoff', type: 'Project Kickoff Meeting' }, { id: 'm_pm_stat', icon: '📈', label: 'Status Check-in', type: 'Weekly Status Check-in' }, { id: 'm_pm_risk', icon: '⚠️', label: 'Risk Review', type: 'Risk and Issue Review' }, { id: 'm_pm_steer', icon: '🧭', label: 'Steering Comm.', type: 'Steering Committee Sync' }] },
        { label: "Collaboration", icon: "🤝", items: [{ id: 'm_col_brain', icon: '🧠', label: 'Brainstorming', type: 'Team Brainstorming Session' }, { id: 'm_col_work', icon: '🛠️', label: 'Working Session', type: 'Active Working Session' }, { id: 'm_col_sync', icon: '🔗', label: 'Cross-team Sync', type: 'Cross-functional Team Sync' }] },
        { label: "Analysis & Design", icon: "📋", items: [{ id: 'm_ad_req', icon: '📝', label: 'Req Gathering', type: 'Business Requirements Gathering' }, { id: 'm_ad_arch', icon: '📐', label: 'Arch Review', type: 'Technical Architecture Review' }, { id: 'm_ad_ux', icon: '🎨', label: 'UX/UI Review', type: 'UX/UI Design Review' }] },
        { label: "Development", icon: "💻", items: [{ id: 'm_dev_sprint', icon: '🏃', label: 'Sprint Planning', type: 'Sprint Planning' }, { id: 'm_dev_stand', icon: '⏱️', label: 'Daily Standup', type: 'Daily Standup' }, { id: 'm_dev_groom', icon: '🪒', label: 'Backlog Grooming', type: 'Backlog Grooming' }, { id: 'm_dev_code', icon: '👀', label: 'Code Review Sync', type: 'Peer Code Review Sync' }] },
        { label: "Quality Assurance", icon: "✅", items: [{ id: 'm_qa_plan', icon: '📄', label: 'Test Plan Review', type: 'Test Plan Review' }, { id: 'm_qa_bug', icon: '🐞', label: 'Bug Triage', type: 'Defect / Bug Triage' }, { id: 'm_qa_uat', icon: '👥', label: 'UAT Kickoff', type: 'User Acceptance Testing Kickoff' }] },
        { label: "Security", icon: "🔒", items: [{ id: 'm_sec_threat', icon: '🛡️', label: 'Threat Modeling', type: 'Threat Modeling Session' }, { id: 'm_sec_audit', icon: '📋', label: 'Audit Sync', type: 'Security Audit Preparation Sync' }] },
        { label: "Release Mgmt", icon: "🚀", items: [{ id: 'm_rm_gono', icon: '🚦', label: 'Go/No-Go Decision', type: 'Release Go/No-Go Decision' }, { id: 'm_rm_plan', icon: '📦', label: 'Deployment Plan', type: 'Deployment Planning' }, { id: 'm_rm_rca', icon: '🔍', label: 'Incident RCA', type: 'Major Incident Post-Mortem (RCA)' }] },
        { label: "Administrative", icon: "👔", items: [{ id: 'm_adm_1on1', icon: '🗣️', label: '1:1 Sync', type: '1:1 Supervisor Sync' }, { id: 'm_adm_all', icon: '🌍', label: 'Team All-Hands', type: 'Team All-Hands / Townhall' }, { id: 'm_adm_perf', icon: '📈', label: 'Perf. Review', type: 'Performance Review' }] }
    ];

    const PEOPLE_TEMPLATES = [
        { id: 'ppl_intro', icon: '👋', label: 'Draft Intro', prompt: 'a professional introduction message to connect with a colleague.' },
        { id: 'ppl_meet', icon: '📅', label: 'Req Meeting', prompt: 'a polite request for a 15-minute introductory chat or sync.' },
        { id: 'ppl_kudo', icon: '🎉', label: 'Send Kudos', prompt: 'a congratulatory message or kudos to a team member for their recent work.' }
    ];

    const TODO_TEMPLATES = [
        { id: 'td_break', icon: '🔪', label: 'Task Breakdown', prompt: 'help me break down a large project task into smaller, actionable sub-tasks.' },
        { id: 'td_stat', icon: '📝', label: 'Draft Update', prompt: 'draft a status update summarizing my recent progress on a task.' },
        { id: 'td_block', icon: '🛑', label: 'Escalate Blocker', prompt: 'draft an escalation email regarding a blocker preventing me from completing a task.' }
    ];

    const ONEDRIVE_TEMPLATES = [
        { id: 'od_sum', icon: '📄', label: 'Doc Summary', prompt: 'create a brief, bulleted executive summary of a document. I will paste the text next.' },
        { id: 'od_share', icon: '🔗', label: 'Share Context', prompt: 'draft an email providing context and sharing a link to a newly created document.' },
        { id: 'od_review', icon: '👀', label: 'Req Review', prompt: 'draft a polite request asking a colleague to review a document and provide feedback.' }
    ];

    let sdk; 

    function initHostApp() {
        sdk = new AIProBridge({
            storageSetter: (k, v) => GM_setValue(k, v),
            storageGetter: (k) => GM_getValue(k),
            onStateChange: (isOpen, panelWidth) => {
                const offset = isOpen ? panelWidth + 20 : 20;
                Object.values(BTNS).forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.right = `${offset}px`;
                        isOpen ? btn.classList.add('app-collapsed') : btn.classList.remove('app-collapsed');
                    }
                });
                closeAllMenus();
            }
        });

        if (!document.getElementById('app-host-styles')) {
            const style = document.createElement('style');
            style.id = 'app-host-styles';
            style.innerHTML = `
                .app-fab-base { position: fixed; right: 20px; height: 40px; border-radius: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 2147483645; display: flex; align-items: center; white-space: nowrap; font-family: 'Segoe UI', Tahoma, sans-serif; transform-origin: right center; transition: right 0.1s linear, width 0.3s cubic-bezier(0.4,0,0.2,1), bottom 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease; }
                .app-fab-base.app-menu-open { z-index: 2147483646; }
                .app-fab-hidden { transform: scale(0) !important; opacity: 0 !important; pointer-events: none !important; }
                .app-fab-text, .app-fab-divider, .app-fab-arrow { transition: opacity 0.2s, display 0.2s; }
                .app-btn-toggle { width: 140px; background: #005ea2; color: white; border: none; cursor: pointer; justify-content: center; font-weight: bold; font-size: 13px; z-index: 2147483647; }
                .app-btn-reply { width: 155px; background: #107c41; }
                .app-btn-compose { width: 145px; background: #0078d4; }
                .app-btn-meeting { width: 165px; background: #d83b01; }
                .app-btn-people { width: 145px; background: #008272; }
                .app-btn-todo { width: 145px; background: #0078d4; }
                .app-btn-onedrive { width: 165px; background: #0364b8; }
                .app-split-main { background: none; border: none; color: white; cursor: pointer; flex-grow: 1; height: 100%; display: flex; align-items: center; justify-content: flex-start; padding: 0 0 0 15px; font-weight: bold; font-size: 13px; border-radius: 20px 0 0 20px; }
                .app-split-main:hover { background: rgba(255,255,255,0.1); }
                .app-fab-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.4); }
                .app-fab-arrow { background: none; border: none; color: white; cursor: pointer; width: 35px; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 0 20px 20px 0; }
                .app-fab-arrow:hover { background: rgba(0,0,0,0.1); }
                
                .app-collapsed:not(:hover):not(.app-menu-open) { width: 40px !important; border-radius: 50% !important; }
                .app-collapsed:not(:hover):not(.app-menu-open) .app-fab-text, 
                .app-collapsed:not(:hover):not(.app-menu-open) .app-fab-divider, 
                .app-collapsed:not(:hover):not(.app-menu-open) .app-fab-arrow { display: none !important; }
                .app-collapsed:not(:hover):not(.app-menu-open) .app-split-main { padding: 0; justify-content: center; border-radius: 50%; }
                
                .app-dropdown-menu { position: absolute; bottom: 45px; right: 0; background: white; border: 1px solid #e1dfdd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: none; overflow: hidden; width: 240px; z-index: 10000000; max-height: 70vh; overflow-y: auto; }
                .app-menu-layer { display: flex; flex-direction: column; width: 100%; }
                .app-tone-btn { padding: 12px 16px; border: none; background: none; text-align: left; cursor: pointer; color: #323130; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f3f2f1; transition: background 0.2s; display: flex; align-items: center; justify-content: space-between; }
                .app-tone-btn:last-child { border-bottom: none; }
                .app-tone-btn:hover { background: #f3f2f1; }
                .app-back-btn { padding: 10px 16px; border: none; background: #f3f2f1; text-align: left; cursor: pointer; color: #005ea2; font-size: 12px; font-weight: bold; border-bottom: 2px solid #e1dfdd; position: sticky; top: 0; z-index: 2;}
                .app-back-btn:hover { background: #e1dfdd; }

                @keyframes smart-pulse {
                    0% { box-shadow: 0 0 4px rgba(138,43,226,0.3), inset 0 0 4px rgba(138,43,226,0.2); border-color: rgba(138,43,226,0.5); }
                    50% { box-shadow: 0 0 12px rgba(75,0,130,0.7), inset 0 0 8px rgba(75,0,130,0.5); border-color: rgba(75,0,130,0.9); }
                    100% { box-shadow: 0 0 4px rgba(138,43,226,0.3), inset 0 0 4px rgba(138,43,226,0.2); border-color: rgba(138,43,226,0.5); }
                }
                .app-smart-aura { animation: smart-pulse 2.5s infinite; background: linear-gradient(90deg, rgba(138,43,226,0.05) 0%, rgba(75,0,130,0.05) 100%); border: 1px solid rgba(138,43,226,0.5); border-radius: 6px; margin: 4px; width: calc(100% - 8px); color: #4b0082 !important; font-weight: 700 !important; }
                .app-smart-aura:hover { background: linear-gradient(90deg, rgba(138,43,226,0.15) 0%, rgba(75,0,130,0.15) 100%); }
            `;
            document.head.appendChild(style);

            document.addEventListener('click', (e) => {
                if (!e.target.closest('.app-fab-base')) closeAllMenus();
            });
        }
    }

    function closeAllMenus() {
        document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
        document.querySelectorAll('.app-fab-base').forEach(b => b.classList.remove('app-menu-open'));
        document.querySelectorAll('.app-menu-main').forEach(l => l.style.display = 'flex');
        document.querySelectorAll('.app-menu-sub').forEach(l => l.style.display = 'none');
    }

    function updateSmartDOM(newItemsArray) {
        REPLY_TEMPLATES[0].items = newItemsArray;
        
        const cont = document.getElementById(BTNS.REPLY);
        if (!cont) return;

        const smartSubMenu = cont.querySelector(`#${BTNS.REPLY}-sub-0`);
        if (!smartSubMenu) return;

        const backBtn = smartSubMenu.querySelector('.app-back-btn');
        smartSubMenu.innerHTML = '';
        if (backBtn) smartSubMenu.appendChild(backBtn);

        newItemsArray.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'app-tone-btn';
            btn.dataset.id = item.id;
            btn.innerHTML = `<span>${item.icon} ${item.label}</span>`;
            
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                closeAllMenus();
                handleReplyMenuClick(item.id, item.vector);
            };
            
            smartSubMenu.appendChild(btn);
        });

        cont.dataset.hash = JSON.stringify(REPLY_TEMPLATES);
    }

    function executeSmartGeneration(emailText) {
        if (isSmartGenerating || !sdk) return;
        
        isSmartGenerating = true;
        updateSmartDOM([{ id: 'smart_spin', icon: '⏳', label: 'Analyzing thread...', vector: '' }]);

        sdk.executeHeadlessPrompt(emailText, (res) => {
            if (res.error && res.error.includes("Auth Token")) {
                currentEmailHash = ""; 
                updateSmartDOM([{ id: 'smart_spin', icon: '⚠️', label: 'Login to AI Pro to activate', vector: '' }]);
            } else if (res.data) {
                const newItems = res.data.map((item, idx) => ({
                    id: `smart_dyn_${idx}`, icon: '✨', label: item.label, vector: item.prompt
                }));
                updateSmartDOM(newItems);
            } else {
                updateSmartDOM([
                    { id: 'smart_agree', icon: '✅', label: 'Agree & Proceed', vector: 'Draft a response agreeing with the current direction and outlining actionable next steps.' },
                    { id: 'smart_clarify', icon: '❓', label: 'Seek Clarification', vector: 'Draft a response politely requesting clarification on ambiguous points.' }
                ]);
            }
            isSmartGenerating = false;
        });
    }

    function handleReplyMenuClick(id, vector) {
        let r = getCleanEmailBody(); if(!r) return alert("⚠️ Select email text first."); 
        const win = sdk.needsAuth() ? sdk.getAuthWindow() : null;
        
        if (id.startsWith('smart_')) {
            sdk.sendPrompt(`${vector}\n\nEmail Thread Context:\n${sanitizeText(r)}`, win);
        } else if (id.startsWith('rep_')) {
            let tone = id === 'rep_exec' ? 'executive briefing-style' : id === 'rep_friend' ? 'warm and friendly' : 'strictly formal';
            sdk.sendPrompt(`Please draft a ${tone} reply to:\n\n${sanitizeText(r)}`, win);
        } else {
            let tPrompt = ''; COMPOSE_TEMPLATES.forEach(c => c.items.forEach(i => { if(i.id === id) tPrompt = i.prompt; }));
            sdk.sendPrompt(`Please draft a reply to the following email in the form of ${tPrompt}\n\nEmail Thread Context:\n${sanitizeText(r)}`, win);
        }
    }

    function buildCascadingSplitButton(id, cssClass, icon, label, mainAction, structure, menuAction) {
        let cont = document.getElementById(id);
        const structureHash = JSON.stringify(structure);

        if (cont && cont.dataset.hash === structureHash) return; 

        if (!cont) {
            cont = document.createElement('div');
            cont.id = id;
            cont.className = `app-fab-base ${cssClass} app-fab-hidden`;
            document.body.appendChild(cont);
        }

        const wasMenuOpen = cont.classList.contains('app-menu-open');
        const openSubMenuId = Array.from(cont.querySelectorAll('.app-menu-sub')).find(el => el.style.display === 'flex')?.id;
        
        cont.dataset.hash = structureHash; 
        
        let mainLayerHTML = `<div class="app-menu-layer app-menu-main">`;
        let subLayersHTML = ``;

        structure.forEach((item, index) => {
            if (item.items) { 
                const subId = `${id}-sub-${index}`;
                const auraClass = item.isSmart ? "app-smart-aura" : "";
                
                mainLayerHTML += `<button class="app-tone-btn app-cat-trigger ${auraClass}" data-target="${subId}"><span>${item.icon} ${item.label}</span> <span>▶</span></button>`;
                
                subLayersHTML += `<div class="app-menu-layer app-menu-sub" id="${subId}" style="display:none;">`;
                subLayersHTML += `<button class="app-back-btn">⬅ Back</button>`;
                item.items.forEach(sub => {
                    const safeVector = escapeHtml(sub.vector || '');
                    subLayersHTML += `<button class="app-tone-btn" data-id="${sub.id}" data-vector="${safeVector}"><span>${sub.icon} ${sub.label}</span></button>`;
                });
                subLayersHTML += `</div>`;
            } else { 
                const safeVector = escapeHtml(item.vector || '');
                mainLayerHTML += `<button class="app-tone-btn" data-id="${item.id}" data-vector="${safeVector}"><span>${item.icon} ${item.label}</span></button>`;
            }
        });
        mainLayerHTML += `</div>`;

        cont.innerHTML = `
            <button class="app-split-main"><span style="font-size: 15px;">${icon}</span><span class="app-fab-text" style="margin-left: 8px;">${label}</span></button>
            <div class="app-fab-divider"></div>
            <button class="app-fab-arrow">⏷</button>
            <div class="app-dropdown-menu">${mainLayerHTML}${subLayersHTML}</div>
        `;

        if (wasMenuOpen) {
            cont.querySelector('.app-dropdown-menu').style.display = 'flex';
            cont.classList.add('app-menu-open');
            if (openSubMenuId) {
                cont.querySelector('.app-menu-main').style.display = 'none';
                cont.querySelector(`#${openSubMenuId}`).style.display = 'flex';
            }
        }

        cont.querySelector('.app-split-main').onclick = (e) => { e.preventDefault(); mainAction(e); };
        
        cont.querySelector('.app-fab-arrow').onclick = (e) => {
            e.preventDefault(); e.stopPropagation(); 
            const menu = cont.querySelector('.app-dropdown-menu');
            const isOpening = menu.style.display !== 'flex';
            closeAllMenus();
            if (isOpening) { menu.style.display = 'flex'; cont.classList.add('app-menu-open'); }
        };

        cont.querySelectorAll('.app-cat-trigger').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                cont.querySelector('.app-menu-main').style.display = 'none';
                cont.querySelector(`#${btn.dataset.target}`).style.display = 'flex';
            };
        });

        cont.querySelectorAll('.app-back-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                cont.querySelectorAll('.app-menu-sub').forEach(m => m.style.display = 'none');
                cont.querySelector('.app-menu-main').style.display = 'flex';
            };
        });

        cont.querySelectorAll('.app-tone-btn[data-id]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                closeAllMenus();
                menuAction(btn.dataset.id, btn.dataset.vector, e);
            };
        });
    }

    function maintainOutlookUI() {
        if (!sdk) initHostApp();

        const path = window.location.href.toLowerCase();
        const isCalendar = path.includes('/calendar');
        const isPeople = path.includes('/people');
        const isTodo = path.includes('/todo') || path.includes('/tasks');
        const isOneDrive = path.includes('/onedrive') || path.includes('.sharepoint.com') || path.includes('/files');
        const isMail = !isCalendar && !isPeople && !isTodo && !isOneDrive;
        
        const readingPane = document.querySelector('[aria-label="Reading Pane"]');
        const altPane = document.querySelector('#Item\\.MessageUniqueBody');
        const hasEmail = (readingPane && readingPane.offsetParent !== null) || (altPane && altPane.offsetParent !== null);

        if (isMail && hasEmail) {
            const rawText = getCleanEmailBody();
            if (rawText) {
                const textHash = rawText.substring(0, 100); 
                if (textHash !== currentEmailHash) {
                    if (!isSmartGenerating) {
                        currentEmailHash = textHash;
                        executeSmartGeneration(sanitizeText(rawText));
                    }
                }
            }
        } else {
            currentEmailHash = ""; 
        }

        const currentOffset = sdk.isOpen ? sdk.panelWidth + 20 : 20;
        let currentBottom = 20;

        let bToggle = document.getElementById(BTNS.TOGGLE);
        if (!bToggle) {
            bToggle = document.createElement('button');
            bToggle.id = BTNS.TOGGLE;
            bToggle.className = `app-fab-base app-btn-toggle`;
            bToggle.innerHTML = `<span style="color: #facc15; font-size: 16px; text-shadow: 0 0 5px rgba(250, 204, 21, 0.5);">✨</span><span class="app-fab-text" style="margin-left: 8px;">ITS AI Pro</span>`;
            bToggle.onclick = (e) => { e.preventDefault(); sdk.storeData('ai_pro_pending_prompt', ''); sdk.toggle( (!sdk.isOpen && sdk.needsAuth()) ? sdk.getAuthWindow() : null ); };
            document.body.appendChild(bToggle);
        }
        bToggle.style.right = `${currentOffset}px`;
        bToggle.style.bottom = `${currentBottom}px`;
        sdk.isOpen ? bToggle.classList.add('app-collapsed') : bToggle.classList.remove('app-collapsed');
        currentBottom += 50;

        buildCascadingSplitButton(BTNS.REPLY, 'app-btn-reply', '📝', 'Auto-Reply', 
            () => { let r = getCleanEmailBody(); sdk.sendPrompt("Please draft a professional reply to:\n\n" + sanitizeText(r), sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            REPLY_TEMPLATES,
            handleReplyMenuClick
        );
        const bReply = document.getElementById(BTNS.REPLY);
        if (bReply) {
            bReply.style.right = `${currentOffset}px`;
            sdk.isOpen ? bReply.classList.add('app-collapsed') : bReply.classList.remove('app-collapsed');
            if (isMail && hasEmail) { bReply.classList.remove('app-fab-hidden'); bReply.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bReply.classList.add('app-fab-hidden'); }
        }

        buildCascadingSplitButton(BTNS.COMPOSE, 'app-btn-compose', '✏️', 'Compose',
            () => { sdk.sendPrompt("Please help me draft a professional email for a NYS ITS environment.", sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            COMPOSE_TEMPLATES,
            (id) => { let tPrompt = ''; COMPOSE_TEMPLATES.forEach(c => c.items.forEach(i => { if(i.id === id) tPrompt = i.prompt; })); sdk.sendPrompt(`Please help me draft an email regarding: ${tPrompt}`, sdk.needsAuth() ? sdk.getAuthWindow() : null); }
        );
        const bComp = document.getElementById(BTNS.COMPOSE);
        if (bComp) {
            bComp.style.right = `${currentOffset}px`;
            sdk.isOpen ? bComp.classList.add('app-collapsed') : bComp.classList.remove('app-collapsed');
            if (isMail) { bComp.classList.remove('app-fab-hidden'); bComp.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bComp.classList.add('app-fab-hidden'); }
        }

        buildCascadingSplitButton(BTNS.MEETING, 'app-btn-meeting', '📅', 'New Meeting',
            () => { sdk.sendPrompt("Please help me draft a meeting invitation.", sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            MEETING_TEMPLATES,
            (id) => { let tType = ''; MEETING_TEMPLATES.forEach(c => c.items.forEach(i => { if(i.id === id) tType = i.type; })); sdk.sendPrompt(`Please help me draft a meeting invitation for a ${tType}.`, sdk.needsAuth() ? sdk.getAuthWindow() : null); }
        );
        const bMeet = document.getElementById(BTNS.MEETING);
        if (bMeet) {
            bMeet.style.right = `${currentOffset}px`;
            sdk.isOpen ? bMeet.classList.add('app-collapsed') : bMeet.classList.remove('app-collapsed');
            if (isCalendar) { bMeet.classList.remove('app-fab-hidden'); bMeet.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bMeet.classList.add('app-fab-hidden'); }
        }

        buildCascadingSplitButton(BTNS.PEOPLE, 'app-btn-people', '👥', 'Connect',
            () => { sdk.sendPrompt("Please help me draft a professional message.", sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            PEOPLE_TEMPLATES,
            (id, vector) => { const t = PEOPLE_TEMPLATES.find(x => x.id === id); sdk.sendPrompt(`Please help me draft ${t.prompt}`, sdk.needsAuth() ? sdk.getAuthWindow() : null); }
        );
        const bPpl = document.getElementById(BTNS.PEOPLE);
        if (bPpl) {
            bPpl.style.right = `${currentOffset}px`;
            sdk.isOpen ? bPpl.classList.add('app-collapsed') : bPpl.classList.remove('app-collapsed');
            if (isPeople) { bPpl.classList.remove('app-fab-hidden'); bPpl.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bPpl.classList.add('app-fab-hidden'); }
        }

        buildCascadingSplitButton(BTNS.TODO, 'app-btn-todo', '✅', 'Task Action',
            () => { sdk.sendPrompt("I need help organizing a task.", sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            TODO_TEMPLATES,
            (id, vector) => { const t = TODO_TEMPLATES.find(x => x.id === id); sdk.sendPrompt(`Please ${t.prompt}`, sdk.needsAuth() ? sdk.getAuthWindow() : null); }
        );
        const bTodo = document.getElementById(BTNS.TODO);
        if (bTodo) {
            bTodo.style.right = `${currentOffset}px`;
            sdk.isOpen ? bTodo.classList.add('app-collapsed') : bTodo.classList.remove('app-collapsed');
            if (isTodo) { bTodo.classList.remove('app-fab-hidden'); bTodo.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bTodo.classList.add('app-fab-hidden'); }
        }

        buildCascadingSplitButton(BTNS.ONEDRIVE, 'app-btn-onedrive', '☁️', 'Doc Action',
            () => { sdk.sendPrompt("I need help summarizing a document.", sdk.needsAuth() ? sdk.getAuthWindow() : null); },
            ONEDRIVE_TEMPLATES,
            (id, vector) => { const t = ONEDRIVE_TEMPLATES.find(x => x.id === id); sdk.sendPrompt(`Please ${t.prompt}`, sdk.needsAuth() ? sdk.getAuthWindow() : null); }
        );
        const bDrive = document.getElementById(BTNS.ONEDRIVE);
        if (bDrive) {
            bDrive.style.right = `${currentOffset}px`;
            sdk.isOpen ? bDrive.classList.add('app-collapsed') : bDrive.classList.remove('app-collapsed');
            if (isOneDrive) { bDrive.classList.remove('app-fab-hidden'); bDrive.style.bottom = `${currentBottom}px`; currentBottom += 50; } 
            else { bDrive.classList.add('app-fab-hidden'); }
        }
    }

    if (window.location.hostname.includes('outlook') || window.location.hostname.includes('sharepoint')) {
        setInterval(maintainOutlookUI, 2000);
    }
})();
