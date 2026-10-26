// The only place that talks to the network. The content script never sees the
// access key; the Brain token never reaches the browser at all (it lives in the
// proxy as a Cloudflare secret).
const DEFAULT_PROXY = 'https://lhg-proxy.yonicc.workers.dev';
const TIMEOUT_MS = 25000;

async function settings() {
  const s = await chrome.storage.local.get(['proxyUrl', 'accessKey']);
  return { proxyUrl: (s.proxyUrl || DEFAULT_PROXY).replace(/\/+$/, ''), accessKey: s.accessKey || '' };
}

async function check(text, platform) {
  const { proxyUrl, accessKey } = await settings();
  if (!accessKey) return { alert: 'not_configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(proxyUrl + '/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lhg-key': accessKey },
      body: JSON.stringify({ text, platform, direction: 'outgoing' }),
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'lhg-check' && typeof msg.text === 'string') {
    check(msg.text, msg.platform || 'unknown').then(sendResponse);
    return true; // async response
  }
  return false;
});
