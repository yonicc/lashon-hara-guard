// The ONE home of the on/off switches (chrome.storage.local), shared by the
// content scripts, the options page and the action popup:
//   lhgEnabled    master switch (default on)
//   lhgPlatforms  { 'whatsapp-web', 'gmail', 'google-chat': boolean } (default on)
//   hideIncoming  hold incoming chat messages until checked (default on;
//                 incoming.js still reads this key itself — see its header)
// Content scripts ask isActive(platform) before every watcher action, and
// changes apply live through chrome.storage.onChanged (no page reload).
// A platform key not listed here (e.g. 'options-test') follows the master
// switch only.
(() => {
  if (globalThis.LHG_SETTINGS) return;
  const PLATFORMS = ['whatsapp-web', 'gmail', 'google-chat'];
  const KEYS = ['lhgEnabled', 'lhgPlatforms', 'hideIncoming'];
  const listeners = [];

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const rp = s.lhgPlatforms && typeof s.lhgPlatforms === 'object' ? s.lhgPlatforms : {};
    const lhgPlatforms = {};
    for (const p of PLATFORMS) lhgPlatforms[p] = rp[p] !== false;
    return { lhgEnabled: s.lhgEnabled !== false, lhgPlatforms, hideIncoming: s.hideIncoming !== false };
  }
  let state = normalize({});

  function storage() {
    try { return chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (_e) { return null; }
  }
  function fire() {
    for (const fn of listeners.slice()) {
      try { fn(get()); } catch (_e) { /* one listener never breaks the others */ }
    }
  }
  const get = () => ({ ...state, lhgPlatforms: { ...state.lhgPlatforms } });

  function isActive(platform) {
    if (!state.lhgEnabled) return false;
    return PLATFORMS.includes(platform) ? state.lhgPlatforms[platform] !== false : true;
  }

  function set(patch) {
    const next = normalize({ ...state, ...patch });
    state = next;
    const st = storage();
    const out = {};
    for (const k of KEYS) if (patch && k in patch) out[k] = next[k];
    return new Promise((resolve) => {
      try { if (st && Object.keys(out).length) st.set(out, () => resolve(get())); else resolve(get()); } catch (_e) { resolve(get()); }
      fire();
    });
  }
  const setPlatform = (p, on) => set({ lhgPlatforms: { ...state.lhgPlatforms, [p]: !!on } });
  // "Turn on" from an off-site panel: the master switch and this platform.
  const enable = (p) => set({ lhgEnabled: true, ...(PLATFORMS.includes(p) ? { lhgPlatforms: { ...state.lhgPlatforms, [p]: true } } : {}) });
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  try {
    const st = storage();
    if (st) {
      st.get(KEYS, (s) => { state = normalize(s || {}); fire(); readyResolve(get()); });
    } else {
      readyResolve(get());
    }
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area && area !== 'local') return;
      if (!ch || !KEYS.some((k) => k in ch)) return;
      const merged = { ...state };
      for (const k of KEYS) if (k in ch) merged[k] = ch[k].newValue; // removed -> default
      state = normalize(merged);
      fire();
    });
  } catch (_e) {
    readyResolve(get()); // tests / no storage: defaults (everything on)
  }

  globalThis.LHG_SETTINGS = {
    PLATFORMS, KEYS, normalize, get, isActive, set, setPlatform, enable, onChange, ready: () => ready,
  };
})();
