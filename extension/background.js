// The only place that talks to the network. The content script never sees the
// access key; the Brain token never reaches the browser at all (it lives in the
// proxy as a Cloudflare secret).
const DEFAULT_PROXY = 'https://lhg-proxy.yonicc.workers.dev';
const TIMEOUT_MS = 25000;

async function settings() {
  const s = await chrome.storage.local.get(['proxyUrl', 'accessKey']);
  return { proxyUrl: (s.proxyUrl || DEFAULT_PROXY).replace(/\/+$/, ''), accessKey: s.accessKey || '' };
}

// Draft-rules answers (docs/18 wire contract): { factId: true|false|null },
// at most 20 — one definition, LHG_RULES.sanitize in rules.js (shared with
// the content scripts). The proxy validates again against its catalog.
try { if (typeof importScripts === 'function') importScripts('rules.js'); } catch (_e) { /* tests */ }
function confirmedFactsOf(raw) {
  const R = globalThis.LHG_RULES;
  if (!R || !raw) return null;
  const out = R.sanitize(raw);
  return Object.keys(out).length ? out : null;
}

async function check(text, platform, direction, context, confirmedFacts) {
  const { proxyUrl, accessKey } = await settings();
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'lhg-check' && typeof msg.text === 'string') {
    check(msg.text, msg.platform || 'unknown', msg.direction, msg.context, confirmedFactsOf(msg.confirmedFacts)).then(sendResponse);
    return true; // async response
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
