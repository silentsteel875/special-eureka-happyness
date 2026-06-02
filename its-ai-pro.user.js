// ==UserScript==
// @name         ITS AI Pro — Custom Instructions Injector (Diagnostic)
// @namespace    https://its.ny.gov/
// @version      2.4.0
// @description  Hardened modular interception platform custom-built to decode FormData JSON Blobs and inject system directives safely with unconditional console diagnostics.
// @author       ITS Platform Team
// @match        https://aipro.its.ny.gov/*
// @match        https://*.its.ny.gov/*
// @match        http://localhost:*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // IMMEDIATE TOP-LEVEL CONSOLE SIGNATURE
  console.log("%c[AI Pro CI] Core script successfully mounted into execution frame at document-start.", "color: #154973; font-weight: bold; font-size: 12px;");

  /**********************************************************************
   * GLOBAL CODE CONFIGURATION
   **********************************************************************/
  const CONFIG = {
    // Broadened slightly to capture any variant of the proapi or chat endpoints
    URL_PATTERN_REGEX: /(?:proapi|ai\.ny\.gov|aiplatform|generateTextContent|initiateChat|\/api\/chat|\/v1\/messages|\/completions)/i,
    REQUEST_FORMAT:    "aipro-multipart", 
    HARD_CHAR_LIMIT:   500000,
    OVERFLOW_STRATEGY: "truncate-instruction",
    PANEL_HOTKEY:      "Shift+Alt+I",
    STORAGE_KEY:       "aipro_ci_v3",
  };

  /**********************************************************************
   * STORAGE ENGINE LAYER
   **********************************************************************/
  window.AIProStorage = (() => {
    const DEFAULT_SETTINGS = {
      enabled:          true,
      instruction:      "",
      requestFormat:    CONFIG.REQUEST_FORMAT,
      overflowStrategy: CONFIG.OVERFLOW_STRATEGY,
      hardCharLimit:    CONFIG.HARD_CHAR_LIMIT,
      requestCount:     0,
      injectedCount:    0,
      skippedCount:     0,
    };

    let cachedSettings = null;

    function load() {
      if (cachedSettings) return cachedSettings;
      try {
        const raw = (typeof GM_getValue !== "undefined")
          ? GM_getValue(CONFIG.STORAGE_KEY, null)
          : localStorage.getItem(CONFIG.STORAGE_KEY);
        cachedSettings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
      } catch (_) {
        cachedSettings = { ...DEFAULT_SETTINGS };
      }
      return cachedSettings;
    }

    function save(updatedSettings) {
      cachedSettings = updatedSettings;
      const json = JSON.stringify(cachedSettings);
      try {
        if (typeof GM_setValue !== "undefined") GM_setValue(CONFIG.STORAGE_KEY, json);
        localStorage.setItem(CONFIG.STORAGE_KEY, json);
      } catch (e) {
        console.warn("[AI Pro CI] Could not persist state engine:", e);
      }
    }

    return { load, save };
  })();

  /**********************************************************************
   * CORE INJECTION PROCESSING ENGINE
   **********************************************************************/
  window.AIProPromptInjector = (() => {
    
    function process(payload, settings) {
      const format = settings.requestFormat;
      const strategy = settings.overflowStrategy;
      const limit = settings.hardCharLimit;
      const instruction = settings.instruction;

      if (format === "aipro-multipart" || payload.userMessage !== undefined) {
        const userText = payload.userMessage ?? "";
        const combined = instruction.length + userText.length;
        let finalInst = instruction;

        if (combined > limit) {
          const r = handleOverflow(instruction, userText, limit, strategy, payload, "aipro-multipart");
          if (r.skip) return { skipped: true, reason: r.reason };
          finalInst = r.instruction;
        }

        const cloned = safeClone(payload);
        cloned.userMessage = `[System Directive]\n${finalInst}\n\n[User Prompt]\n${userText}`;
        return { payload: cloned };
      }

      if (format === "vertex") {
        const userText = extractVertexUserText(payload);
        const combined = instruction.length + userText.length;
        let finalInst = instruction;

        if (combined > limit) {
          const r = handleOverflow(instruction, userText, limit, strategy, payload, "vertex");
          if (r.skip) return { skipped: true, reason: r.reason };
          if (r.payload) return { payload: r.payload };
          finalInst = r.instruction;
        }

        const cloned = safeClone(payload);
        cloned.systemInstruction = {
          role: "system",
          parts: [{ text: mergeWithExisting(finalInst, cloned.systemInstruction) }],
        };
        return { payload: cloned };
      }

      if (format === "openai") {
        const msgs = payload.messages ?? [];
        const userText = msgs.filter(m => m.role === "user").map(m => m.content ?? "").join(" ");
        const combined = instruction.length + userText.length;
        let finalInst = instruction;

        if (combined > limit) {
          const r = handleOverflow(instruction, userText, limit, strategy, payload, "openai");
          if (r.skip) return { skipped: true, reason: r.reason };
          finalInst = r.instruction ?? instruction;
        }

        const cloned = safeClone(payload);
        if (!cloned.messages) cloned.messages = [];
        const sysIdx = cloned.messages.findIndex(m => m.role === "system");
        const sysText = mergeWithExisting(finalInst, sysIdx >= 0 ? cloned.messages[sysIdx].content : null);

        if (sysIdx >= 0) {
          cloned.messages[sysIdx].content = sysText;
        } else {
          cloned.messages.unshift({ role: "system", content: sysText });
        }
        return { payload: cloned };
      }

      return { payload };
    }

    function handleOverflow(instruction, userText, limit, strategy, payload, format) {
      const excess = (instruction.length + userText.length) - limit;
      const pct = Math.round((excess / limit) * 100);
      const msg = `Custom instruction + user input exceeds limit by ~${excess.toLocaleString()} chars (${pct}% over).`;

      switch (strategy) {
        case "truncate-instruction": {
          const maxInst = Math.max(0, limit - userText.length - 100);
          const trimmed = instruction.slice(0, maxInst) +
            (maxInst < instruction.length ? "\n… [instruction truncated to fit context limit]" : "");
          return { instruction: trimmed };
        }
        case "truncate-input": {
          const maxUser = Math.max(0, limit - instruction.length - 100);
          const cloned = safeClone(payload);
          if (format === "aipro-multipart") {
            if (cloned.userMessage) cloned.userMessage = cloned.userMessage.slice(0, maxUser) + "… [truncated]";
          }
          return { payload: cloned };
        }
        case "warn-and-skip": return { skip: true, reason: msg };
        case "block": return { skip: true, reason: msg };
        default: return { instruction: instruction.slice(0, Math.max(0, limit - userText.length)) };
      }
    }

    function mergeWithExisting(newText, existing) {
      if (!existing) return newText;
      const existingText = typeof existing === "string" ? existing : existing?.parts?.[0]?.text ?? "";
      if (!existingText.trim()) return newText;
      return newText + "\n\n---\n\n[Original system context]\n" + existingText;
    }

    function extractVertexUserText(payload) {
      return (payload.contents ?? [])
        .filter(c => c.role === "user")
        .flatMap(c => (c.parts ?? []).map(p => p.text ?? ""))
        .join(" ");
    }

    function safeClone(obj) {
      return (typeof structuredClone !== "undefined") ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
    }

    return { process };
  })();

  /**********************************************************************
   * MIDDLEWARE LAYER INTERCEPTION ENGINE
   **********************************************************************/
  window.AIProInterceptor = (() => {
    
    function isJsonText(str) {
      if (typeof str !== 'string') return false;
      const trimmed = str.trim();
      return trimmed.startsWith('{') && trimmed.endsWith('}');
    }

    // --- Hardened Fetch Proxy Hook ---
    const _fetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      const settings = AIProStorage.load();
      let url = typeof input === "string" ? input : input?.url ?? "";
      let isRequestInstance = false;
      let requestOptions = init || {};

      if (input instanceof Request) {
        url = input.url;
        isRequestInstance = true;
      }

      // UNCONDITIONAL DIAGNOSTIC LOG (Fires on matching URL strings regardless of settings state)
      if (CONFIG.URL_PATTERN_REGEX.test(url)) {
         console.log(`%c[AI Pro CI Diagnostic] Hit URL matching target signature: ${url}`, "color: #e67e22; font-weight: bold;");
         console.log(`-> Engine Settings Status: [Enabled: ${settings.enabled}] [Has Instructions: ${!!settings.instruction.trim()}] [Active Format: ${settings.requestFormat}]`);
      }

      if (settings.enabled && settings.instruction.trim() && CONFIG.URL_PATTERN_REGEX.test(url)) {
        console.group(`[AI Pro CI Middleware] Intercepting Payload: ${url}`);
        
        try {
          let rawBody = isRequestInstance ? null : requestOptions.body;
          let isMultipartForm = false;
          let nativeHeaders = isRequestInstance ? new Headers(input.headers) : new Headers(requestOptions.headers);

          if (isRequestInstance) {
            requestOptions = {
              method: input.method,
              headers: nativeHeaders,
              credentials: input.credentials,
              mode: input.mode,
              cache: input.cache,
              redirect: input.redirect,
              referrer: input.referrer
            };
            if (input.headers.get('content-type')?.includes('multipart/form-data')) {
               try { rawBody = await input.formData(); } catch(_) {}
            } else {
               try { rawBody = await input.text(); } catch (_) {}
            }
          }

          // Case A: Multipart Form Data
          if ((rawBody instanceof FormData || requestOptions.body instanceof FormData)) {
            const workingForm = (rawBody instanceof FormData) ? rawBody : requestOptions.body;
            
            if (workingForm.has('message')) {
              const messageField = workingForm.get('message');
              let blobText = typeof messageField === 'string' ? messageField : await messageField.text();
              
              if (isJsonText(blobText)) {
                const payload = JSON.parse(blobText);
                console.log("-> Unboxed Form Message Content Body:", payload);
                
                const result = AIProPromptInjector.process(payload, settings);

                if (result.skipped) {
                  settings.skippedCount++;
                  window.AIProUI.showBanner(result.reason, "warn");
                  if (settings.overflowStrategy === "block") {
                    console.groupEnd();
                    throw new DOMException("AI Pro CI: Request blocked by strategy constraint.", "AbortError");
                  }
                } else {
                  settings.injectedCount++;
                  console.log("-> Injected Output Architecture:", result.payload);
                  
                  const reconstructedBlob = new Blob([JSON.stringify(result.payload)], { type: 'application/json' });
                  workingForm.set('message', reconstructedBlob);
                  
                  requestOptions.body = workingForm;
                  
                  // Clear strict boundary strings to trigger automatic recalculation matching new sizing limits
                  if (isRequestInstance) {
                    requestOptions.headers.delete('content-type');
                    input = new Request(url, requestOptions);
                  } else {
                    if (requestOptions.headers) {
                      if (requestOptions.headers instanceof Headers) requestOptions.headers.delete('content-type');
                      else delete requestOptions.headers['content-type'];
                    }
                  }
                  AIProStorage.save(settings);
                }
              }
            }
            isMultipartForm = true;
          }

          // Case B: Raw Serialized JSON Configurations
          if (!isMultipartForm && rawBody) {
            const bodyStr = typeof rawBody === "string" ? rawBody : await blobOrBufferToText(rawBody);
            if (bodyStr && isJsonText(bodyStr)) {
              const payload = JSON.parse(bodyStr);
              console.log("-> Processing raw JSON layout:", payload);
              const result = AIProPromptInjector.process(payload, settings);

              if (result.skipped) {
                settings.skippedCount++;
                window.AIProUI.showBanner(result.reason, "warn");
                if (settings.overflowStrategy === "block") {
                  console.groupEnd();
                  throw new DOMException("AI Pro CI: Request blocked.", "AbortError");
                }
              } else {
                settings.injectedCount++;
                requestOptions.body = JSON.stringify(result.payload);
                if (isRequestInstance) {
                  input = new Request(url, requestOptions);
                }
                AIProStorage.save(settings);
              }
            }
          }
        } catch (e) {
          if (e.name === "AbortError") throw e;
          console.warn("[AI Pro CI] Mutation error dropped:", e);
        }
        console.groupEnd();
      }

      if (CONFIG.URL_PATTERN_REGEX.test(url)) {
         settings.requestCount++;
         AIProStorage.save(settings);
      }
      return _fetch.call(this, input, isRequestInstance ? input : requestOptions);
    };

    // --- Native XMLHttpRequest Proxy Hook ---
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._xhrUrl = url;
      return _open.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const settings = AIProStorage.load();
      
      if (CONFIG.URL_PATTERN_REGEX.test(this._xhrUrl ?? "")) {
         console.log(`%c[AI Pro CI Diagnostic] Hit XHR matching target signature: ${this._xhrUrl}`, "color: #9b59b6; font-weight: bold;");
      }

      if (
        settings.enabled &&
        settings.instruction.trim() &&
        CONFIG.URL_PATTERN_REGEX.test(this._xhrUrl ?? "") &&
        typeof body === "string" &&
        isJsonText(body)
      ) {
        try {
          console.group(`[AI Pro CI Middleware] Intercepted XHR Pipeline: ${this._xhrUrl}`);
          const payload = JSON.parse(body);
          const result = AIProPromptInjector.process(payload, settings);

          if (result.skipped) {
            settings.skippedCount++;
            window.AIProUI.showBanner(result.reason, "warn");
          } else {
            settings.injectedCount++;
            body = JSON.stringify(result.payload);
          }
          AIProStorage.save(settings);
        } catch (e) {
          console.warn("[AI Pro CI] Synchronous XHR mutation bypassed", e);
        }
        console.groupEnd();
        settings.requestCount++;
        AIProStorage.save(settings);
      }
      return _send.call(this, body);
    };

    async function blobOrBufferToText(body) {
      try {
        if (body instanceof Blob) return await body.text();
        if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
        if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body.buffer);
      } catch (_) {}
      return null;
    }

  })();

  /**********************************************************************
   * INTERFACE MANAGEMENT & UI LAYER
   **********************************************************************/
  window.AIProUI = (() => {
    let bannerTimeout;

    function showBanner(message, type = "warn") {
      let banner = document.getElementById("_ci_banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "_ci_banner";
        document.body.appendChild(banner);
      }
      banner.className = `_ci_banner _ci_banner--${type}`;
      banner.innerHTML = `<strong>AI Pro CI:</strong> ${escapeHtml(message)}`;
      banner.style.display = "block";
      clearTimeout(bannerTimeout);
      bannerTimeout = setTimeout(() => { banner.style.display = "none"; }, 7000);
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function init() {
      if (document.getElementById("_ci_fab")) return;

      injectStyles();

      const fab = document.createElement("button");
      fab.id = "_ci_fab";
      fab.title = `Custom Instructions (${CONFIG.PANEL_HOTKEY})`;
      fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
        <path d="M12 16v-4m0-4h.01"/>
      </svg>`;
      fab.setAttribute("aria-label", "Toggle Custom Instructions Panel");

      const panel = document.createElement("div");
      panel.id = "_ci_panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Custom Instructions Settings");
      panel.hidden = true;
      panel.innerHTML = buildPanelHTML();

      document.body.appendChild(fab);
      document.body.appendChild(panel);

      syncUIFromSettings();

      fab.addEventListener("click", () => togglePanel());

      panel.querySelector("#_ci_enabled").addEventListener("change", e => {
        const settings = AIProStorage.load();
        settings.enabled = e.target.checked;
        AIProStorage.save(settings);
        updateFabState(settings);
        syncStats(settings);
      });

      const ta = panel.querySelector("#_ci_text");
      ta.addEventListener("input", () => {
        const settings = AIProStorage.load();
        updateCharCounter(ta.value, settings);
      });

      panel.querySelector("#_ci_format").addEventListener("change", e => {
        const settings = AIProStorage.load();
        settings.requestFormat = e.target.value;
        AIProStorage.save(settings);
      });

      panel.querySelector("#_ci_overflow").addEventListener("change", e => {
        const settings = AIProStorage.load();
        settings.overflowStrategy = e.target.value;
        AIProStorage.save(settings);
      });

      panel.querySelector("#_ci_limit").addEventListener("change", e => {
        const settings = AIProStorage.load();
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v) && v > 0) {
          settings.hardCharLimit = v;
          AIProStorage.save(settings);
          updateCharCounter(ta.value, settings);
        }
      });

      panel.querySelector("#_ci_save").addEventListener("click", () => {
        const settings = AIProStorage.load();
        settings.instruction      = ta.value.trim();
        settings.overflowStrategy = panel.querySelector("#_ci_overflow").value;
        settings.requestFormat    = panel.querySelector("#_ci_format").value;
        const lv = parseInt(panel.querySelector("#_ci_limit").value, 10);
        if (!isNaN(lv) && lv > 0) settings.hardCharLimit = lv;
        AIProStorage.save(settings);
        showSaveConfirmation(settings);
      });

      panel.querySelector("#_ci_clear").addEventListener("click", () => {
        if (!confirm("Clear custom instructions?")) return;
        const settings = AIProStorage.load();
        ta.value = "";
        settings.instruction = "";
        AIProStorage.save(settings);
        updateCharCounter("", settings);
        updateFabState(settings);
      });

      panel.querySelector("#_ci_reset_stats").addEventListener("click", () => {
        const settings = AIProStorage.load();
        settings.requestCount = settings.injectedCount = settings.skippedCount = 0;
        AIProStorage.save(settings);
        syncStats(settings);
      });

      panel.querySelector("#_ci_close").addEventListener("click", () => togglePanel(false));

      document.addEventListener("keydown", e => {
        if (matchHotkey(e, CONFIG.PANEL_HOTKEY)) { e.preventDefault(); togglePanel(); }
        if (e.key === "Escape" && !panel.hidden)  togglePanel(false);
      });

      document.addEventListener("mousedown", e => {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== fab) togglePanel(false);
      });
    }

    function buildPanelHTML() {
      return `
        <header class="_ci_header">
          <div class="_ci_title"><span class="_ci_badge">ITS</span>Custom Instructions</div>
          <div class="_ci_header_actions">
            <label class="_ci_switch" title="Enable / disable injection">
              <input type="checkbox" id="_ci_enabled">
              <span class="_ci_slider"></span>
            </label>
            <button id="_ci_close" class="_ci_icon_btn" aria-label="Close panel">✕</button>
          </div>
        </header>
        <section class="_ci_section">
          <label class="_ci_label" for="_ci_text">System Instructions <span class="_ci_hint">Injected silently into matching payloads</span></label>
          <div class="_ci_ta_wrap">
            <textarea id="_ci_text" class="_ci_ta" rows="8" placeholder="Enter custom identity rules, schemas, or system directives here..." spellcheck="true"></textarea>
            <div class="_ci_ta_footer">
              <span id="_ci_char_count" class="_ci_char_count">0 chars</span>
              <span id="_ci_char_warn" class="_ci_char_warn _ci_hidden"></span>
            </div>
          </div>
        </section>
        <section class="_ci_section _ci_section--config">
          <div class="_ci_field_row">
            <div class="_ci_field">
              <label class="_ci_label" for="_ci_format">Request Format</label>
              <select id="_ci_format" class="_ci_select">
                <option value="aipro-multipart">AI Pro Spec (Multipart)</option>
                <option value="vertex">Vertex AI Envelope</option>
                <option value="openai">OpenAI Matrix</option>
              </select>
            </div>
            <div class="_ci_field">
              <label class="_ci_label" for="_ci_limit">Char Limit</label>
              <input id="_ci_limit" class="_ci_input" type="number" min="1000" step="5000">
            </div>
          </div>
          <div class="_ci_field" style="margin-top:10px;">
            <label class="_ci_label" for="_ci_overflow">On limit overflow</label>
            <select id="_ci_overflow" class="_ci_select">
              <option value="truncate-instruction">Trim instruction to fit</option>
              <option value="truncate-input">Trim user input to fit</option>
              <option value="warn-and-skip">Warn &amp; skip injection</option>
              <option value="block">Warn &amp; block request</option>
            </select>
          </div>
        </section>
        <section class="_ci_section">
          <div class="_ci_stats">
            <div class="_ci_stat"><span class="_ci_stat_val" id="_ci_s_req">0</span><span class="_ci_stat_lbl">Requests</span></div>
            <div class="_ci_stat"><span class="_ci_stat_val" id="_ci_s_inj">0</span><span class="_ci_stat_lbl">Injected</span></div>
            <div class="_ci_stat"><span class="_ci_stat_val" id="_ci_s_skp">0</span><span class="_ci_stat_lbl">Skipped</span></div>
            <button id="_ci_reset_stats" class="_ci_ghost_btn">Reset</button>
          </div>
        </section>
        <footer class="_ci_footer">
          <button id="_ci_clear" class="_ci_ghost_btn">Clear</button>
          <div class="_ci_footer_right">
            <span id="_ci_save_confirm" class="_ci_save_confirm _ci_hidden">✓ Saved</span>
            <button id="_ci_save" class="_ci_primary_btn">Save</button>
          </div>
        </footer>`;
    }

    function togglePanel(force) {
      const panel = document.getElementById("_ci_panel");
      const fab   = document.getElementById("_ci_fab");
      if (!panel) return;
      const show = (force !== undefined) ? force : panel.hidden;
      panel.hidden = !show;
      fab.classList.toggle("_ci_fab--open", show);
      if (show) {
        const settings = AIProStorage.load();
        syncStats(settings);
        panel.querySelector("#_ci_text")?.focus();
      }
    }

    function syncUIFromSettings() {
      const settings = AIProStorage.load();
      const get = id => document.getElementById(id);
      if (get("_ci_enabled"))  get("_ci_enabled").checked  = settings.enabled;
      if (get("_ci_text"))     get("_ci_text").value        = settings.instruction;
      if (get("_ci_format"))   get("_ci_format").value      = settings.requestFormat;
      if (get("_ci_overflow")) get("_ci_overflow").value    = settings.overflowStrategy;
      if (get("_ci_limit"))    get("_ci_limit").value       = settings.hardCharLimit;
      updateCharCounter(settings.instruction, settings);
      updateFabState(settings);
      syncStats(settings);
    }

    function updateCharCounter(text, settings) {
      const countEl = document.getElementById("_ci_char_count");
      const warnEl  = document.getElementById("_ci_char_warn");
      if (!countEl) return;

      const len = text.length;
      const pct = Math.round((len / settings.hardCharLimit) * 100);
      countEl.textContent = `${len.toLocaleString()} chars`;

      if (pct >= 90) {
        countEl.style.color = "var(--ci-danger)";
        warnEl.textContent  = `${pct}% of limit — minimal input space remains`;
        warnEl.classList.remove("_ci_hidden");
      } else if (pct >= 70) {
        countEl.style.color = "var(--ci-warn)";
        warnEl.textContent  = `${pct}% of limit`;
        warnEl.classList.remove("_ci_hidden");
      } else {
        countEl.style.color = "";
        warnEl.classList.add("_ci_hidden");
      }
    }

    function updateFabState(settings) {
      const fab = document.getElementById("_ci_fab");
      if (!fab) return;
      const active = settings.enabled && !!settings.instruction.trim();
      fab.classList.toggle("_ci_fab--active",   active);
      fab.classList.toggle("_ci_fab--inactive", !active);
    }

    function syncStats(settings) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set("_ci_s_req", settings.requestCount.toLocaleString());
      set("_ci_s_inj", settings.injectedCount.toLocaleString());
      set("_ci_s_skp", settings.skippedCount.toLocaleString());
    }

    let saveConfirmTimer;
    function showSaveConfirmation(settings) {
      const el = document.getElementById("_ci_save_confirm");
      if (!el) return;
      el.classList.remove("_ci_hidden");
      updateFabState(settings);
      clearTimeout(saveConfirmTimer);
      saveConfirmTimer = setTimeout(() => el.classList.add("_ci_hidden"), 2500);
    }

    function matchHotkey(e, combo) {
      const parts = combo.split("+");
      return parts.includes("Shift") === e.shiftKey
          && parts.includes("Alt")   === e.altKey
          && parts.includes("Ctrl")  === e.ctrlKey
          && parts.includes("Meta")  === e.metaKey
          && parts.filter(p => !["Shift","Alt","Ctrl","Meta"].includes(p))
                   .every(k => e.key === k || e.code === `Key${k}`);
    }

    function injectStyles() {
      const style = document.createElement("style");
      style.id = "_ci_styles";
      style.textContent = `
        :root {
          --ci-blue: #154973; --ci-gold: #FACE00; --ci-bg: #f8f9fb; --ci-surface: #ffffff; --ci-border: #dde2ea;
          --ci-text: #1a2436; --ci-muted: #6b7a90; --ci-danger: #c0392b; --ci-warn: #e67e22; --ci-success: #27ae60;
          --ci-radius: 10px; --ci-shadow: 0 8px 32px rgba(21,73,115,.18), 0 2px 8px rgba(0,0,0,.08); --ci-z: 2147483647;
        }
        #_ci_fab {
          position: fixed; bottom: 24px; right: 24px; z-index: var(--ci-z); width: 48px; height: 48px; border-radius: 50%; border: none;
          background: var(--ci-blue); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(21,73,115,.35); transition: transform .15s ease, background .15s; outline: none;
        }
        #_ci_fab:hover { transform: scale(1.08); }
        #_ci_fab svg { width: 22px; height: 22px; }
        #_ci_fab._ci_fab--open { background: #0d3255; }
        #_ci_fab._ci_fab--active::after {
          content: ''; position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%;
          background: var(--ci-gold); border: 2px solid #fff;
        }
        #_ci_panel {
          position: fixed; bottom: 82px; right: 24px; z-index: var(--ci-z); width: 440px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px);
          overflow-y: auto; background: var(--ci-surface); border: 1px solid var(--ci-border); border-radius: var(--ci-radius);
          box-shadow: var(--ci-shadow); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; color: var(--ci-text);
        }
        #_ci_panel[hidden] { display: none; }
        ._ci_header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: var(--ci-blue); color: #fff; border-radius: var(--ci-radius) var(--ci-radius) 0 0; }
        ._ci_title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
        ._ci_badge { background: var(--ci-gold); color: var(--ci-blue); font-weight: 800; font-size: 10px; padding: 2px 5px; border-radius: 4px; }
        ._ci_header_actions { display: flex; align-items: center; gap: 10px; }
        ._ci_switch { position: relative; display: inline-block; width: 38px; height: 22px; cursor: pointer; }
        ._ci_switch input { opacity: 0; width: 0; height: 0; }
        ._ci_slider { position: absolute; inset: 0; background: rgba(255,255,255,.25); border-radius: 22px; transition: background .2s; }
        ._ci_slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
        ._ci_switch input:checked + ._ci_slider { background: var(--ci-gold); }
        ._ci_switch input:checked + ._ci_slider::before { transform: translateX(16px); }
        ._ci_section { padding: 14px 16px; border-bottom: 1px solid var(--ci-border); }
        ._ci_section--config { display: flex; flex-direction: column; }
        ._ci_field_row { display: flex; gap: 12px; }
        ._ci_field { flex: 1; display: flex; flex-direction: column; }
        ._ci_label { display: flex; align-items: baseline; gap: 6px; font-weight: 600; font-size: 11px; color: var(--ci-text); margin-bottom: 6px; text-transform: uppercase; }
        ._ci_hint { font-size: 11px; font-weight: 400; color: var(--ci-muted); text-transform: none; }
        ._ci_ta { width: 100%; box-sizing: border-box; border: 1.5px solid var(--ci-border); border-radius: 6px; padding: 9px 11px; font-family: inherit; font-size: 13px; color: var(--ci-text); background: var(--ci-bg); resize: vertical; line-height: 1.5; outline: none; }
        ._ci_ta:focus { border-color: var(--ci-blue); background: #fff; }
        ._ci_ta_footer { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
        ._ci_select, ._ci_input { width: 100%; box-sizing: border-box; border: 1.5px solid var(--ci-border); border-radius: 6px; padding: 7px 9px; font-family: inherit; font-size: 12px; color: var(--ci-text); background: var(--ci-bg); outline: none; }
        ._ci_select:focus, ._ci_input:focus { border-color: var(--ci-blue); background: #fff; }
        ._ci_stats { display: flex; align-items: center; gap: 16px; }
        ._ci_stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        ._ci_stat_val { font-weight: 700; font-size: 18px; color: var(--ci-blue); }
        ._ci_stat_lbl { font-size: 10px; color: var(--ci-muted); text-transform: uppercase; }
        ._ci_primary_btn { background: var(--ci-blue); color: #fff; border: none; border-radius: 6px; padding: 8px 20px; font-weight: 600; cursor: pointer; }
        ._ci_ghost_btn { background: none; color: var(--ci-muted); border: 1.5px solid var(--ci-border); border-radius: 6px; padding: 7px 14px; cursor: pointer; font-size: 12px; }
        ._ci_icon_btn { background: rgba(255,255,255,.15); border: none; color: #fff; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        ._ci_footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--ci-bg); border-radius: 0 0 var(--ci-radius) var(--ci-radius); }
        ._ci_footer_right { display: flex; align-items: center; gap: 10px; }
        ._ci_save_confirm { font-size: 12px; color: var(--ci-success); font-weight: 600; }
        #_ci_banner { display: none; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: var(--ci-z); max-width: 520px; width: calc(100vw - 32px); padding: 10px 16px; border-radius: 8px; font-size: 13px; line-height: 1.4; box-shadow: 0 4px 16px rgba(0,0,0,.18); pointer-events: none; }
        ._ci_banner--warn { background: #fff8e1; border: 1.5px solid #f39c12; color: #7d5a00; }
        ._ci_banner--error { background: #fdecea; border: 1.5px solid #e74c3c; color: #7b1e1e; }
        
        /* Isolation prefix prevents layout hijacking */
        ._ci_hidden { display: none !important; }
      `;
      document.head.appendChild(style);
    }

    return { init, showBanner };
  })();

  /**********************************************************************
   * INITIALIZATION ENTRY POINT
   **********************************************************************/
  window.addEventListener("DOMContentLoaded", () => window.AIProUI.init(), { once: true });
  if (document.readyState !== "loading") setTimeout(() => window.AIProUI.init(), 500);
})();
