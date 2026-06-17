// ==UserScript==
// @name         ITS AI Pro — Ultimate Web Enhancer (v4.2.0 Diagnostics)
// @namespace    https://its.ny.gov/
// @version      4.2.0
// @description  Bypasses Context Isolation via unsafeWindow. Dual-Intercepts Fetch & XHR. Includes dynamic Console Debug Mode.
// @author       ITS Platform Team
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self || window.name === 'AI_PRO_AUTH') return;

    // Target the true browser window, breaking out of the Tampermonkey sandbox
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    console.log("[ITS Enhancer v4.2] 🚀 Sandboxed breached. Initializing...");

    const CONFIG = {
        URL_PATTERN_REGEX: /(?:proapi\.ai\.ny\.gov|aiplatform\.googleapis\.com|generateTextContent|initiateChat|\/api\/chat|\/api\/v1)/i,
        HARD_CHAR_LIMIT: 500000,
        RESERVE_RESPONSE_CHARS: 2000,
        PANEL_HOTKEY: "Shift+Alt+I"
    };

    // Load State from Secure Storage
    const STATE = {
        ciActive: GM_getValue("aipro_ci_active", false),
        ciText: GM_getValue("aipro_ci_text", ""),
        ciPosition: GM_getValue("aipro_ci_position", "pre"),
        selectedModel: GM_getValue("aipro_main_selected_model", "gemini-3.1-pro"),
        format: GM_getValue("aipro_ci_format", "auto"),
        overflow: GM_getValue("aipro_ci_overflow", "truncate-instruction"),
        debugMode: GM_getValue("aipro_ci_debug", false) // NEW: Debug Mode State
    };

    // Bridge State to the Native Window so our Interceptors can read it synchronously
    function syncStateToNative() {
        targetWindow.__its_config = { ...STATE };
    }
    syncStateToNative();

    GM_registerMenuCommand("⚙️ Open Enhancer Settings", () => {
        const panel = document.getElementById('_ci_settings_panel');
        if (panel) panel.classList.add('open');
    });

    /**********************************************************************
     * DIAGNOSTICS & LOGGING
     **********************************************************************/
    function debugLog(context, message, data = null) {
        if (!targetWindow.__its_config || !targetWindow.__its_config.debugMode) return;
        
        const prefix = `[ITS Enhancer 🐞 | ${context}]`;
        const style = "color: #d83b01; font-weight: bold;";
        
        if (data) {
            console.log(`%c${prefix}`, style, message, data);
        } else {
            console.log(`%c${prefix}`, style, message);
        }
    }

    /**********************************************************************
     * PAYLOAD MUTATION ENGINE
     **********************************************************************/
    function applyOverflowStrategy(userText, instText, config) {
        const effectiveLimit = CONFIG.HARD_CHAR_LIMIT - CONFIG.RESERVE_RESPONSE_CHARS;
        const totalLen = userText.length + instText.length;

        debugLog("Overflow Engine", `Evaluating constraints. UserText: ${userText.length} | InstText: ${instText.length} | Total: ${totalLen} | Limit: ${effectiveLimit}`);

        if (totalLen <= effectiveLimit) {
            debugLog("Overflow Engine", "Constraint check passed. No truncation needed.");
            return { userText, instText, blocked: false };
        }
        
        console.warn(`[ITS Enhancer] Overflow detected. Strategy: ${config.overflow}`);

        if (config.overflow === "block-request") {
            debugLog("Overflow Engine", "Request explicitly blocked by strategy.");
            return { userText, instText, blocked: true };
        }
        
        if (config.overflow === "truncate-instruction") {
            const truncatedInst = instText.substring(0, Math.max(0, effectiveLimit - userText.length));
            debugLog("Overflow Engine", `Instruction truncated to ${truncatedInst.length} characters.`);
            return { userText, instText: truncatedInst, blocked: false };
        }
        
        if (config.overflow === "truncate-prompt") {
            const truncatedUser = userText.substring(0, Math.max(0, effectiveLimit - instText.length));
            debugLog("Overflow Engine", `User prompt truncated to ${truncatedUser.length} characters.`);
            return { userText: truncatedUser, instText, blocked: false };
        }
        
        return { userText, instText, blocked: false };
    }

    function injectInstructions(payload, config) {
        let fmt = config.format;
        const instBlock = `\n\n[SYSTEM DIRECTIVE: Follow these instructions strictly]\n${config.ciText}\n[/END SYSTEM DIRECTIVE]\n`;

        debugLog("Injector", `Attempting injection. Target format: ${fmt}`);

        // 1. Native AI Pro Format (FormData userMessage)
        if ((fmt === "auto" || fmt === "aipro") && payload.userMessage !== undefined) {
            debugLog("Injector", "Matched 'aipro' schema (userMessage).");
            let { userText, instText, blocked } = applyOverflowStrategy(payload.userMessage || "", instBlock, config);
            if (blocked) throw new Error("OVERFLOW_BLOCKED");
            payload.userMessage = config.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText;
            return true;
        }

        // 2. Vertex AI Format
        if ((fmt === "auto" || fmt === "vertex") && (payload.contents !== undefined || payload.instances !== undefined)) {
            debugLog("Injector", "Matched 'vertex' schema (systemInstruction).");
            if (!payload.systemInstruction) payload.systemInstruction = { parts: [] };
            let currentSys = payload.systemInstruction.parts.map(p => p.text).join(" ");
            let { userText, instText, blocked } = applyOverflowStrategy(currentSys, instBlock, config);
            if (blocked) throw new Error("OVERFLOW_BLOCKED");
            payload.systemInstruction = { parts: [{ text: config.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText }] };
            return true;
        }

        // 3. OpenAI Format
        if ((fmt === "auto" || fmt === "openai") && Array.isArray(payload.messages)) {
            debugLog("Injector", "Matched 'openai' schema (messages array).");
            let sysMsg = payload.messages.find(m => m.role === "system");
            if (sysMsg) {
                let { userText, instText, blocked } = applyOverflowStrategy(sysMsg.content, instBlock, config);
                if (blocked) throw new Error("OVERFLOW_BLOCKED");
                sysMsg.content = config.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText;
            } else {
                let { userText, instText, blocked } = applyOverflowStrategy("", instBlock, config);
                if (blocked) throw new Error("OVERFLOW_BLOCKED");
                payload.messages.unshift({ role: "system", content: instText });
            }
            return true;
        }
        
        debugLog("Injector", "No recognized schema found for injection.", payload);
        return false;
    }

    async function processPayload(body) {
        const config = targetWindow.__its_config;
        let modified = false;
        let hijackedModel = null;
        let newBody = body;

        // --- Handle FormData ---
        if (body instanceof targetWindow.FormData || body instanceof FormData) {
            debugLog("Payload Parser", "FormData detected. Extracting blob...");
            const messageBlob = body.get('message');
            if (messageBlob) {
                let text = '';
                let filename = 'blob';
                if (messageBlob instanceof targetWindow.Blob || messageBlob instanceof Blob) {
                    text = await messageBlob.text();
                    filename = messageBlob.name || 'blob';
                } else if (typeof messageBlob === 'string') text = messageBlob;

                if (text) {
                    const payload = JSON.parse(text);
                    debugLog("Payload Parser", "Parsed JSON successfully.", payload);
                    
                    if (payload.chatModel && payload.chatModel !== config.selectedModel) {
                        debugLog("Model Router", `Swapping model from [${payload.chatModel}] to [${config.selectedModel}]`);
                        hijackedModel = config.selectedModel; 
                        payload.chatModel = config.selectedModel; 
                        modified = true;
                    }
                    if (config.ciActive && config.ciText.trim().length > 0) {
                        if (injectInstructions(payload, config)) modified = true;
                    }

                    if (modified) {
                        debugLog("Payload Parser", "Repackaging modified JSON into FormData.");
                        const newBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                        newBody = new targetWindow.FormData();
                        for (let [key, value] of body.entries()) {
                            if (key === 'message') newBody.append(key, newBlob, filename);
                            else newBody.append(key, value);
                        }
                    }
                }
            }
        } 
        // --- Handle Raw JSON String ---
        else if (typeof body === 'string') {
            try {
                const payload = JSON.parse(body);
                debugLog("Payload Parser", "Raw JSON string detected.", payload);
                if (payload.model && payload.model !== config.selectedModel) {
                    debugLog("Model Router", `Swapping model from [${payload.model}] to [${config.selectedModel}]`);
                    hijackedModel = config.selectedModel; 
                    payload.model = config.selectedModel; 
                    modified = true;
                }
                if (config.ciActive && config.ciText.trim().length > 0) {
                    if (injectInstructions(payload, config)) modified = true;
                }
                if (modified) {
                    debugLog("Payload Parser", "Repackaging JSON string.");
                    newBody = JSON.stringify(payload);
                }
            } catch (e) { /* Ignore non-JSON strings */ }
        }

        return { newBody, hijackedModel, modified };
    }

    function spoofSSEResponse(hijackedModel) {
        debugLog("Network Engine", `Spoofing SSE Stream to prevent crash for missing model: ${hijackedModel}`);
        const fakeMarkdown = `\n\n> ⚠️ **Model Routing Alert**\n> \n> The selected model (\`${hijackedModel}\`) is currently unavailable or restricted in this enterprise tenant. \n>\n> *Please use the settings panel (Shift+Alt+I) to select a different model and submit your prompt again.*`;
        const fakeStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: fakeMarkdown })}\n\n`));
                controller.close();
            }
        });
        return new Response(fakeStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    /**********************************************************************
     * DUAL INTERCEPTORS (FETCH & XHR)
     **********************************************************************/
    
    // 1. FETCH INTERCEPTOR
    const originalFetch = targetWindow.fetch;
    targetWindow.fetch = async function(...args) {
        let requestUrl = args[0] instanceof Request || args[0] instanceof targetWindow.Request ? args[0].url : args[0];
        let requestBody = args[1] ? args[1].body : null;

        if (requestUrl && CONFIG.URL_PATTERN_REGEX.test(requestUrl)) {
            debugLog("Network Engine", `FETCH caught to: ${requestUrl}`);
            
            if (requestBody) {
                try {
                    const { newBody, hijackedModel, modified } = await processPayload(requestBody);
                    if (modified) args[1].body = newBody;

                    const response = await originalFetch.apply(this, args);
                    
                    if (hijackedModel && !response.ok && [400, 403, 404].includes(response.status)) {
                        return spoofSSEResponse(hijackedModel);
                    }
                    return response;
                } catch (err) {
                    if (err.message === "OVERFLOW_BLOCKED") {
                        showToast("🛑 Request blocked. Payload exceeds hard character limit.", "warn");
                        return Promise.reject(new Error("Blocked by Overflow Strategy"));
                    }
                    console.error("[ITS Enhancer] Fetch mutation error", err);
                }
            }
        }
        return originalFetch.apply(this, args);
    };

    // 2. XHR INTERCEPTOR (For Axios / Legacy HTTP Clients)
    const origXhrOpen = targetWindow.XMLHttpRequest.prototype.open;
    const origXhrSend = targetWindow.XMLHttpRequest.prototype.send;

    targetWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._reqUrl = url;
        return origXhrOpen.apply(this, [method, url, ...rest]);
    };

    targetWindow.XMLHttpRequest.prototype.send = function(body) {
        if (this._reqUrl && CONFIG.URL_PATTERN_REGEX.test(this._reqUrl) && body) {
            debugLog("Network Engine", `XHR caught to: ${this._reqUrl}`);
            const xhrThis = this;
            
            (async () => {
                try {
                    const { newBody, modified } = await processPayload(body);
                    origXhrSend.call(xhrThis, modified ? newBody : body);
                } catch (err) {
                    if (err.message === "OVERFLOW_BLOCKED") {
                        showToast("🛑 Request blocked. Payload exceeds limit.", "warn");
                        return; // Cancel XHR dispatch entirely
                    }
                    origXhrSend.call(xhrThis, body);
                }
            })();
            return;
        }
        return origXhrSend.call(this, body);
    };

    /**********************************************************************
     * DOM & UI INJECTION
     **********************************************************************/
    function injectStyles() {
        if (document.getElementById('_ci_styles')) return;
        const style = document.createElement('style');
        style.id = '_ci_styles';
        style.innerHTML = `
            :root {
                --ci-primary: #005ea2; --ci-primary-hover: #004578; --ci-bg: #ffffff;
                --ci-border: #e1dfdd; --ci-text: #323130; --ci-text-muted: #605e5c;
                --ci-shadow: 0 8px 24px rgba(0,0,0,0.15); --ci-radius: 8px; --ci-z: 2147483647;
                --ci-success: #107c41; --ci-warn: #d83b01;
            }
            ._ci_wrapper { position: fixed; bottom: 24px; right: 24px; z-index: var(--ci-z); font-family: 'Segoe UI', system-ui, sans-serif; }
            ._ci_toggle {
                display: flex; align-items: center; gap: 8px; background: var(--ci-primary);
                color: #fff; border: none; border-radius: 24px; padding: 10px 20px;
                font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,94,162,0.3);
                transition: all 0.2s ease;
            }
            ._ci_toggle:hover { background: var(--ci-primary-hover); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,94,162,0.4); }
            ._ci_toggle[data-active="false"] { background: var(--ci-bg); color: var(--ci-text); border: 1px solid var(--ci-border); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            ._ci_toggle[data-active="false"]:hover { background: #f3f2f1; }
            ._ci_status_dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ci-success); }
            ._ci_toggle[data-active="false"] ._ci_status_dot { background: #a19f9d; }

            ._ci_panel {
                position: absolute; bottom: calc(100% + 12px); right: 0; width: 420px;
                background: var(--ci-bg); border-radius: var(--ci-radius); box-shadow: var(--ci-shadow);
                border: 1px solid var(--ci-border); display: none; flex-direction: column;
                transform-origin: bottom right; animation: ci-pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            ._ci_panel.open { display: flex; }
            @keyframes ci-pop { 0% { opacity: 0; transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
            
            ._ci_header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--ci-border); background: #f9fafb; border-radius: var(--ci-radius) var(--ci-radius) 0 0; }
            ._ci_title { font-size: 16px; font-weight: 600; color: var(--ci-text); margin: 0; display: flex; align-items: center; gap: 8px; }
            ._ci_close { background: none; border: none; cursor: pointer; color: var(--ci-text-muted); padding: 4px; border-radius: 4px; display: flex; }
            ._ci_close:hover { background: #e1dfdd; color: var(--ci-text); }
            ._ci_body { padding: 16px; display: flex; flex-direction: column; gap: 16px; max-height: 60vh; overflow-y: auto; }
            ._ci_section_title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ci-text-muted); letter-spacing: 0.5px; margin-bottom: -4px; border-bottom: 1px solid var(--ci-border); padding-bottom: 4px; }
            ._ci_row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            ._ci_col { display: flex; flex-direction: column; gap: 6px; width: 100%; }
            ._ci_label { font-size: 13px; font-weight: 600; color: var(--ci-text); display: flex; justify-content: space-between; }
            ._ci_select, ._ci_textarea {
                width: 100%; padding: 8px 10px; border: 1px solid #c8c6c4; border-radius: 4px;
                font-family: inherit; font-size: 13px; color: var(--ci-text); background: #fff; outline: none; box-sizing: border-box;
            }
            ._ci_select:focus, ._ci_textarea:focus { border-color: var(--ci-primary); }
            ._ci_textarea { height: 120px; resize: vertical; line-height: 1.5; background: #faf9f8; }
            ._ci_switch_group { display: flex; background: #f3f2f1; border-radius: 4px; padding: 2px; }
            ._ci_switch_btn { background: none; border: none; padding: 6px 12px; font-size: 12px; font-weight: 600; color: var(--ci-text-muted); border-radius: 4px; cursor: pointer; flex: 1; }
            ._ci_switch_btn.active { background: #fff; color: var(--ci-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            ._ci_footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f9fafb; border-top: 1px solid var(--ci-border); border-radius: 0 0 var(--ci-radius) var(--ci-radius); }
            ._ci_btn_save { background: var(--ci-primary); color: #fff; border: none; padding: 8px 24px; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
            ._ci_btn_save:hover { background: var(--ci-primary-hover); }
            #_ci_banner {
                position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: var(--ci-z);
                max-width: 520px; width: calc(100vw - 32px); padding: 12px 16px; border-radius: 8px;
                font-size: 13px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                display: none; align-items: center; gap: 8px;
            }
            ._ci_banner--success { background: #dff6dd; border: 1px solid #c3e8c1; color: var(--ci-success); }
            ._ci_banner--warn { background: #fff8e1; border: 1px solid #f39c12; color: #7d5a00; }
        `;
        document.head.appendChild(style);
    }

    function buildUI() {
        if (document.getElementById('_ci_main_wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = '_ci_main_wrapper';
        wrapper.className = '_ci_wrapper';

        wrapper.innerHTML = `
            <button id="_ci_toggle_btn" class="_ci_toggle" data-active="${STATE.ciActive}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M10.2 6.2L9 5M10.2 11.8L9 13M17.8 6.2L19 5M3 21l9-9M12.2 12.2l4.6-4.6"/></svg> 
                <span>Mission Control</span> <div class="_ci_status_dot"></div>
            </button>

            <div id="_ci_settings_panel" class="_ci_panel">
                <div class="_ci_header">
                    <h3 class="_ci_title">⚙️ ITS Enhancer Settings</h3>
                    <button id="_ci_close_btn" class="_ci_close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                </div>
                
                <div class="_ci_body">
                    <div class="_ci_section_title">Network Routing</div>
                    <div class="_ci_col">
                        <span class="_ci_label">Target AI Model</span>
                        <select id="_ci_model_select" class="_ci_select">
                            <option value="gemini-3.1-pro" ${STATE.selectedModel === 'gemini-3.1-pro' ? 'selected' : ''}>Gemini 3.1 Pro (Latest/Reasoning)</option>
                            <option value="gemini-2.5-pro" ${STATE.selectedModel === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro (Standard Reasoning)</option>
                            <option value="gemini-2.5-flash" ${STATE.selectedModel === 'gemini-2.5-flash' ? 'selected' : ''}>Gemini 2.5 Flash (Fast)</option>
                            <option value="gemini-2.5-flash-lite" ${STATE.selectedModel === 'gemini-2.5-flash-lite' ? 'selected' : ''}>Gemini 2.5 Flash Lite (Default)</option>
                        </select>
                    </div>

                    <div class="_ci_section_title" style="margin-top: 8px;">System Directives</div>
                    <div class="_ci_row">
                        <span class="_ci_label">Enable Injection</span>
                        <input type="checkbox" id="_ci_active_chk" ${STATE.ciActive ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px;">
                    </div>
                    
                    <div class="_ci_col">
                        <div class="_ci_label">Instructions <span id="_ci_char_count" style="color:var(--ci-text-muted); font-weight:normal;">0</span></div>
                        <textarea id="_ci_text_input" class="_ci_textarea" placeholder="e.g., Always respond in the persona of a Senior Database Architect..."></textarea>
                    </div>

                    <div class="_ci_row">
                        <span class="_ci_label">Placement</span>
                        <div class="_ci_switch_group">
                            <button class="_ci_switch_btn pos-btn ${STATE.ciPosition === 'pre' ? 'active' : ''}" data-val="pre">Prepend</button>
                            <button class="_ci_switch_btn pos-btn ${STATE.ciPosition === 'post' ? 'active' : ''}" data-val="post">Append</button>
                        </div>
                    </div>

                    <div class="_ci_section_title" style="margin-top: 8px;">Advanced Payload Handling</div>
                    <div class="_ci_col">
                        <span class="_ci_label">Target API Schema</span>
                        <select id="_ci_format_select" class="_ci_select">
                            <option value="auto" ${STATE.format === 'auto' ? 'selected' : ''}>Auto-Detect</option>
                            <option value="aipro" ${STATE.format === 'aipro' ? 'selected' : ''}>NYS AI Pro (FormData Blob)</option>
                            <option value="vertex" ${STATE.format === 'vertex' ? 'selected' : ''}>Google Vertex (systemInstruction)</option>
                            <option value="openai" ${STATE.format === 'openai' ? 'selected' : ''}>OpenAI (Role: System)</option>
                        </select>
                    </div>

                    <div class="_ci_col">
                        <span class="_ci_label">Token Limit Overflow Strategy</span>
                        <select id="_ci_overflow_select" class="_ci_select">
                            <option value="truncate-instruction" ${STATE.overflow === 'truncate-instruction' ? 'selected' : ''}>Truncate Instructions (Preserve User Prompt)</option>
                            <option value="truncate-prompt" ${STATE.overflow === 'truncate-prompt' ? 'selected' : ''}>Truncate User Prompt (Preserve Instructions)</option>
                            <option value="block-request" ${STATE.overflow === 'block-request' ? 'selected' : ''}>Block Request (Show Error)</option>
                        </select>
                    </div>

                    <div class="_ci_section_title" style="margin-top: 8px;">Developer Options</div>
                    <div class="_ci_row">
                        <span class="_ci_label">Enable Console Debugging</span>
                        <input type="checkbox" id="_ci_debug_chk" ${STATE.debugMode ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px;">
                    </div>
                </div>

                <div class="_ci_footer">
                    <span style="font-size:11px; color:var(--ci-text-muted);">Hotkey: ${CONFIG.PANEL_HOTKEY}</span>
                    <button id="_ci_save_btn" class="_ci_btn_save">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);

        // Bind DOM Elements
        const toggleBtn = document.getElementById('_ci_toggle_btn');
        const panel = document.getElementById('_ci_settings_panel');
        const closeBtn = document.getElementById('_ci_close_btn');
        const saveBtn = document.getElementById('_ci_save_btn');
        const activeChk = document.getElementById('_ci_active_chk');
        const textInput = document.getElementById('_ci_text_input');
        const charCount = document.getElementById('_ci_char_count');
        const posBtns = document.querySelectorAll('.pos-btn');
        const modelSelect = document.getElementById('_ci_model_select');
        const formatSelect = document.getElementById('_ci_format_select');
        const overflowSelect = document.getElementById('_ci_overflow_select');
        const debugChk = document.getElementById('_ci_debug_chk'); // NEW: Debug Checkbox

        textInput.value = STATE.ciText;
        charCount.innerText = textInput.value.length;

        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) debugLog("UI", "Mission Control panel opened.");
        });
        closeBtn.addEventListener('click', () => panel.classList.remove('open'));
        textInput.addEventListener('input', () => charCount.innerText = textInput.value.length);

        posBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                posBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                STATE.ciPosition = e.target.getAttribute('data-val');
            });
        });

        saveBtn.addEventListener('click', () => {
            STATE.ciActive = activeChk.checked;
            STATE.ciText = textInput.value;
            STATE.selectedModel = modelSelect.value;
            STATE.format = formatSelect.value;
            STATE.overflow = overflowSelect.value;
            STATE.debugMode = debugChk.checked; // NEW: Save Debug Mode
            
            // Save to Sandbox
            GM_setValue("aipro_ci_active", STATE.ciActive);
            GM_setValue("aipro_ci_text", STATE.ciText);
            GM_setValue("aipro_ci_position", STATE.ciPosition);
            GM_setValue("aipro_main_selected_model", STATE.selectedModel);
            GM_setValue("aipro_ci_format", STATE.format);
            GM_setValue("aipro_ci_overflow", STATE.overflow);
            GM_setValue("aipro_ci_debug", STATE.debugMode);

            // Sync to Native Window for Interceptors
            syncStateToNative();

            toggleBtn.setAttribute('data-active', STATE.ciActive);
            panel.classList.remove('open');
            
            debugLog("State", "Settings saved and synchronized to native window.", STATE);
            showToast(`✅ Enhancer Configuration Saved!`, 'success');
        });

        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.altKey && e.code === 'KeyI') {
                e.preventDefault(); panel.classList.toggle('open');
            }
        });
    }

    function showToast(htmlMsg, type = 'success') {
        let banner = document.getElementById('_ci_banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = '_ci_banner';
            document.body.appendChild(banner);
        }
        banner.className = `_ci_banner--${type}`;
        banner.innerHTML = htmlMsg;
        banner.style.display = 'flex';
        setTimeout(() => { banner.style.display = 'none'; }, 4000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectStyles(); buildUI(); });
    } else {
        injectStyles(); buildUI();
    }

})();
