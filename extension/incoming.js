// Shared incoming-message scanning for every platform (loaded after
// selectors.js). Behaviour contract (docs/11, docs/15):
//   - Only messages that appear AFTER the page loaded are checked: the first
//     scan only records a baseline, so old history is never sent in a burst.
//     Later bursts (> BURST_LIMIT new rows in one scan: opening another chat,
//     scrolling up into history) are treated the same way: history, not live.
//   - Server cap is 30 requests/minute per access key; the client paces
//     itself to at most one request every 2.1s and drops (marks unchecked)
//     anything beyond a small queue.
//   - HOLD (setting "hideIncoming", default on; chat rows only, never e-mail):
//     a live incoming message is covered by a neutral placeholder BEFORE the
//     next paint, and is revealed automatically only when the check comes back
//     without an alert. A warning / possible meaning / "not checked" stays
//     covered until the user explicitly presses "show" (manual approval).
//     A failed check is never an implicit approval (IN-02).
//   - Without hold: a subtle tag next to the message, as before.
//   - Never a ruling: "עלולה להתפרש כגנאי" / "ייתכן ש..." / "לא נבדק".
//   - Nothing is deleted or rewritten; revealing is always one click away.
(() => {
  const G = (globalThis.LHG_INCOMING = globalThis.LHG_INCOMING || {});

  const MIN_CHARS = 6;
  const MAX_QUEUE = 12;
  const PACE_MS = 2100; // 30/min server cap, with margin
  const BURST_LIMIT = 3; // more new rows than this in one scan = history

  const TAG_TEXT = {
    // Was missing: "checking" fell back to "לא נבדק" while a check was still
    // running (the "לא נבדק" chip seen in Google Chat 2026-10-27).
    checking: '…נבדקת',
    warn: '⚠️ עלולה להתפרש כגנאי — אינה פסיקה',
    unsure: 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת',
    not_checked: 'לא נבדק',
    unchecked_overflow: 'לא נבדק (עומס בדיקות)',
  };

  const MECHANISM_HE = {
    irony: 'אירוניה', praise: 'שבח שעלול להישמע כלעג', hint: 'רמז שמזהה אדם',
    mockery: 'לעג', omission: 'השמטה שמרמזת', direct: 'ביקורת ישירה', other: 'משמעות שלילית אפשרית',
  };

  // Placeholder text per phase (shown INSTEAD of the message while held).
  const HOLD_TEXT = {
    pending: '⏳ הודעה נכנסת נבדקת לפני הצגה…',
    warn: '⚠️ ההודעה הוסתרה: היא עלולה להתפרש כגנאי',
    unsure: 'ℹ️ ההודעה הוסתרה: ייתכן שיש בה משמעות לא מכוונת',
    not_checked: 'ההודעה לא נבדקה (אין חיבור או עומס בדיקות), ולכן היא מוסתרת',
  };
  const REVEAL_LABEL = { warn: 'הצג בכל זאת', unsure: 'הצג בכל זאת', not_checked: 'הצג בלי בדיקה' };

  // Setting: hide incoming chat messages until checked. Default ON.
  G.holdEnabled = true;
  try {
    chrome.storage.local.get(['hideIncoming'], (s) => {
      if (s && typeof s.hideIncoming === 'boolean') G.holdEnabled = s.hideIncoming;
    });
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.hideIncoming && typeof ch.hideIncoming.newValue === 'boolean') G.holdEnabled = ch.hideIncoming.newValue;
    });
  } catch (_e) { /* tests / no storage: keep default */ }

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
    // Never inside an editable area: a tag appended into the compose box
    // becomes part of what the user types (seen in Google Chat 2026-10-27:
    // the caret landed in the tag and the typed text appeared as a "bubble").
    if (isEditable(el)) return;
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

  function isEditable(el) {
    try {
      if (el.isContentEditable) return true;
      return !!(el.closest && el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"], textarea, input'));
    } catch (_e) {
      return false;
    }
  }

  // --- hold (hide until checked) --------------------------------------------
  // Hold buttons ("הצג בלי בדיקה", "הצג בכל זאת", "למה?") are handled by ONE
  // delegated listener in the CAPTURE phase on the window, the first node of
  // every event path. Root cause of the dead buttons (0.7.1, 2026-10-27): the
  // placeholder registered capture-phase listeners that called
  // stopPropagation(); an ancestor's capture listener runs BEFORE the target,
  // so the click never reached the button. Handling it at the window also
  // wins against page listeners (WhatsApp / Google Chat) that would swallow
  // or re-render on mousedown, and survives a re-render that drops
  // per-element listeners: the action is looked up by the button's key.
  const ACTIONS = new Map(); // key -> fn
  let actionSeq = 0;
  const SWALLOW = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'touchstart', 'touchend', 'auxclick'];
  function inHold(t) {
    try { return !!(t && t.closest && t.closest('.lhg-hold')); } catch (_e) { return false; }
  }
  function onHoldClick(e) {
    const t = e && e.target;
    if (!inHold(t)) return;
    // The page never sees a click on the placeholder (no open/quote/react).
    e.stopImmediatePropagation();
    e.stopPropagation();
    let btn = null;
    try { btn = t.closest('.lhg-hold-btn'); } catch (_e) { btn = null; }
    if (!btn) return;
    e.preventDefault();
    const fn = ACTIONS.get(btn.getAttribute('data-lhg-act'));
    if (fn) fn();
  }
  function onHoldOther(e) {
    if (inHold(e && e.target)) { e.stopImmediatePropagation(); e.stopPropagation(); }
  }
  G.installHoldListeners = (win = globalThis) => {
    if (!win || typeof win.addEventListener !== 'function' || win.__lhgHoldListeners) return;
    win.__lhgHoldListeners = true;
    win.addEventListener('click', onHoldClick, true);
    for (const ev of SWALLOW) win.addEventListener(ev, onHoldOther, true);
  };
  G.installHoldListeners();

  function holdButton(h, text, fn) {
    const key = 'a' + (++actionSeq);
    ACTIONS.set(key, fn);
    const keys = (h.getAttribute('data-lhg-keys') || '').split(' ').filter(Boolean);
    keys.push(key);
    h.setAttribute('data-lhg-keys', keys.join(' '));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lhg-hold-btn';
    b.setAttribute('data-lhg-act', key);
    b.textContent = text;
    h.appendChild(b);
    return b;
  }
  function dropActions(h) {
    for (const k of (h.getAttribute('data-lhg-keys') || '').split(' ')) if (k) ACTIONS.delete(k);
    h.setAttribute('data-lhg-keys', '');
  }

  // Text of a message element WITHOUT our own placeholder/tag, independent of
  // what is currently hidden (textContent walk; <br> = newline). Used so a held
  // element keeps the same id and is not re-sent with the label's text.
  function textOf(el) {
    if (!el) return '';
    let out = '';
    const walk = (n) => {
      for (const c of Array.from(n.childNodes || [])) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.classList && (c.classList.contains('lhg-hold') || c.classList.contains('lhg-tag'))) continue;
          if (c.tagName === 'BR') out += '\n';
          else walk(c);
        }
      }
    };
    walk(el);
    return out;
  }

  // Inline "phrasing" children that belong to the same run of message text.
  const INLINE = new Set(['A', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'IMG', 'BR', 'WBR', 'MARK', 'SMALL', 'SUB', 'SUP', 'DEL', 'INS']);
  const ownText = (el) => Array.from(el.childNodes || []).some((c) => c.nodeType === 3 && /\S/.test(c.nodeValue || ''));
  const isRun = (el) => {
    const kids = Array.from(el.children || []).filter((c) => !(c.classList && (c.classList.contains('lhg-hold') || c.classList.contains('lhg-tag'))));
    return ownText(el) || (kids.length > 0 && kids.every((c) => INLINE.has(c.tagName)));
  };
  // The element that holds the WHOLE message text around a text leaf. Root
  // cause of "pending label, text still visible" (0.7.1): Google Chat rows
  // were text LEAVES, so in "see <a>link</a> now" or "@<span>name</span>
  // text" only the inline child was held and the surrounding text stayed on
  // screen under the placeholder. Climb while the parent is the same text run
  // (own text, or only inline children); stop at the conversation area.
  function textRunRoot(el, stop = 4) {
    let cur = el;
    for (let i = 0; i < stop; i++) {
      const p = cur && cur.parentElement;
      if (!p || p.tagName === 'C-WIZ' || p.tagName === 'BODY' || !isRun(p)) break;
      if (textOf(p).length > 4000) break;
      cur = p;
    }
    return cur;
  }

  function unhold(el) {
    if (!el || !el.classList) return;
    el.classList.remove('lhg-held', 'lhg-held-warn', 'lhg-held-unsure', 'lhg-held-not_checked', 'lhg-held-pending');
    const h = el.querySelector && el.querySelector(':scope > .lhg-hold');
    if (h) { dropActions(h); h.remove(); }
  }

  // st: { phase, result }. onReveal: called on the explicit "show" click.
  // Buttons carry a key; the delegated window listener runs the action.
  function renderHold(el, st, onReveal) {
    if (!el || !el.classList || isEditable(el)) return;
    const old = el.querySelector(':scope > .lhg-tag');
    if (old) old.remove();
    el.classList.remove('lhg-held-warn', 'lhg-held-unsure', 'lhg-held-not_checked', 'lhg-held-pending');
    el.classList.add('lhg-held', 'lhg-held-' + st.phase);
    let h = el.querySelector(':scope > .lhg-hold');
    if (h && h.getAttribute('data-phase') === st.phase) return; // already showing this phase
    if (!h) {
      h = document.createElement('div');
      h.className = 'lhg-hold';
      h.setAttribute('dir', 'rtl');
      // Clicks on the placeholder must not open/quote/react to the message:
      // the window-level capture listener (above) stops them. Never stop them
      // in a capture listener HERE: that also kills the buttons inside.
      el.appendChild(h);
    }
    dropActions(h);
    h.setAttribute('data-phase', st.phase);
    h.textContent = '';
    const label = document.createElement('span');
    const mech = st.result && st.result.mechanism ? MECHANISM_HE[st.result.mechanism] : '';
    label.textContent = HOLD_TEXT[st.phase] + (mech ? ' (' + mech + ')' : '');
    h.appendChild(label);
    if (REVEAL_LABEL[st.phase]) holdButton(h, REVEAL_LABEL[st.phase], onReveal);
    if ((st.phase === 'warn' || st.phase === 'unsure') && globalThis.LHG_PANEL) {
      holdButton(h, 'למה?', () => {
        try { globalThis.LHG_PANEL.renderResult(st.result, { manual: true }); } catch (_e) { /* panel absent */ }
      });
    }
    const note = document.createElement('span');
    note.className = 'lhg-hold-note';
    note.textContent = 'תזכורת בלבד, לא פסיקה הלכתית.';
    if (st.phase !== 'pending') h.appendChild(note);
  }

  function phaseOf(r) {
    if (!r || r.dropped) return 'not_checked';
    if (r.alert === 'warn') return 'warn';
    if (r.alert === 'unsure') return 'unsure';
    if (r.alert === 'none') return 'clear';
    return 'not_checked'; // not_checked, not_configured, unknown: never implicit approval
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
  // findRows(root) -> [{ el, text, kind? }] candidate message rows in the DOM;
  //   kind 'email' rows are never held (tag only).
  // hold() -> boolean: hide live chat messages until checked (default: setting).
  function createScanner({ platform, findRows, root = document, hold = () => G.holdEnabled }) {
    const S = globalThis.LHG_SELECTORS;
    const seen = new Set();
    // id -> { phase: pending|warn|unsure|not_checked|clear, result, revealed, held, el }
    const state = new Map();
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

    // Paint the current state of one message onto every element that shows it
    // (a re-mount, or the same text rendered twice: all copies are covered,
    // not just the first one found).
    function apply(id) {
      const st = state.get(id);
      if (!st || !st.el) return;
      const els = st.els || [st.el];
      st.els = els.filter((e) => e === st.el || e.isConnected !== false);
      for (const el of st.els) {
        if (st.held && !st.revealed && st.phase !== 'clear') {
          renderHold(el, st, () => { st.revealed = true; apply(id); });
          continue;
        }
        unhold(el);
        if (st.phase === 'pending') tag(el, 'checking');
        else renderResult(el, st.result);
      }
    }
    function addEl(id, el) {
      const st = state.get(id);
      if (!st || !el) return false;
      st.els = st.els || [st.el];
      if (!st.els.includes(el)) st.els.push(el);
      if (st.el === el) return false;
      st.el = el;
      return true;
    }

    function scan() {
      let rows;
      try {
        rows = findRows(root) || [];
      } catch (_e) {
        return;
      }
      const fresh = [];
      const pendingDup = [];
      for (const row of rows) {
        if (row.el && isEditable(row.el)) continue; // the user's own draft is not an incoming message
        if (row.el && inHold(row.el)) continue; // our own placeholder, never a message
        const text = (row.text || '').trim();
        if (text.length < MIN_CHARS) continue;
        // The user's OWN message is never incoming (one rule: S.isOutgoing;
        // adapters also pre-filter, this guard covers every platform).
        if (row.kind !== 'email' && S.isOutgoing && S.isOutgoing(row.el, { localContext: row.localContext })) continue;
        const id = S.weakId(platform, row.el, text);
        // Just sent from this frame's compose box (same text, last seconds):
        // the page's echo of the user's message. Marked seen so it is not
        // picked up as incoming once the window has passed.
        if (!seen.has(id) && row.kind !== 'email' && G.recentlySent(text)) {
          seen.add(id);
          continue;
        }
        if (seen.has(id)) {
          // Re-mounted by the page (virtualised list): repaint its state so a
          // held message never reappears uncovered.
          if (addEl(id, row.el)) apply(id);
          else if (!state.has(id)) pendingDup.push({ id, el: row.el }); // same text twice in this scan
          continue;
        }
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
      if (fresh.length > BURST_LIMIT) return; // another chat / older history rendered: not live
      for (const row of fresh) {
        const held = !!hold() && row.kind !== 'email';
        state.set(row.id, { phase: 'pending', result: null, revealed: false, held, el: row.el, els: [row.el] });
        for (const d of pendingDup) if (d.id === row.id) addEl(row.id, d.el);
        apply(row.id); // before the next paint when called from observe()
        const accepted = queue.push({
          text: row.text.slice(0, 2000),
          message: row.message,
          done: (r) => {
            const st = state.get(row.id);
            if (!st) return;
            st.result = r && r.dropped ? { alert: 'not_checked' } : r;
            st.phase = phaseOf(r);
            apply(row.id);
          },
        });
        if (!accepted) { /* done() already ran with not_checked */ }
      }
    }

    return {
      scan,
      queueSize: queue.size,
      seenCount: () => seen.size,
      stateOf: (id) => state.get(id) || null,
      localContextFor: (el) => {
        try { return (el && localByEl.get(el)) || null; } catch (_e) { return null; }
      },
    };
  }

  // Scan once per animation frame after DOM additions, so a new message is
  // covered BEFORE it is first painted (a debounced scan would let it flash).
  // Mutations that add no element are ignored to keep idle pages cheap.
  function observe(scanner, target = document.body) {
    let scheduled = false;
    let lastEnd = 0;
    let lastCost = 0;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    const run = () => {
      // Adaptive guard for heavy pages (Gmail): when a scan is expensive, keep
      // a gap of ~4x its cost (max 250ms) so scanning never dominates the page.
      const gap = Math.min(250, lastCost * 4);
      const wait = lastEnd + gap - Date.now();
      if (lastCost > 8 && wait > 0) { setTimeout(() => raf(run), wait); return; }
      scheduled = false;
      const t0 = Date.now();
      scanner.scan();
      lastEnd = Date.now();
      lastCost = lastEnd - t0;
    };
    new MutationObserver((records) => {
      if (scheduled) return;
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType === 1 && !(n.classList && (n.classList.contains('lhg-hold') || n.classList.contains('lhg-tag')))) {
            scheduled = true;
            raf(run);
            return;
          }
        }
      }
    }).observe(target, { childList: true, subtree: true });
    setInterval(() => scanner.scan(), 15000);
  }

  // Delegates to the compose registry (compose-watch.js) when loaded.
  G.recentlySent = (text) => {
    try {
      const C = globalThis.LHG_COMPOSE;
      return !!(C && typeof C.recentlySent === 'function' && C.recentlySent(text));
    } catch (_e) {
      return false;
    }
  };
  G.createScanner = createScanner;
  G.observe = observe;
  G.isEditable = isEditable;
  G.textOf = textOf;
  G.textRunRoot = textRunRoot;
  G.phaseOf = phaseOf;
  G.TAG_TEXT = TAG_TEXT;
  G.HOLD_TEXT = HOLD_TEXT;
})();
