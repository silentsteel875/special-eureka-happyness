// ==UserScript==
// @name         ITS AI Pro — Ultimate Web Enhancer (Model Router + Custom Instructions)
// @namespace    https://its.ny.gov/
// @version      4.0.0
// @description  Unified interception platform: Native Model Routing (with SSE spoofing) + Advanced Custom Instructions injection (Auto/Vertex/OpenAI formats).
// @author       ITS Platform Team
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 1. Prevent running inside iframes (Outlook slider) or Auth Popups
    if (window.top !== window.self) return;
    if (window.name === 'AI_PRO_AUTH') return;

    console.log("[ITS Enhancer v4.0] Initializing Unified Native Web Client Enhancer...");

    /**********************************************************************
     * GLOBAL CONFIGURATION & STATE
     **********************************************************************/
    const CONFIG = {
        URL_PATTERN_REGEX: /(?:proapi\.ai\.ny\.gov|aiplatform\.googleapis\.com|generateTextContent|initiateChat|\/api\/chat|\/api\/v1)/i,
        HARD_CHAR_LIMIT: 500000,
        RESERVE_RESPONSE_CHARS: 2000,
        PANEL_HOTKEY: "Shift+Alt+I",
        STORAGE_ACTIVE: "aipro_ci_active",
        STORAGE_TEXT: "aipro_ci_text",
        STORAGE_POS: "aipro_ci_position",
        STORAGE_MODEL: "aipro_main_selected_model",
        STORAGE_FORMAT: "aipro_ci_format",
        STORAGE_OVERFLOW: "aipro_ci_overflow"
    };

    const STATE = {
        ciActive: GM_getValue(CONFIG.STORAGE_ACTIVE, false),
        ciText: GM_getValue(CONFIG.STORAGE_TEXT, ""),
        ciPosition: GM_getValue(CONFIG.STORAGE_POS, "pre"),
        selectedModel: GM_getValue(CONFIG.STORAGE_MODEL, "gemini-3.1-pro"),
        format: GM_getValue(CONFIG.STORAGE_FORMAT, "auto"),
        overflow: GM_getValue(CONFIG.STORAGE_OVERFLOW, "truncate-instruction")
    };

    // Register Menu Command for easy access
    GM_registerMenuCommand("⚙️ Open Enhancer Settings", () => {
        const panel = document.getElementById('_ci_settings_panel');
        if (panel) panel.classList.add('open');
    });

    /**********************************************************************
     * PAYLOAD MUTATION LOGIC
     **********************************************************************/
    function applyOverflowStrategy(userText, instText) {
        const effectiveLimit = CONFIG.HARD_CHAR_LIMIT - CONFIG.RESERVE_RESPONSE_CHARS;
        const totalLen = userText.length + instText.length;

        if (totalLen <= effectiveLimit) return { userText, instText, blocked: false };

        console.warn(`[ITS Enhancer] Overflow detected: ${totalLen} > ${effectiveLimit}. Strategy: ${STATE.overflow}`);

        if (STATE.overflow === "block-request") {
            return { userText, instText, blocked: true };
        }

        if (STATE.overflow === "truncate-instruction") {
            const spaceForInst = Math.max(0, effectiveLimit - userText.length);
            return { userText, instText: instText.substring(0, spaceForInst), blocked: false };
        }

        if (STATE.overflow === "truncate-prompt") {
            const spaceForPrompt = Math.max(0, effectiveLimit - instText.length);
            return { userText: userText.substring(0, spaceForPrompt), instText, blocked: false };
        }

        return { userText, instText, blocked: false };
    }

    function injectInstructions(payload) {
        let fmt = STATE.format;
        const instBlock = `\n\n[SYSTEM DIRECTIVE: Follow these instructions strictly]\n${STATE.ciText}\n[/END SYSTEM DIRECTIVE]\n`;

        // 1. Native AI Pro Format (UserMessage String)
        if ((fmt === "auto" || fmt === "aipro") && payload.userMessage !== undefined) {
            let { userText, instText, blocked } = applyOverflowStrategy(payload.userMessage || "", instBlock);
            if (blocked) throw new Error("OVERFLOW_BLOCKED");
            payload.userMessage = STATE.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText;
            return true;
        }

        // 2. Vertex AI Format (systemInstruction object)
        if ((fmt === "auto" || fmt === "vertex") && (payload.contents !== undefined || payload.instances !== undefined)) {
            // Vertex uses top-level systemInstruction
            if (!payload.systemInstruction) payload.systemInstruction = { parts: [] };
            let currentSys = payload.systemInstruction.parts.map(p => p.text).join(" ");
            let { userText, instText, blocked } = applyOverflowStrategy(currentSys, instBlock);
            if (blocked) throw new Error("OVERFLOW_BLOCKED");
            payload.systemInstruction = { parts: [{ text: STATE.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText }] };
            return true;
        }

        // 3. OpenAI API Format (messages array)
        if ((fmt === "auto" || fmt === "openai") && Array.isArray(payload.messages)) {
            let sysMsg = payload.messages.find(m => m.role === "system");
            if (sysMsg) {
                let { userText, instText, blocked } = applyOverflowStrategy(sysMsg.content, instBlock);
                if (blocked) throw new Error("OVERFLOW_BLOCKED");
                sysMsg.content = STATE.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText;
            } else {
                let { userText, instText, blocked } = applyOverflowStrategy("", instBlock);
                if (blocked) throw new Error("OVERFLOW_BLOCKED");
                payload.messages.unshift({ role: "system", content: instText });
            }
            return true;
        }

        // 4. Generic Prefix Format (Fallback)
        if (fmt === "prefix" || fmt === "auto") {
            // Traverse object to find the first large string and inject
            for (let key in payload) {
                if (typeof payload[key] === 'string' && payload[key].length > 10) {
                    let { userText, instText, blocked } = applyOverflowStrategy(payload[key], instBlock);
                    if (blocked) throw new Error("OVERFLOW_BLOCKED");
                    payload[key] = STATE.ciPosition === "pre" ? instText + "\n" + userText : userText + "\n" + instText;
                    return true;
                }
            }
        }
        return false;
    }

    /**********************************************************************
     * UNIFIED FETCH INTERCEPTOR (THE MAN-IN-THE-MIDDLE)
     **********************************************************************/
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        let [resource, config] = args;
        let url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
        let hijackedModel = null;

        // Target the standard API generation endpoints
        if (url && CONFIG.URL_PATTERN_REGEX.test(url) && config && config.body) {
            
            // Handle FormData (Native AI Pro)
            if (config.body instanceof FormData) {
                const messageBlob = config.body.get('message');
                if (messageBlob) {
                    try {
                        const text = await messageBlob.text();
                        const payload = JSON.parse(text);
                        let payloadModified = false;
                        
                        // A. MODEL ROUTER
                        if (payload.chatModel && payload.chatModel !== STATE.selectedModel) {
                            hijackedModel = STATE.selectedModel;
                            payload.chatModel = STATE.selectedModel;
                            console.log(`[ITS Enhancer] 🥷 Swapping Model: -> ${STATE.selectedModel}`);
                            payloadModified = true;
                        }

                        // B. CUSTOM INSTRUCTIONS
                        if (STATE.ciActive && STATE.ciText.trim().length > 0) {
                            try {
                                if (injectInstructions(payload)) {
                                    console.log(`[ITS Enhancer] 💉 Injected ${STATE.ciText.length} chars of custom instructions using format: ${STATE.format}.`);
                                    payloadModified = true;
                                }
                            } catch (err) {
                                if (err.message === "OVERFLOW_BLOCKED") {
                                    showToast("🛑 Request blocked. Payload exceeds hard character limit.", "warn");
                                    return Promise.reject(new Error("Request Blocked by Overflow Strategy"));
                                }
                            }
                        }

                        // C. REPACKAGE
                        if (payloadModified) {
                            const newBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                            const newFormData = new FormData();
                            for (let [key, value] of config.body.entries()) {
                                if (key === 'message') newFormData.append(key, newBlob, 'blob');
                                else newFormData.append(key, value);
                            }
                            config.body = newFormData;
                        }

                    } catch (e) {
                        console.error("[ITS Enhancer] ⚠️ Failed to parse/rewrite FormData payload", e);
                    }
                }
            } 
            // Handle Raw JSON (Proxy / Custom Backends)
            else if (typeof config.body === 'string') {
                try {
                    const payload = JSON.parse(config.body);
                    let payloadModified = false;

                    // A. MODEL ROUTER (For generic payloads)
                    if (payload.model && payload.model !== STATE.selectedModel) {
                        hijackedModel = STATE.selectedModel;
                        payload.model = STATE.selectedModel;
                        payloadModified = true;
                    }

                    // B. CUSTOM INSTRUCTIONS
                    if (STATE.ciActive && STATE.ciText.trim().length > 0) {
                        try {
                            if (injectInstructions(payload)) payloadModified = true;
                        } catch (err) {
                            if (err.message === "OVERFLOW_BLOCKED") return Promise.reject(new Error("Request Blocked by Overflow Strategy"));
                        }
                    }

                    // C. REPACKAGE
                    if (payloadModified) {
                        config.body = JSON.stringify(payload);
                    }
                } catch (e) {
                    console.error("[ITS Enhancer] ⚠️ Failed to parse/rewrite JSON payload", e);
                }
            }
        }

        try {
            // Release the modified request to the actual backend
            const response = await originalFetch.apply(this, args);
            
            // --- GRACEFUL DEGRADATION: SSE SPOOFING ---
            if (hijackedModel && !response.ok && (response.status === 400 || response.status === 403 || response.status === 404)) {
                console.warn(`[ITS Enhancer] Backend rejected model ${hijackedModel}. Spoofing graceful error response.`);
                showToast(`⚠️ Model '${hijackedModel}' is currently unavailable.`, 'warn');

                const fakeMarkdown = `\n\n> ⚠️ **Model Routing Alert**\n> \n> The selected model (\`${hijackedModel}\`) is currently unavailable or restricted in this enterprise tenant. \n>\n> *Please use the settings panel (Shift+Alt+I) to select a different model and submit your prompt again.*`;
                
                const fakeStream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: fakeMarkdown })}\n\n`));
                        controller.close();
                    }
                });
                
                return new Response(fakeStream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return response;
        } catch (err) {
            return Promise.reject(err);
        }
    };

    /**********************************************************************
     * UNIFIED DOM & UI INJECTION
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
                font-family: inherit; font-size: 13px; color: var(--ci-text); background: #fff;
                outline: none; box-sizing: border-box;
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

        const svgWand = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M10.2 6.2L9 5M10.2 11.8L9 13M17.8 6.2L19 5M3 21l9-9M12.2 12.2l4.6-4.6"/></svg>`;
        const svgClose = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

        wrapper.innerHTML = `
            <button id="_ci_toggle_btn" class="_ci_toggle" data-active="${STATE.ciActive}">
                ${svgWand} <span>Mission Control</span> <div class="_ci_status_dot"></div>
            </button>

            <div id="_ci_settings_panel" class="_ci_panel">
                <div class="_ci_header">
                    <h3 class="_ci_title">⚙️ ITS Enhancer Settings</h3>
                    <button id="_ci_close_btn" class="_ci_close">${svgClose}</button>
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
                        <textarea id="_ci_text_input" class="_ci_textarea" placeholder="e.g., Always respond in the persona of a Senior Database Architect. Never use bullet points..."></textarea>
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

        // Form Inputs
        const modelSelect = document.getElementById('_ci_model_select');
        const formatSelect = document.getElementById('_ci_format_select');
        const overflowSelect = document.getElementById('_ci_overflow_select');

        // Initialize values
        textInput.value = STATE.ciText;
        charCount.innerText = textInput.value.length;

        // Toggle Panel
        toggleBtn.addEventListener('click', () => panel.classList.toggle('open'));
        closeBtn.addEventListener('click', () => panel.classList.remove('open'));

        // Character Counter
        textInput.addEventListener('input', () => charCount.innerText = textInput.value.length);

        // Position Switches
        posBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                posBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                STATE.ciPosition = e.target.getAttribute('data-val');
            });
        });

        // Save Logic
        saveBtn.addEventListener('click', () => {
            STATE.ciActive = activeChk.checked;
            STATE.ciText = textInput.value;
            STATE.selectedModel = modelSelect.value;
            STATE.format = formatSelect.value;
            STATE.overflow = overflowSelect.value;
            
            GM_setValue(CONFIG.STORAGE_ACTIVE, STATE.ciActive);
            GM_setValue(CONFIG.STORAGE_TEXT, STATE.ciText);
            GM_setValue(CONFIG.STORAGE_POS, STATE.ciPosition);
            GM_setValue(CONFIG.STORAGE_MODEL, STATE.selectedModel);
            GM_setValue(CONFIG.STORAGE_FORMAT, STATE.format);
            GM_setValue(CONFIG.STORAGE_OVERFLOW, STATE.overflow);

            toggleBtn.setAttribute('data-active', STATE.ciActive);
            panel.classList.remove('open');
            
            showToast(`✅ Enhancer Configuration Saved!`, 'success');
        });

        // Hotkey Listener
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.altKey && e.code === 'KeyI') {
                e.preventDefault();
                panel.classList.toggle('open');
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

    // Boot the UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectStyles(); buildUI(); });
    } else {
        injectStyles(); buildUI();
    }

})();
