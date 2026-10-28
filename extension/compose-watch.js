// Shared outgoing check while typing (one home for every platform adapter).
// An adapter supplies only what is platform-specific: which element is a
// compose box and how to find the current one. The pause/debounce, warm-up,
// stale-response guard and "cleared after send" handling live here.
// Sending is never blocked and the text is never rewritten.
(() => {
  const PAUSE_MS = 1200;
  const MIN_CHARS = 6;
  const WARM_EVERY_MS = 4 * 60 * 1000; // the gate container sleeps after 5 idle minutes
  // A bubble whose text equals what the user typed in a compose box within
  // this window is the user's own message echoed by the page, never an
  // incoming one (bug 2026-10-27: a just-sent Google Chat message was held as
  // incoming). One registry per frame, shared by every watcher in it.
  const SENT_WINDOW_MS = 20 * 1000;
  const RECENT_MAX = 8;
  const recent = []; // { text (normalised), at }

  const norm = (t) => String(t || '').replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ').trim();

  // Remember a compose snapshot (the last text before the box was cleared,
  // and every paused snapshot): a send is not observable on every platform
  // (a click on "send" clears the box without an input event).
  function noteTyped(text, now = Date.now()) {
    const t = norm(text);
    if (t.length < MIN_CHARS) return;
    const i = recent.findIndex((r) => r.text === t);
    if (i >= 0) recent.splice(i, 1);
    recent.push({ text: t, at: now });
    while (recent.length > RECENT_MAX) recent.shift();
  }

  // True when `text` (a rendered bubble) is what the user typed in the last
  // SENT_WINDOW_MS. A bubble may carry a short extra (time stamp, "edited"),
  // so containment with a small length difference also counts.
  function recentlySent(text, now = Date.now()) {
    const t = norm(text);
    if (t.length < MIN_CHARS) return false;
    for (const r of recent) {
      if (now - r.at > SENT_WINDOW_MS) continue;
      if (r.text === t) return true;
      const [a, b] = r.text.length <= t.length ? [r.text, t] : [t, r.text];
      if (b.length - a.length <= 12 && b.includes(a)) return true;
    }
    return false;
  }

  // opts: { platform, composeBox(el) -> box|null, findCompose() -> box|null,
  //         pauseMs?, textOf?(box) -> string (e.g. a draft without quotes) }
  function createComposeWatcher(opts) {
    const P = globalThis.LHG_PANEL;
    const pauseMs = opts.pauseMs || PAUSE_MS;
    let timer = null;
    let lastChecked = '';
    let lastTyped = '';
    let seq = 0;
    let lastWarm = 0;

    const hide = () => P && P.hide();
    const show = (kind, title, lines) => P && P.show(kind, title, lines);
    const render = (r) => P && P.renderResult(r);
    const rawText = (box) => (box && (box.innerText || box.textContent) || '').trim();
    const textOf = (box) => {
      if (!box) return '';
      if (typeof opts.textOf === 'function') {
        try { return String(opts.textOf(box) || '').trim(); } catch (_e) { /* fall back */ }
      }
      return rawText(box);
    };

    function warm() {
      const now = Date.now();
      if (now - lastWarm < WARM_EVERY_MS) return;
      lastWarm = now;
      try { chrome.runtime.sendMessage({ type: 'lhg-warm' }); } catch (_e) { /* extension reloaded */ }
    }

    function run(text) {
      if (text === lastChecked) return;
      lastChecked = text;
      const my = ++seq;
      show('checking', '…בודק ניסוח', []);
      const payload = { type: 'lhg-check', text, platform: opts.platform, direction: 'outgoing' };
      // Panel-owned flow: stored answers go out as confirmedFacts, and the
      // draft rules' clarifying question re-checks this same text.
      if (P && typeof P.check === 'function') {
        P.check(payload, opts.findCompose(), { isCurrent: () => my === seq });
        return;
      }
      const send = globalThis.LHG_CONTEXT_RUNTIME?.send || ((msg, cb) => chrome.runtime.sendMessage(msg, cb));
      send(
        payload,
        (r) => {
          if (my !== seq) return; // the user kept typing: a newer check owns the panel
          if (chrome.runtime.lastError) {
            render({ alert: 'not_checked' });
            return;
          }
          render(r);
        },
        opts.findCompose(),
      );
    }

    function schedule(box) {
      clearTimeout(timer);
      const text = textOf(box);
      globalThis.LHG_MEMORY?.input(opts.platform, box, text);
      if (text.length < MIN_CHARS) {
        // Emptied after a send: the last typed text is what was sent.
        if (!text && lastTyped) noteTyped(lastTyped);
        lastTyped = '';
        lastChecked = '';
        hide();
        return;
      }
      lastTyped = text;
      // Remember it now too: a send by click may never fire another input.
      noteTyped(text);
      timer = setTimeout(() => run(text), pauseMs);
    }

    document.addEventListener(
      'input',
      (e) => {
        const box = opts.composeBox(e.target);
        if (box) {
          warm();
          schedule(box);
        }
      },
      true,
    );

    // After sending (Enter clears the box) drop any stale panel.
    document.addEventListener(
      'keyup',
      (e) => {
        const box = opts.composeBox(e.target);
        if (box && !textOf(box)) {
          if (lastTyped) noteTyped(lastTyped);
          lastTyped = '';
          seq++;
          lastChecked = '';
          clearTimeout(timer);
          hide();
        }
      },
      true,
    );

    return { readText: () => textOf(opts.findCompose()) };
  }

  globalThis.LHG_COMPOSE = { createComposeWatcher, MIN_CHARS, noteTyped, recentlySent, SENT_WINDOW_MS };
})();
