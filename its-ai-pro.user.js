// ==UserScript==
// @name         ITS AI Pro — Custom Instructions Injector
// @namespace    https://its.ny.gov/
// @version      2.5.0
// @description  Persists custom system instructions in browser storage and silently injects them into every AI Pro request. Handles combined-input character-limit overflows gracefully.
// @author       ITS Platform Team
// @match        https://pro.ai.ny.gov/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  URL_PATTERN_REGEX
 *    Matches the real AI Pro API endpoint at proapi.ai.ny.gov plus fallback
 *    patterns for local dev and any Vertex / OpenAI proxy environments.
 *
 *  REQUEST_FORMAT  (default "auto"; overridable in the settings panel)
 *    "auto"   → inspect the live payload and choose the right format
 *    "aipro"  → AI Pro native: injects into the `userMessage` field inside
 *               the FormData Blob.  This is the correct format for production.
 *    "vertex" → writes/merges top-level `systemInstruction`
 *    "openai" → prepends/merges a { role:"system" } message
 *    "prefix" → prepends to the first user-text field found
 *
 *  HARD_CHAR_LIMIT / RESERVE_RESPONSE_CHARS
 *    effectiveLimit = HARD_CHAR_LIMIT − RESERVE_RESPONSE_CHARS
 *    Overflow fires when (instruction + user text) > effectiveLimit.
 *    Gemini 2.5 Flash Lite context ≈ 1 M tokens.  Default ceiling is
 *    conservative; raise it if you know your model's actual window.
 *
 *  OVERFLOW_STRATEGY  (default; overridable in the settings panel)
 *    "truncate-instruction" → silently trim instruction to fit
 *    "truncate-input"       → trim userMessage to fit (use rarely)
 *    "warn-and-skip"        → banner warning; send request unmodified
 *    "block"                → banner warning; abort the request
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  MIDDLEWARE API  (for advanced users / future extensions)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Register additional payload transforms after this script loads:
 *
 *    window.__aiproCIRegister(function myTransform(payload, context) {
 *      // payload = the parsed inner JSON (userMessage, chatModel, conversationId…)
 *      // context = { type: "fetch"|"fetch-formdata"|"xhr", url: string }
 *      return payload;  // return modified or original payload
 *    });
 *
 *  Middleware runs in registration order after the built-in CI injection.
 *  Errors in middleware are caught and logged; the pipeline continues.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW AI PRO REQUESTS ARE STRUCTURED (from network telemetry)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  POST https://proapi.ai.ny.gov/api/v1/vertexai/multiModalInputList/generateTextContent
 *  Authorization: Bearer <MSAL JWT>
 *  Content-Type: multipart/form-data
 *
 *  FormData:
 *    message: Blob(application/json) → {
 *      userMessage:    "<the prompt text>",
 *      chatModel:      "gemini-2.5-flash-lite",
 *      conversationId: "<uuid from /vertexai/initiateChat>"
 *    }
 *
 *  Response: Server-Sent Events stream  (data: … chunks)
 *
 *  Injection target: innerJSON.userMessage
 *  Format: [Custom Instructions]\n<instruction>\n\n---\n\n<original userMessage>
 */

const CONFIG = {
  // Matches the real AI Pro backend plus local-dev and generic proxy patterns
  URL_PATTERN_REGEX: /(?:proapi\.ai\.ny\.gov|vertexai\/multiModalInputList|aiplatform\.googleapis\.com|:generateContent|:streamGenerateContent|\/api\/chat|\/api\/generate|\/v1\/messages|\/completions)/i,

  REQUEST_FORMAT:         "auto",
  HARD_CHAR_LIMIT:        500_000,
  RESERVE_RESPONSE_CHARS: 8_000,
  OVERFLOW_STRATEGY:      "truncate-instruction",
  PANEL_HOTKEY:           "Shift+Alt+I",
  STORAGE_KEY:            "aipro_ci_v2",
};

// ─────────────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  enabled:              true,
  instruction:          "",
  requestFormat:        CONFIG.REQUEST_FORMAT,
  overflowStrategy:     CONFIG.OVERFLOW_STRATEGY,
  hardCharLimit:        CONFIG.HARD_CHAR_LIMIT,
  reserveResponseChars: CONFIG.RESERVE_RESPONSE_CHARS,
  debug:                false,
  requestCount:         0,
  injectedCount:        0,
  skippedCount:         0,
};

let SETTINGS = loadSettings();

function loadSettings() {
  try {
    const raw = (typeof GM_getValue !== "undefined")
      ? GM_getValue(CONFIG.STORAGE_KEY, null)
      : localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings() {
  const json = JSON.stringify(SETTINGS);
  try {
    if (typeof GM_setValue !== "undefined") GM_setValue(CONFIG.STORAGE_KEY, json);
    localStorage.setItem(CONFIG.STORAGE_KEY, json);
  } catch (e) {
    console.warn("[AI Pro CI] Could not persist settings:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MIDDLEWARE PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

const _middleware = [];

function registerMiddleware(fn) { _middleware.push(fn); }

function processMiddleware(payload, context) {
  let current = payload;
  for (const fn of _middleware) {
    try { current = fn(current, context) ?? current; }
    catch (err) { console.error("[AI Pro CI] Middleware error (continuing):", err); }
  }
  return current;
}

window.__aiproCIRegister = registerMiddleware;

// ─────────────────────────────────────────────────────────────────────────────
//  PAYLOAD FORMAT AUTO-DETECTION
//
//  Priority: aipro first (most specific for this domain), then generic formats.
// ─────────────────────────────────────────────────────────────────────────────

function detectPayloadFormat(payload) {
  // AI Pro native API: { userMessage, chatModel, conversationId }
  if (typeof payload?.userMessage === "string")   return "aipro";

  // Vertex AI generateContent: { contents[], systemInstruction }
  if (Array.isArray(payload?.contents))           return "vertex";
  if (payload?.systemInstruction)                 return "vertex";

  // OpenAI-compatible: { messages[] }
  if (Array.isArray(payload?.messages))           return "openai";

  // Prompt / text fields (generic proxy)
  if (typeof payload?.prompt === "string")        return "prefix";
  if (typeof payload?.text   === "string")        return "prefix";

  return "vertex";  // safe fallback
}

// ─────────────────────────────────────────────────────────────────────────────
//  INTERCEPT GATE
// ─────────────────────────────────────────────────────────────────────────────

function shouldIntercept(url) {
  return !!(url && CONFIG.URL_PATTERN_REGEX.test(url));
}

// ─────────────────────────────────────────────────────────────────────────────
//  REQUEST INTERCEPTION  —  patched at document-start before page scripts run
// ─────────────────────────────────────────────────────────────────────────────

(function patchFetch() {
  const _fetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = (typeof input === "string") ? input : input?.url ?? "";
    if (SETTINGS.enabled && SETTINGS.instruction.trim() && shouldIntercept(url)) {
      SETTINGS.requestCount++;
      init = await tryInjectFetch(init, url);
    }
    return _fetch.call(this, input, init);
  };
})();

(function patchXHR() {
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._xhrUrl = url;
    return _open.call(this, method, url, ...rest);
  };

  // XHR send() stays synchronous. AI Pro's SSE stream uses fetch, not XHR,
  // so this path mainly covers config/history calls which are plain JSON.
  XMLHttpRequest.prototype.send = function (body) {
    if (
      SETTINGS.enabled &&
      SETTINGS.instruction.trim() &&
      shouldIntercept(this._xhrUrl ?? "") &&
      typeof body === "string"
    ) {
      body = tryInjectSyncXHR(body, this._xhrUrl);
      SETTINGS.requestCount++;
    }
    return _send.call(this, body);
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
//  INJECTION DRIVERS
// ─────────────────────────────────────────────────────────────────────────────

async function tryInjectFetch(init, url) {
  try {
    const rawBody = init.body;
    if (!rawBody) return init;

    // ── AI Pro native: FormData with a JSON Blob in the "message" field ──────
    if (rawBody instanceof FormData) {
      return await tryInjectFormData(init, url);
    }

    // ── Standard JSON body (dev/proxy/other formats) ──────────────────────────
    const bodyStr = typeof rawBody === "string" ? rawBody : await blobOrBufferToText(rawBody);
    if (!bodyStr) return init;

    const payload  = JSON.parse(bodyStr);
    const modified = processMiddleware(payload, { type: "fetch", url });

    if (modified.__ci_skipped) {
      if (SETTINGS.overflowStrategy === "block") {
        throw new DOMException("AI Pro CI: request blocked — limit exceeded.", "AbortError");
      }
      return init;
    }

    if (SETTINGS.debug) console.log("[AI Pro CI] fetch JSON payload →", modified);
    return { ...init, body: JSON.stringify(modified) };

  } catch (e) {
    if (e.name === "AbortError") throw e;
    console.warn("[AI Pro CI] Fetch injection failed — sent unmodified.", e);
    return init;
  }
}

async function tryInjectFormData(init, url) {
  /*
   * AI Pro sends:  FormData { message: Blob(application/json) }
   * The Blob contains:  { userMessage, chatModel, conversationId }
   * We extract the Blob, parse it, run middleware, then re-pack.
   * All other FormData fields (file attachments, etc.) are preserved exactly.
   */
  try {
    const formData = init.body;
    const msgBlob  = formData.get("message");

    if (!(msgBlob instanceof Blob)) return init;

    const innerText    = await msgBlob.text();
    const innerPayload = JSON.parse(innerText);

    const modified = processMiddleware(innerPayload, { type: "fetch-formdata", url });

    if (modified.__ci_skipped) {
      if (SETTINGS.overflowStrategy === "block") {
        throw new DOMException("AI Pro CI: request blocked — limit exceeded.", "AbortError");
      }
      return init;
    }

    if (SETTINGS.debug) console.log("[AI Pro CI] FormData inner payload →", modified);

    // Re-build FormData preserving every field; replace "message" with modified Blob
    const newFormData = new FormData();
    for (const [key, val] of formData.entries()) {
      if (key !== "message") newFormData.append(key, val);
    }
    const newBlob = new Blob([JSON.stringify(modified)], { type: msgBlob.type || "application/json" });
    newFormData.append("message", newBlob, "message");

    return { ...init, body: newFormData };

  } catch (e) {
    if (e.name === "AbortError") throw e;
    console.warn("[AI Pro CI] FormData injection failed — sent unmodified.", e);
    return init;
  }
}

function tryInjectSyncXHR(bodyStr, url) {
  try {
    const payload  = JSON.parse(bodyStr);
    const modified = processMiddleware(payload, { type: "xhr", url });
    if (modified.__ci_skipped) return bodyStr;
    if (SETTINGS.debug) console.log("[AI Pro CI] XHR payload →", modified);
    return JSON.stringify(modified);
  } catch (e) {
    console.warn("[AI Pro CI] XHR injection failed — sent unmodified.", e);
    return bodyStr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BUILT-IN CI INJECTION MIDDLEWARE  —  registered as the first middleware
// ─────────────────────────────────────────────────────────────────────────────

function ciInjectionMiddleware(payload /*, context */) {
  if (!SETTINGS.enabled || !SETTINGS.instruction.trim()) return payload;

  const result = injectInstruction(payload, SETTINGS.instruction, SETTINGS);

  if (result.skipped) {
    SETTINGS.skippedCount++;
    saveSettings();
    showBanner(result.reason, "warn");
    return { ...payload, __ci_skipped: true };
  }

  SETTINGS.injectedCount++;
  saveSettings();
  return result.payload;
}

registerMiddleware(ciInjectionMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
//  INJECTION LOGIC
// ─────────────────────────────────────────────────────────────────────────────

function injectInstruction(payload, instruction, settings) {
  const format = (settings.requestFormat === "auto")
    ? detectPayloadFormat(payload)
    : settings.requestFormat;

  const strategy      = settings.overflowStrategy;
  const effectiveLimit = Math.max(1000,
    settings.hardCharLimit - (settings.reserveResponseChars ?? 0)
  );

  // ── AI Pro native format ───────────────────────────────────────────────────
  //  Payload: { userMessage, chatModel, conversationId }
  //  Inject:  prepend instruction to userMessage with a clear separator.
  //  Note:    There is no system-instruction field in this API.
  if (format === "aipro") {
    const userText  = payload.userMessage ?? "";
    const combined  = instruction.length + userText.length;
    let   finalInst = instruction;

    if (combined > effectiveLimit) {
      const r = handleOverflow(instruction, userText, effectiveLimit, strategy, payload, "aipro");
      if (r.skip)    return { skipped: true, reason: r.reason };
      if (r.payload) return { payload: r.payload };
      finalInst = r.instruction;
    }

    const cloned = safeClone(payload);
    cloned.userMessage = `[Custom Instructions]\n${finalInst}\n\n---\n\n${userText}`;
    return { payload: cloned };
  }

  // ── Vertex AI generateContent ──────────────────────────────────────────────
  if (format === "vertex") {
    const userText  = extractVertexUserText(payload);
    const combined  = instruction.length + userText.length;
    let   finalInst = instruction;

    if (combined > effectiveLimit) {
      const r = handleOverflow(instruction, userText, effectiveLimit, strategy, payload, "vertex");
      if (r.skip)    return { skipped: true, reason: r.reason };
      if (r.payload) return { payload: r.payload };
      finalInst = r.instruction;
    }

    const cloned = safeClone(payload);
    cloned.systemInstruction = {
      role:  "system",
      parts: [{ text: mergeWithExisting(finalInst, cloned.systemInstruction) }],
    };
    return { payload: cloned };
  }

  // ── OpenAI-compatible ──────────────────────────────────────────────────────
  if (format === "openai") {
    const msgs      = payload.messages ?? [];
    const userText  = msgs.filter(m => m.role === "user").map(m => m.content ?? "").join(" ");
    const combined  = instruction.length + userText.length;
    let   finalInst = instruction;

    if (combined > effectiveLimit) {
      const r = handleOverflow(instruction, userText, effectiveLimit, strategy, payload, "openai");
      if (r.skip) return { skipped: true, reason: r.reason };
      finalInst = r.instruction ?? instruction;
    }

    const cloned  = safeClone(payload);
    if (!cloned.messages) cloned.messages = [];
    const sysIdx  = cloned.messages.findIndex(m => m.role === "system");
    const sysText = mergeWithExisting(finalInst, sysIdx >= 0 ? cloned.messages[sysIdx].content : null);

    if (sysIdx >= 0) {
      cloned.messages[sysIdx].content = sysText;
    } else {
      cloned.messages.unshift({ role: "system", content: sysText });
    }
    return { payload: cloned };
  }

  // ── Prefix / custom envelope ───────────────────────────────────────────────
  if (format === "prefix") {
    const cloned    = safeClone(payload);
    const userField = findFirstUserTextField(cloned);
    if (!userField) return { payload: cloned };

    const combined = instruction.length + (userField.value ?? "").length;

    if (combined > effectiveLimit) {
      const r = handleOverflow(instruction, userField.value ?? "", effectiveLimit, strategy, payload, "prefix");
      if (r.skip) return { skipped: true, reason: r.reason };
      userField.set((r.instruction ?? instruction) + "\n\n---\n\n" + userField.value);
      return { payload: cloned };
    }

    userField.set("[Custom Instructions]\n" + instruction + "\n\n---\n\n" + userField.value);
    return { payload: cloned };
  }

  return { payload };
}

// ─────────────────────────────────────────────────────────────────────────────
//  OVERFLOW HANDLER
// ─────────────────────────────────────────────────────────────────────────────

function handleOverflow(instruction, userText, effectiveLimit, strategy, payload, format) {
  const excess = (instruction.length + userText.length) - effectiveLimit;
  const pct    = Math.round((excess / effectiveLimit) * 100);
  const msg    = `Custom instruction + user input exceeds limit by ~${excess.toLocaleString()} chars (${pct}% over).`;

  switch (strategy) {

    case "truncate-instruction": {
      const maxInst = Math.max(0, effectiveLimit - userText.length - 100);
      const trimmed = instruction.slice(0, maxInst) +
        (maxInst < instruction.length ? "\n… [instruction truncated to fit context limit]" : "");
      console.warn(`[AI Pro CI] ${msg} Instruction trimmed to ${maxInst} chars.`);
      return { instruction: trimmed };
    }

    case "truncate-input": {
      const maxUser = Math.max(0, effectiveLimit - instruction.length - 100);
      console.warn(`[AI Pro CI] ${msg} User input trimmed.`);
      const cloned = safeClone(payload);

      if (format === "aipro") {
        // Trim the userMessage field directly
        cloned.userMessage = (cloned.userMessage ?? "").slice(0, maxUser) + "… [truncated]";

      } else if (format === "openai" && cloned.messages) {
        const lastUser = [...cloned.messages].reverse().find(m => m.role === "user");
        if (lastUser) lastUser.content = lastUser.content.slice(0, maxUser) + "… [truncated]";

      } else if (format === "vertex" && cloned.contents) {
        const lastUser = [...cloned.contents].reverse().find(c => c.role === "user");
        if (lastUser?.parts?.[0]) {
          lastUser.parts[0].text = lastUser.parts[0].text.slice(0, maxUser) + "… [truncated]";
        }
      }
      return { payload: cloned };
    }

    case "warn-and-skip":
      return { skip: true, reason: msg + " Instruction skipped for this request." };

    case "block":
      return { skip: true, reason: msg + " Request blocked. Shorten your instruction or message." };

    default:
      return { instruction: instruction.slice(0, Math.max(0, effectiveLimit - userText.length)) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function mergeWithExisting(newText, existing) {
  if (!existing) return newText;
  const existingText = typeof existing === "string"
    ? existing
    : existing?.parts?.[0]?.text ?? "";
  if (!existingText.trim()) return newText;
  return newText + "\n\n---\n\n[Original system context]\n" + existingText;
}

function extractVertexUserText(payload) {
  return (payload.contents ?? [])
    .filter(c => c.role === "user")
    .flatMap(c => (c.parts ?? []).map(p => p.text ?? ""))
    .join(" ");
}

function findFirstUserTextField(obj) {
  const candidates = ["message", "prompt", "text", "input", "query", "content"];
  for (const key of candidates) {
    if (typeof obj[key] === "string") {
      return { value: obj[key], set: (v) => { obj[key] = v; } };
    }
  }
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      const sub = findFirstUserTextField(obj[key]);
      if (sub) return sub;
    }
  }
  return null;
}

async function blobOrBufferToText(body) {
  try {
    if (body instanceof Blob)        return await body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body))    return new TextDecoder().decode(body.buffer);
  } catch (_) {}
  return null;
}

function safeClone(obj) {
  return (typeof structuredClone !== "undefined")
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTIFICATION BANNER
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
//  TAMPERMONKEY MENU COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

if (typeof GM_registerMenuCommand !== "undefined") {
  GM_registerMenuCommand("Toggle CI Injector", () => {
    SETTINGS.enabled = !SETTINGS.enabled;
    saveSettings();
    updateFabState();
    showBanner(
      `Custom Instructions injector ${SETTINGS.enabled ? "enabled" : "disabled"}.`,
      SETTINGS.enabled ? "success" : "warn"
    );
  });

  GM_registerMenuCommand("Open Custom Instructions", () => {
    if (document.getElementById("_ci_fab")) {
      togglePanel(true);
    } else {
      window.addEventListener("DOMContentLoaded", () => togglePanel(true), { once: true });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI  —  injected after DOM is ready
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => injectUI(), { once: true });
if (document.readyState !== "loading") setTimeout(injectUI, 500);

function injectUI() {
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
    SETTINGS.enabled = e.target.checked;
    updateFabState();
    saveSettings();
    syncStats();
  });

  const ta = panel.querySelector("#_ci_text");
  ta.addEventListener("input", () => updateCharCounter(ta.value));

  panel.querySelector("#_ci_format").addEventListener("change", e => {
    SETTINGS.requestFormat = e.target.value;
    saveSettings();
  });

  panel.querySelector("#_ci_overflow").addEventListener("change", e => {
    SETTINGS.overflowStrategy = e.target.value;
    saveSettings();
  });

  panel.querySelector("#_ci_limit").addEventListener("change", e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v > 0) {
      SETTINGS.hardCharLimit = v;
      saveSettings();
      updateCharCounter(ta.value);
    }
  });

  panel.querySelector("#_ci_reserve").addEventListener("change", e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 0) {
      SETTINGS.reserveResponseChars = v;
      saveSettings();
      updateCharCounter(ta.value);
    }
  });

  panel.querySelector("#_ci_debug").addEventListener("change", e => {
    SETTINGS.debug = e.target.checked;
    saveSettings();
  });

  panel.querySelector("#_ci_save").addEventListener("click", () => {
    SETTINGS.instruction      = ta.value.trim();
    SETTINGS.requestFormat    = panel.querySelector("#_ci_format").value;
    SETTINGS.overflowStrategy = panel.querySelector("#_ci_overflow").value;
    const lv = parseInt(panel.querySelector("#_ci_limit").value, 10);
    if (!isNaN(lv) && lv > 0)  SETTINGS.hardCharLimit = lv;
    const rv = parseInt(panel.querySelector("#_ci_reserve").value, 10);
    if (!isNaN(rv) && rv >= 0) SETTINGS.reserveResponseChars = rv;
    SETTINGS.debug = panel.querySelector("#_ci_debug").checked;
    saveSettings();
    showSaveConfirmation();
  });

  panel.querySelector("#_ci_clear").addEventListener("click", () => {
    if (!confirm("Clear custom instructions?")) return;
    ta.value = "";
    SETTINGS.instruction = "";
    saveSettings();
    updateCharCounter("");
    updateFabState();
  });

  panel.querySelector("#_ci_reset_stats").addEventListener("click", () => {
    SETTINGS.requestCount = SETTINGS.injectedCount = SETTINGS.skippedCount = 0;
    saveSettings();
    syncStats();
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

// ─────────────────────────────────────────────────────────────────────────────
//  PANEL HTML
// ─────────────────────────────────────────────────────────────────────────────

function buildPanelHTML() {
  return `
    <header class="_ci_header">
      <div class="_ci_title">
        <span class="_ci_badge">CI</span>
        Custom Instructions
      </div>
      <div class="_ci_header_actions">
        <label class="_ci_switch" title="Enable / disable injection">
          <input type="checkbox" id="_ci_enabled">
          <span class="_ci_slider"></span>
        </label>
        <button id="_ci_close" class="_ci_icon_btn" aria-label="Close panel">✕</button>
      </div>
    </header>

    <section class="_ci_section">
      <label class="_ci_label" for="_ci_text">
        System Instructions
        <span class="_ci_hint">Prepended silently to every message sent</span>
      </label>
      <div class="_ci_ta_wrap">
        <textarea id="_ci_text" class="_ci_ta" rows="8"
          placeholder="You are a knowledgeable NYS government AI assistant. Always be concise, accurate, and reference applicable NYS policies where relevant…"
          spellcheck="true"></textarea>
        <div class="_ci_ta_footer">
          <span id="_ci_char_count" class="_ci_char_count">0 chars</span>
          <span id="_ci_char_warn" class="_ci_char_warn hidden"></span>
        </div>
      </div>
    </section>

    <section class="_ci_section _ci_section--config">
      <div class="_ci_field_row">
        <div class="_ci_field">
          <label class="_ci_label" for="_ci_format">Request Format</label>
          <select id="_ci_format" class="_ci_select">
            <option value="auto">Auto-detect</option>
            <option value="aipro">AI Pro Native</option>
            <option value="vertex">Vertex AI</option>
            <option value="openai">OpenAI-compatible</option>
            <option value="prefix">Prefix (custom)</option>
          </select>
        </div>
        <div class="_ci_field">
          <label class="_ci_label" for="_ci_overflow">On limit overflow</label>
          <select id="_ci_overflow" class="_ci_select">
            <option value="truncate-instruction">Trim instruction to fit</option>
            <option value="truncate-input">Trim user input to fit</option>
            <option value="warn-and-skip">Warn &amp; skip injection</option>
            <option value="block">Warn &amp; block request</option>
          </select>
        </div>
      </div>
      <div class="_ci_field_row" style="margin-top:10px;">
        <div class="_ci_field">
          <label class="_ci_label" for="_ci_limit">Context Limit (chars)</label>
          <input id="_ci_limit" class="_ci_input" type="number" min="1000" step="10000">
        </div>
        <div class="_ci_field">
          <label class="_ci_label" for="_ci_reserve">
            Reserve for Response
            <span class="_ci_hint">chars held back</span>
          </label>
          <input id="_ci_reserve" class="_ci_input" type="number" min="0" step="1000">
        </div>
      </div>
      <div class="_ci_debug_row">
        <label class="_ci_debug_label">
          <input type="checkbox" id="_ci_debug">
          <span>Debug mode</span>
          <span class="_ci_hint">Log modified payloads to console</span>
        </label>
      </div>
    </section>

    <section class="_ci_section">
      <div class="_ci_stats">
        <div class="_ci_stat">
          <span class="_ci_stat_val" id="_ci_s_req">0</span>
          <span class="_ci_stat_lbl">Requests</span>
        </div>
        <div class="_ci_stat">
          <span class="_ci_stat_val" id="_ci_s_inj">0</span>
          <span class="_ci_stat_lbl">Injected</span>
        </div>
        <div class="_ci_stat">
          <span class="_ci_stat_val" id="_ci_s_skp">0</span>
          <span class="_ci_stat_lbl">Skipped</span>
        </div>
        <button id="_ci_reset_stats" class="_ci_ghost_btn">Reset</button>
      </div>
    </section>

    <footer class="_ci_footer">
      <button id="_ci_clear" class="_ci_ghost_btn">Clear</button>
      <div class="_ci_footer_right">
        <span id="_ci_save_confirm" class="_ci_save_confirm hidden">✓ Saved</span>
        <button id="_ci_save" class="_ci_primary_btn">Save</button>
      </div>
    </footer>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI STATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function togglePanel(force) {
  const panel = document.getElementById("_ci_panel");
  const fab   = document.getElementById("_ci_fab");
  if (!panel) return;
  const show = (force !== undefined) ? force : panel.hidden;
  panel.hidden = !show;
  fab.classList.toggle("_ci_fab--open", show);
  if (show) { syncStats(); panel.querySelector("#_ci_text")?.focus(); }
}

function syncUIFromSettings() {
  const get = id => document.getElementById(id);
  if (get("_ci_enabled"))  get("_ci_enabled").checked  = SETTINGS.enabled;
  if (get("_ci_text"))     get("_ci_text").value        = SETTINGS.instruction;
  if (get("_ci_format"))   get("_ci_format").value      = SETTINGS.requestFormat;
  if (get("_ci_overflow")) get("_ci_overflow").value    = SETTINGS.overflowStrategy;
  if (get("_ci_limit"))    get("_ci_limit").value       = SETTINGS.hardCharLimit;
  if (get("_ci_reserve"))  get("_ci_reserve").value     = SETTINGS.reserveResponseChars;
  if (get("_ci_debug"))    get("_ci_debug").checked     = SETTINGS.debug;
  updateCharCounter(SETTINGS.instruction);
  updateFabState();
  syncStats();
}

function updateCharCounter(text) {
  const countEl = document.getElementById("_ci_char_count");
  const warnEl  = document.getElementById("_ci_char_warn");
  if (!countEl) return;

  const len            = text.length;
  const effectiveLimit = Math.max(1000,
    SETTINGS.hardCharLimit - (SETTINGS.reserveResponseChars ?? 0)
  );
  const pct = Math.round((len / effectiveLimit) * 100);
  countEl.textContent = `${len.toLocaleString()} chars`;

  if (pct >= 90) {
    countEl.style.color = "var(--ci-danger)";
    warnEl.textContent  = `${pct}% of effective limit — very little room for user input`;
    warnEl.classList.remove("hidden");
  } else if (pct >= 70) {
    countEl.style.color = "var(--ci-warn)";
    warnEl.textContent  = `${pct}% of effective limit`;
    warnEl.classList.remove("hidden");
  } else {
    countEl.style.color = "";
    warnEl.classList.add("hidden");
  }
}

function updateFabState() {
  const fab = document.getElementById("_ci_fab");
  if (!fab) return;
  const active = SETTINGS.enabled && !!SETTINGS.instruction.trim();
  fab.classList.toggle("_ci_fab--active",   active);
  fab.classList.toggle("_ci_fab--inactive", !active);
  fab.title = SETTINGS.enabled
    ? (active
        ? `Custom Instructions: active (${CONFIG.PANEL_HOTKEY})`
        : `Custom Instructions: no instruction set (${CONFIG.PANEL_HOTKEY})`)
    : `Custom Instructions: disabled (${CONFIG.PANEL_HOTKEY})`;
}

function syncStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("_ci_s_req", SETTINGS.requestCount.toLocaleString());
  set("_ci_s_inj", SETTINGS.injectedCount.toLocaleString());
  set("_ci_s_skp", SETTINGS.skippedCount.toLocaleString());
}

let saveConfirmTimer;
function showSaveConfirmation() {
  const el = document.getElementById("_ci_save_confirm");
  if (!el) return;
  el.classList.remove("hidden");
  updateFabState();
  clearTimeout(saveConfirmTimer);
  saveConfirmTimer = setTimeout(() => el.classList.add("hidden"), 2500);
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

// ─────────────────────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────────────────────

function injectStyles() {
  const style = document.createElement("style");
  style.id = "_ci_styles";
  style.textContent = `
    :root {
      --ci-blue:    #154973;
      --ci-gold:    #FACE00;
      --ci-bg:      #f8f9fb;
      --ci-surface: #ffffff;
      --ci-border:  #dde2ea;
      --ci-text:    #1a2436;
      --ci-muted:   #6b7a90;
      --ci-danger:  #c0392b;
      --ci-warn:    #e67e22;
      --ci-success: #27ae60;
      --ci-radius:  10px;
      --ci-shadow:  0 8px 32px rgba(21,73,115,.18), 0 2px 8px rgba(0,0,0,.08);
      --ci-z:       2147483647;
    }

    /* ── FAB ─────────────────────────────────────────────────────────────── */
    #_ci_fab {
      position: fixed; bottom: 24px; right: 24px; z-index: var(--ci-z);
      width: 48px; height: 48px; border-radius: 50%; border: none;
      background: var(--ci-blue); color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(21,73,115,.35);
      transition: transform .15s ease, box-shadow .15s ease, background .15s;
      outline: none;
    }
    #_ci_fab:hover  { transform: scale(1.08); box-shadow: 0 6px 20px rgba(21,73,115,.45); }
    #_ci_fab:active { transform: scale(.96); }
    #_ci_fab svg    { width: 22px; height: 22px; }
    #_ci_fab._ci_fab--open { background: #0d3255; }
    #_ci_fab._ci_fab--active::after {
      content: ''; position: absolute; top: 6px; right: 6px;
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--ci-gold); border: 2px solid #fff;
    }

    /* ── Panel ───────────────────────────────────────────────────────────── */
    #_ci_panel {
      position: fixed; bottom: 82px; right: 24px; z-index: var(--ci-z);
      width: 460px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px);
      overflow-y: auto; background: var(--ci-surface);
      border: 1px solid var(--ci-border); border-radius: var(--ci-radius);
      box-shadow: var(--ci-shadow);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 13px; color: var(--ci-text);
      animation: _ci_slide_in .18s ease;
    }
    @keyframes _ci_slide_in {
      from { opacity: 0; transform: translateY(10px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    #_ci_panel[hidden] { display: none; }

    /* ── Header ──────────────────────────────────────────────────────────── */
    ._ci_header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; background: var(--ci-blue); color: #fff;
      border-radius: var(--ci-radius) var(--ci-radius) 0 0;
    }
    ._ci_title   { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    ._ci_badge   { background: var(--ci-gold); color: var(--ci-blue); font-weight: 800; font-size: 10px; padding: 2px 5px; border-radius: 4px; letter-spacing: .05em; }
    ._ci_header_actions { display: flex; align-items: center; gap: 10px; }

    /* ── Toggle switch ───────────────────────────────────────────────────── */
    ._ci_switch  { position: relative; display: inline-block; width: 38px; height: 22px; cursor: pointer; }
    ._ci_switch input { opacity: 0; width: 0; height: 0; }
    ._ci_slider  { position: absolute; inset: 0; background: rgba(255,255,255,.25); border-radius: 22px; transition: background .2s; }
    ._ci_slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
    ._ci_switch input:checked + ._ci_slider { background: var(--ci-gold); }
    ._ci_switch input:checked + ._ci_slider::before { transform: translateX(16px); }

    /* ── Sections ────────────────────────────────────────────────────────── */
    ._ci_section         { padding: 14px 16px; border-bottom: 1px solid var(--ci-border); }
    ._ci_section--config { display: flex; flex-direction: column; }
    ._ci_field_row       { display: flex; gap: 12px; }
    ._ci_field           { flex: 1; display: flex; flex-direction: column; }

    /* ── Labels ──────────────────────────────────────────────────────────── */
    ._ci_label {
      display: flex; align-items: baseline; gap: 6px;
      font-weight: 600; font-size: 11px; color: var(--ci-text);
      margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em;
    }
    ._ci_hint { font-size: 11px; font-weight: 400; color: var(--ci-muted); text-transform: none; letter-spacing: 0; }

    /* ── Debug row ───────────────────────────────────────────────────────── */
    ._ci_debug_row { margin-top: 10px; }
    ._ci_debug_label {
      display: flex; align-items: center; gap: 7px;
      font-size: 12px; color: var(--ci-muted); cursor: pointer;
    }
    ._ci_debug_label input[type=checkbox] { accent-color: var(--ci-blue); cursor: pointer; }
    ._ci_debug_label span:first-of-type { color: var(--ci-text); font-weight: 600; }

    /* ── Textarea ────────────────────────────────────────────────────────── */
    ._ci_ta_wrap { position: relative; }
    ._ci_ta {
      width: 100%; box-sizing: border-box;
      border: 1.5px solid var(--ci-border); border-radius: 6px;
      padding: 9px 11px; font-family: inherit; font-size: 13px;
      color: var(--ci-text); background: var(--ci-bg);
      resize: vertical; line-height: 1.5; outline: none; transition: border-color .15s;
    }
    ._ci_ta:focus { border-color: var(--ci-blue); background: #fff; }
    ._ci_ta_footer { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
    ._ci_char_count { font-size: 11px; color: var(--ci-muted); }
    ._ci_char_warn  { font-size: 11px; font-weight: 600; }
    ._ci_char_warn.hidden { display: none; }

    /* ── Controls ────────────────────────────────────────────────────────── */
    ._ci_select, ._ci_input {
      width: 100%; box-sizing: border-box;
      border: 1.5px solid var(--ci-border); border-radius: 6px;
      padding: 7px 9px; font-family: inherit; font-size: 12px;
      color: var(--ci-text); background: var(--ci-bg); outline: none;
    }
    ._ci_select:focus, ._ci_input:focus { border-color: var(--ci-blue); background: #fff; }

    /* ── Stats ───────────────────────────────────────────────────────────── */
    ._ci_stats    { display: flex; align-items: center; gap: 16px; }
    ._ci_stat     { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    ._ci_stat_val { font-weight: 700; font-size: 18px; color: var(--ci-blue); line-height: 1; }
    ._ci_stat_lbl { font-size: 10px; color: var(--ci-muted); text-transform: uppercase; letter-spacing: .05em; }

    /* ── Buttons ─────────────────────────────────────────────────────────── */
    ._ci_primary_btn {
      background: var(--ci-blue); color: #fff; border: none; border-radius: 6px;
      padding: 8px 20px; font-family: inherit; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: background .15s;
    }
    ._ci_primary_btn:hover { background: #0d3255; }
    ._ci_ghost_btn {
      background: none; color: var(--ci-muted); border: 1.5px solid var(--ci-border);
      border-radius: 6px; padding: 7px 14px; font-family: inherit;
      font-size: 12px; cursor: pointer; transition: border-color .15s, color .15s;
    }
    ._ci_ghost_btn:hover { border-color: var(--ci-blue); color: var(--ci-blue); }
    ._ci_icon_btn {
      background: rgba(255,255,255,.15); border: none; color: #fff;
      border-radius: 4px; width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 14px; transition: background .15s;
    }
    ._ci_icon_btn:hover { background: rgba(255,255,255,.3); }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    ._ci_footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: var(--ci-bg);
      border-radius: 0 0 var(--ci-radius) var(--ci-radius);
    }
    ._ci_footer_right  { display: flex; align-items: center; gap: 10px; }
    ._ci_save_confirm  { font-size: 12px; color: var(--ci-success); font-weight: 600; }
    ._ci_save_confirm.hidden { display: none; }

    /* ── Banner ──────────────────────────────────────────────────────────── */
    #_ci_banner {
      display: none; position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: var(--ci-z); max-width: 520px; width: calc(100vw - 32px);
      padding: 10px 16px; border-radius: 8px; font-size: 13px; line-height: 1.4;
      box-shadow: 0 4px 16px rgba(0,0,0,.18); pointer-events: none;
    }
    ._ci_banner--warn    { background: #fff8e1; border: 1.5px solid #f39c12; color: #7d5a00; }
    ._ci_banner--error   { background: #fdecea; border: 1.5px solid #e74c3c; color: #7b1e1e; }
    ._ci_banner--success { background: #e8f5e9; border: 1.5px solid #43a047; color: #1b5e20; }

    .hidden { display: none !important; }
  `;
  document.head.appendChild(style);
}
