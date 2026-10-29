// Shared outgoing send gate (one home for every platform adapter).
// An adapter supplies only what is platform-specific: which element is a
// compose box and how to find the current one. The send gate, warm-up,
// stale-response guard and "cleared after send" handling live here.
// Typing alone never opens the panel: a check starts from an explicit send
// action (send button / keyboard shortcut). Native send is held until a
// current check completes or the user explicitly bypasses it (a second send
// or Send anyway). Progress is indeterminate, never a fake percent.
(() => {
  const MIN_CHARS = 6;
  const WARM_EVERY_MS = 4 * 60 * 1000; // the gate container sleeps after 5 idle minutes
  // A bubble whose text equals what the user typed in a compose box within
  // this window is the user's own message echoed by the page, never an
  // incoming one (bug 2026-10-27: a just-sent Google Chat message was held as
  // incoming). One registry per frame, shared by every watcher in it.
  const SENT_WINDOW_MS = 20 * 1000;
  // Max time a send waits for the check before the user is told to resend to
  // skip it (owner 2026-10-29). A second Enter bypasses at ANY time; the cap
  // only makes that explicit once the wait is long. One definition, exported.
  const SEND_CAP_MS = 30 * 1000;
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
  //         sendAction?(event) -> { box, button?, ready?, send() }, textOf? }
  function createComposeWatcher(opts) {
    const P = globalThis.LHG_PANEL;
    let lastTyped = '';
    let lastWarm = 0;
    const pending = new WeakMap();
    let replaying = false;

    function intercept(e) {
      if (replaying) return;
      const action = opts.sendAction ? opts.sendAction(e) : (() => {
        const box = opts.composeBox(e.target);
        if (!box || e.type !== 'keydown' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return null;
        return { box, send: () => box.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey,
        })) };
      })();
      if (!action || !action.box) return;
      if (!textOf(action.box)) return; // attachments-only send has no message text to check
      const existing = pending.get(action.box);
      if (existing && existing.isCurrent()) {
        // A second deliberate send is an explicit bypass, even while the
        // request is pending. Let the original native event through once.
        noteTyped(textOf(action.box));
        existing.cancel();
        hide();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const box = action.box;
      pending.get(box)?.cancel();
      const text = textOf(box);
      if (!text) return;
      noteTyped(text);
      const token = {};
      token.text = text;
      pending.set(box, token);
      const button = action.button;
      const t = (key) => globalThis.LHG_I18N?.t(key) || key;
      if (button) { button.setAttribute('aria-busy', 'true'); }
      token.cancel = () => {
        pending.delete(box);
        if (typeof token.cancelCap === 'function') token.cancelCap();
        if (button) button.removeAttribute('aria-busy');
      };
      const contextKey = () => globalThis.LHG_CONTEXT_RUNTIME?.contentKey?.(opts.platform, box, text);
      let capturedContext = contextKey();
      const current = () => pending.get(box) === token && textOf(box) === text && contextKey() === capturedContext;
      token.isCurrent = current;
      const done = (r) => {
        if (pending.get(box) !== token) return;
        if (typeof token.cancelCap === 'function') token.cancelCap();
        if (button) button.removeAttribute('aria-busy');
        token.result = r;
        if (!current()) { token.cancel(); return; }
        // Failure is unresolved; keep the explicit bypass available without
        // interpreting it as a clean result or automatically sending.
        if (!r || r.error || r.rules?.notChecked || !['none', 'warn', 'unsure'].includes(r.alert)) return;
        if (r.alert !== 'none') return; // explicit panel approval or a clarifying answer is required
        pending.delete(box);
        noteTyped(text);
        replaying = true;
        try { action.send(); } finally { replaying = false; }
      };
      const payload = { type: 'lhg-check', text, platform: opts.platform, direction: 'outgoing' };
      token.approve = () => {
        if (current() && ['warn', 'unsure'].includes(token.result?.alert)) done({ alert: 'none' });
      };
      token.bypass = () => {
        if (!current()) return;
        noteTyped(text);
        token.cancel();
        hide();
        replaying = true;
        try { action.send(); } finally { replaying = false; }
      };
      show('checking', t('send.checking'), [t('send.waiting')], [{ label: t('send.anyway'), onClick: token.bypass }]);
      // Owner request 2026-10-29: the wait is BOUNDED. After CAP_MS the panel
      // explains the cap and that pressing Enter again (or Send anyway) sends
      // immediately without the result. The background request still finishes
      // (it may be billed); only the gate opens.
      let capTimer = null;
      // Guarded: a bare test context may lack timers; the bypass path never
      // depends on the cap.
      if (typeof setTimeout === 'function' && typeof clearTimeout === 'function') {
        token.cancelCap = () => { if (capTimer) { clearTimeout(capTimer); capTimer = null; } };
        capTimer = setTimeout(() => {
          capTimer = null;
          if (!current()) return;
          show('checking', t('send.checking'), [t('send.cap')], [{ label: t('send.anyway'), onClick: token.bypass }]);
        }, SEND_CAP_MS);
      } else {
        token.cancelCap = () => {};
      }
      const begin = () => {
        if (pending.get(box) !== token || textOf(box) !== text) return;
        capturedContext = contextKey();
        if (P && typeof P.check === 'function') {
          P.check(payload, box, { isCurrent: current, onResult: done, onApprove: token.approve, onBypass: token.bypass });
        } else {
          const send = globalThis.LHG_CONTEXT_RUNTIME?.send || ((msg, cb) => chrome.runtime.sendMessage(msg, cb));
          send(payload, (r) => { render(r); done(chrome.runtime.lastError ? null : r); }, box);
        }
      };
      if (action.ready) Promise.resolve().then(action.ready).then(begin, () => done({ alert: 'not_checked' }));
      else begin();
    }
    document.addEventListener('click', intercept, true);
    document.addEventListener('keydown', intercept, true);

    const hide = () => P && P.hide();
    const show = (kind, title, lines, actions) => P && P.show(kind, title, lines, actions);
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

    // Typing alone tracks state (memory, sent-echo registry) but never
    // schedules a check or opens the panel.
    function trackTyping(box) {
      const text = textOf(box);
      const job = pending.get(box);
      if (job && job.text !== text) job.cancel();
      globalThis.LHG_MEMORY?.input(opts.platform, box, text);
      if (text.length < MIN_CHARS) {
        if (!text && lastTyped) noteTyped(lastTyped);
        lastTyped = '';
        hide();
        return;
      }
      lastTyped = text;
      noteTyped(text);
    }

    document.addEventListener(
      'input',
      (e) => {
        const box = opts.composeBox(e.target);
        if (box) {
          warm();
          trackTyping(box);
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
          hide();
        }
      },
      true,
    );

    return { readText: () => textOf(opts.findCompose()) };
  }

  globalThis.LHG_COMPOSE = { createComposeWatcher, MIN_CHARS, noteTyped, recentlySent, SENT_WINDOW_MS, SEND_CAP_MS };
})();
