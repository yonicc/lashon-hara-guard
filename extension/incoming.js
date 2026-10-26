// Shared incoming-message scanning for every platform (loaded after
// selectors.js). Behaviour contract (docs/11):
//   - Only messages that appear AFTER the page loaded are checked: the first
//     scan only records a baseline, so old history is never sent in a burst.
//   - Server cap is 30 requests/minute per access key; the client paces
//     itself to at most one request every 2.1s and drops (marks unchecked)
//     anything beyond a small queue.
//   - A subtle tag is attached next to the message. Never a ruling:
//     "עלולה להתפרש כגנאי" / "ייתכן ש..." / "לא נבדק".
//   - Nothing is blocked, hidden or rewritten.
(() => {
  const G = (globalThis.LHG_INCOMING = globalThis.LHG_INCOMING || {});

  const MIN_CHARS = 6;
  const MAX_QUEUE = 12;
  const PACE_MS = 2100; // 30/min server cap, with margin

  const TAG_TEXT = {
    warn: '⚠️ עלולה להתפרש כגנאי — אינה פסיקה',
    unsure: 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת',
    not_checked: 'לא נבדק',
    unchecked_overflow: 'לא נבדק (עומס בדיקות)',
  };

  function makeQueue(sendFn) {
    const queue = [];
    let busy = false;
    let lastSentAt = 0;
    function pump() {
      if (busy) return;
      const job = queue.shift();
      if (!job) return;
      busy = true;
      const wait = Math.max(0, PACE_MS - (Date.now() - lastSentAt));
      setTimeout(() => {
        lastSentAt = Date.now();
        sendFn(job).then(
          (r) => {
            busy = false;
            job.done(r);
            pump();
          },
          () => {
            busy = false;
            job.done({ alert: 'not_checked' });
            pump();
          },
        );
      }, wait);
    }
    return {
      push(job) {
        if (queue.length >= MAX_QUEUE) {
          job.done({ alert: 'not_checked', dropped: true });
          return false;
        }
        queue.push(job);
        pump();
        return true;
      },
      size: () => queue.length + (busy ? 1 : 0),
    };
  }

  function tag(el, kind) {
    if (!el || typeof el.appendChild !== 'function') return;
    const old = el.querySelector(':scope > .lhg-tag');
    if (old) old.remove();
    if (kind === 'none' || kind === 'hidden') return;
    const t = document.createElement('div');
    t.className = 'lhg-tag lhg-tag-' + kind;
    t.setAttribute('dir', 'rtl');
    t.textContent = TAG_TEXT[kind] || TAG_TEXT.not_checked;
    t.title = 'Lashon Hara Guard: תזכורת בלבד, אינה פסיקה הלכתית.';
    el.appendChild(t);
  }

  function renderResult(el, r) {
    if (!r) return tag(el, 'not_checked');
    if (r.alert === 'warn') return tag(el, 'warn');
    if (r.alert === 'unsure') return tag(el, 'unsure');
    if (r.alert === 'not_checked' || r.alert === 'not_configured') return tag(el, 'not_checked');
    return tag(el, 'none'); // alert === 'none': stay silent, remove pending tag
  }

  // Local-only context (checkpoint 3b): computed per bubble via
  // LHG_LOCAL_CONTEXT.attach when present. Real names stay in the page and
  // are NEVER added to the payload sent to the proxy; the builder exports refs.
  // Missing API or failure => null, never throws.
  function safeLocalContext(el) {
    try {
      const api = globalThis.LHG_LOCAL_CONTEXT;
      if (!api || typeof api.attach !== 'function') return null;
      return api.attach(el);
    } catch (_e) {
      return null;
    }
  }

  // platform: 'whatsapp-web' | 'google-chat' | 'gmail'
  // findRows(root) -> [{ el, text }] candidate message rows currently in DOM.
  // firstRunBaselinesOnly: on the first call only record ids (history), then
  // check only rows whose id was never seen before.
  function createScanner({ platform, findRows, root = document }) {
    const S = globalThis.LHG_SELECTORS;
    const seen = new Set();
    // Local-only bubble context (checkpoint 3b): WeakMap el -> attach() result.
    // The queue receives a separate, redacted packet, never this local object.
    const localByEl = new WeakMap();
    let baselined = false;
    const queue = makeQueue(
      (job) =>
        Promise.resolve(job.message).then((message) => new Promise((resolve) => {
          chrome.runtime.sendMessage(
            message,
            (r) => resolve(chrome.runtime.lastError ? { alert: 'not_checked' } : r || { alert: 'not_checked' }),
          );
        })),
    );

    function scan() {
      let rows;
      try {
        rows = findRows(root) || [];
      } catch (_e) {
        return;
      }
      const fresh = [];
      for (const row of rows) {
        const text = (row.text || '').trim();
        if (text.length < MIN_CHARS) continue;
        const id = S.weakId(platform, row.el, text);
        if (seen.has(id)) continue;
        seen.add(id);
        // Names remain local. Capture the redacted packet before queue delays.
        const localContext = safeLocalContext(row.el);
        if (row.el && localContext) {
          try { localByEl.set(row.el, localContext); } catch (_e) { /* WeakMap only */ }
        }
        const payload = { type: 'lhg-check', text: text.slice(0, 2000), platform, direction: 'incoming' };
        const message = globalThis.LHG_CONTEXT_RUNTIME
          ? globalThis.LHG_CONTEXT_RUNTIME.prepare(payload, row.el, true)
          : payload;
        fresh.push({ ...row, id, text, localContext, message });
      }
      if (!baselined) {
        baselined = true;
        return; // history at load time: marked seen, never sent
      }
      for (const row of fresh) {
        tag(row.el, 'checking');
        const accepted = queue.push({
          text: row.text.slice(0, 2000),
          message: row.message,
          done: (r) => renderResult(row.el, r && r.dropped ? { alert: 'not_checked' } : r),
        });
        if (!accepted) tag(row.el, 'not_checked');
      }
    }

    return { scan, queueSize: queue.size, seenCount: () => seen.size, localContextFor: (el) => {
      try { return (el && localByEl.get(el)) || null; } catch (_e) { return null; }
    } };
  }

  G.createScanner = createScanner;
  G.TAG_TEXT = TAG_TEXT;
})();
