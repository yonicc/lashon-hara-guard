// Optional host permissions (Firefox build). Chrome grants host_permissions
// at install; Firefox lists them under optional_host_permissions and the
// options page requests them on an explicit click (a user gesture).
// No UI strings here: all texts live in i18n.js (perm.*).
(() => {
  const ORIGINS = [
    'https://lhg-proxy.yonicc.workers.dev/*',
    'https://huggingface.co/*',
    'https://*.hf.co/*',
    'http://127.0.0.1:11434/*',
  ];
  const api = () => globalThis.chrome?.permissions || globalThis.browser?.permissions || null;
  // Positive detection: Chrome and the Node test contexts never define it.
  const isFirefox = () => typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';
  // Promise form first (Chrome MV3 and Firefox 128+); callback form as fallback.
  async function call(method, arg) {
    const p = api();
    if (!p || typeof p[method] !== 'function') return null;
    try {
      const r = p[method](arg);
      if (r && typeof r.then === 'function') return await r;
    } catch (_e) { /* callback-only implementation: fall through */ }
    return new Promise((resolve) => {
      try { p[method](arg, (v) => resolve(v)); } catch (_e) { resolve(null); }
    });
  }
  globalThis.LHG_PERMISSIONS = {
    ORIGINS,
    isFirefox,
    async status() {
      const missing = [];
      for (const o of ORIGINS) {
        if (!(await call('contains', { origins: [o] }))) missing.push(o);
      }
      return { missing };
    },
    async ensureAll() {
      // Invoke request synchronously in the click's user-gesture stack.
      // An awaited contains() first loses Firefox's user activation.
      const granted = await call('request', { origins: ORIGINS });
      if (!granted) return { ok: true, granted: false };
      const rest = await this.status();
      return { ok: true, granted: rest.missing.length === 0 };
    },
  };
})();
