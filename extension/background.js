// The only place that talks to the network. The content script never sees the
// access key; the Brain token never reaches the browser at all (it lives in the
// proxy as a Cloudflare secret).
const DEFAULT_PROXY = 'https://lhg-proxy.yonicc.workers.dev';
const TIMEOUT_MS = 25000;

async function settings() {
  const I = globalThis.LHG_I18N;
  const M = globalThis.LHG_CHECK_MODE;
  const s = await chrome.storage.local.get(['proxyUrl', 'accessKey', I ? I.STORE_KEY : 'lhgLang', ...(M ? M.KEYS : [])]);
  // The explanation language follows the UI language (i18n.js is its one home).
  const lang = I ? I.normalize(s[I.STORE_KEY]) || I.DEFAULT_LANG : 'en';
  // Check mode and cloud model (check-mode.js is their one home). Part of the
  // config, so they are part of the result-cache key as well.
  const mode = M ? M.normalize(s) : null;
  return { proxyUrl: (s.proxyUrl || DEFAULT_PROXY).replace(/\/+$/, ''), accessKey: s.accessKey || '', lang, ...(mode ? { mode } : {}) };
}

// Draft-rules answers (docs/18 wire contract): { factId: true|false|null },
// at most 20 — one definition, LHG_RULES.sanitize in rules.js (shared with
// the content scripts). The proxy validates again against its catalog.
try { if (typeof importScripts === 'function') importScripts('rules.js'); } catch (_e) { /* tests */ }
try { if (typeof importScripts === 'function') importScripts('i18n.js'); } catch (_e) { /* tests */ }
try { if (typeof importScripts === 'function') importScripts('check-mode.js'); } catch (_e) { /* tests */ }
try { if (typeof importScripts === 'function') importScripts('ollama-client.js', 'ollama-engine.bundle.js', 'ollama-register.js'); } catch (_e) { /* local failure remains not_checked */ }
try { if (typeof importScripts === 'function') importScripts('memory-background.js'); } catch (_e) { /* tests */ }
function confirmedFactsOf(raw) {
  const R = globalThis.LHG_RULES;
  if (!R || !raw) return null;
  const out = R.sanitize(raw);
  return Object.keys(out).length ? out : null;
}

// Free-text note (POST /check `userNote`): one line, capped (LHG_RULES.userNote).
function userNoteOf(raw) {
  const R = globalThis.LHG_RULES;
  return R && typeof R.userNote === 'function' ? R.userNote(raw) : null;
}

// `model`: optional cloud model id (check-mode.js CLOUD_MODELS); null/absent
// keeps the request identical to older extensions (proxy default model).
async function check(text, platform, direction, context, confirmedFacts, userNote, config, model) {
  const { proxyUrl, accessKey, lang } = config || await settings();
  if (!accessKey) return { alert: 'not_configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(proxyUrl + '/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lhg-key': accessKey },
      body: JSON.stringify({
        text, platform, direction: direction === 'incoming' ? 'incoming' : 'outgoing',
        ...(context ? { context } : {}),
        ...(confirmedFacts ? { confirmedFacts } : {}),
        ...(userNote ? { userNote } : {}),
        ...(model ? { model } : {}),
        lang,
      }),
      signal: ctrl.signal,
    });
    if (res.status === 401) return { alert: 'not_configured', error: 'unauthorized' };
    if (res.status === 429) return { alert: 'not_checked', error: 'rate_limited' };
    if (!res.ok) return { alert: 'not_checked', error: 'http_' + res.status };
    return await res.json();
  } catch (e) {
    return { alert: 'not_checked', error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// Native Chrome command "open-panel" (manifest "commands"). Chrome delivers
// it before any page handler runs, so it cannot collide with the built-in
// Ctrl+Shift+= / Ctrl+plus zoom shortcut. Forward to the ACTIVE tab's content
// script, which owns the panel and the current selection. Tabs without our
// content script (unsupported pages) simply ignore it — no error, no panel.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== 'open-panel') return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'lhg-open-panel' }, () => {
          // No receiver on unsupported tabs: not an error.
          void chrome.runtime.lastError;
        });
      } catch (_e) { /* tab gone mid-flight: ignore */ }
    });
  });
}

// Result cache belongs to extension storage, like the existing local memory;
// it never stores message text or access keys. Hash the complete check inputs.
const checksInFlight = new Map();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
}
async function cachedCheck(msg) {
  const config = await settings();
  const facts = confirmedFactsOf(msg.confirmedFacts), note = userNoteOf(msg.userNote);
  const identity = msg.cacheIdentity;
  // Unknown mailbox identity is deliberately not a reusable cache scope.
  const reusable = !!(identity?.accountId && identity?.conversationId);
  const material = JSON.stringify(canonical({ config, identity, text: msg.text,
    platform: msg.platform, direction: msg.direction, context: msg.cacheContext || msg.context,
    facts, note, version: 'send-cache-v1' }));
  const digest = reusable ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)) : null;
  const key = digest ? 'lhg-check-v1-' + Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('') : material;
  if (checksInFlight.has(key)) return checksInFlight.get(key);
  const work = (async () => {
    if (reusable && !msg.forceRecheck) {
      let saved;
      try { saved = (await chrome.storage.local.get(key))[key]; } catch (_) { /* storage failure is a cache miss */ }
      if (saved?.expires > Date.now()) return saved.result;
    }
    const cloud = (model) => check(msg.text, msg.platform || 'unknown', msg.direction, msg.context, facts, note, config, model);
    const M = globalThis.LHG_CHECK_MODE;
    const result = M && config.mode
      ? await M.route({ text: msg.text, platform: msg.platform || 'unknown',
        direction: msg.direction === 'incoming' ? 'incoming' : 'outgoing', context: msg.context,
        confirmedFacts: facts, userNote: note, lang: config.lang }, config.mode, cloud)
      : await cloud(null);
    // A cloud-fallback answer is not cached under the local mode's key: once
    // the local engine is installed, the same message must reach it.
    if (reusable && ['none', 'warn', 'unsure'].includes(result?.alert) && !result.error && !result.rules?.notChecked &&
        result.checkedBy !== 'cloud-fallback') {
      try {
        await chrome.storage.local.set({ [key]: { expires: Date.now() + 14 * 86400000, result } });
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith('lhg-check-v1-'))
          .sort((a, b) => all[b].expires - all[a].expires);
        const expired = keys.filter((k, i) => i >= 500 || all[k].expires <= Date.now());
        if (expired.length) await chrome.storage.local.remove(expired);
      } catch (_) { /* cache maintenance never replaces the check result */ }
    }
    return result;
  })();
  checksInFlight.set(key, work);
  try { return await work; } finally { checksInFlight.delete(key); }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'lhg-check' && typeof msg.text === 'string') {
    cachedCheck(msg).then(sendResponse, () => sendResponse({ alert: 'not_checked' }));
    return true; // async response
  }
  if (msg && msg.type === 'lhg-check-mode-status') {
    // Which local modes can run here (options page). Engines live in this worker.
    const M = globalThis.LHG_CHECK_MODE;
    (M ? M.status() : Promise.resolve({})).then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (msg && msg.type === 'lhg-warm') {
    // Fire-and-forget: wake the proxy's fast classifier while the user types.
    settings().then(({ proxyUrl, accessKey }) => {
      if (accessKey) {
        fetch(proxyUrl + '/warm', { method: 'POST', headers: { 'x-lhg-key': accessKey } }).catch(() => {});
      }
    });
    return false;
  }
  return false;
});
