// Shared in-page panel for every platform. Loaded before the adapters.
// The panel only presents the proxy result; it never defines an alert level,
// never blocks sending and never rewrites a message.
//
// Layout (0.9 UX, design language of ui/prototype.html): a glass card with a
// header (drag handle, language button, close), a scrolling body (the result)
// and a footer with a FREE-TEXT input that is always there. The note is sent
// as `userNote` (<= LHG_RULES.USER_NOTE_MAX chars) together with the last
// checked text; with nothing checked yet the note itself is checked as text.
// Position and size are the user's: drag the header, resize from the corner;
// both are kept in chrome.storage.local ("lhgPanelGeom") and clamped to the
// viewport (small screens get the full width).
//
// Manual opening (0.4.0): the Chrome-NATIVE command "open-panel"
// (chrome.commands, manifest "commands"; default Ctrl+Shift+L) is delivered
// by background.js as {type:'lhg-open-panel'} — a true extension command
// fires before any page/browser default, so it cannot collide with Chrome's
// built-in zoom the way a page keydown could. The legacy page-level
// Ctrl+Shift+plus handler is kept only as a fallback for builds where the
// command cannot be registered, and no longer claims to prevent zoom.
(() => {
  if (globalThis.LHG_PANEL) return;

  const t = (k, v) => (globalThis.LHG_I18N ? globalThis.LHG_I18N.t(k, v) : k);
  const loc = (s) => (globalThis.LHG_I18N ? globalThis.LHG_I18N.localize(s) : s);
  const uiDir = () => (globalThis.LHG_I18N ? globalThis.LHG_I18N.dir() : 'rtl');
  const noteMax = () => (globalThis.LHG_RULES && globalThis.LHG_RULES.USER_NOTE_MAX) || 500;

  const GEOM_KEY = 'lhgPanelGeom';
  const DEFAULT_W = 420;
  const MIN_W = 300;
  const MIN_H = 180;
  const MARGIN = 8;
  const DEFAULT_RIGHT = 24;
  const DEFAULT_BOTTOM = 84;

  let panel = null;
  let parts = null; // { head, body, foot, note, send, hint, lang, close, grip }
  let visible = false;
  let view = null; // () => void: re-renders the current view (language switch)
  let presenting = false; // show() called from inside present()
  let lastCheck = null; // { payload (without userNote), el }: target of the free note
  let boundPlatform = '';
  let geom = null; // user geometry {x, y, w, h?}; null = default bottom corner

  function css(el, styles) {
    if (el && el.style) Object.assign(el.style, styles);
  }
  function storage() {
    try { return chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (_e) { return null; }
  }

  // Pure: the geometry that fits the viewport. g: {x?, y?, w?, h?} or null;
  // vp: {w, h}; contentH: the panel's natural height (auto-height case).
  function clampGeometry(g, vp, contentH = 240) {
    const maxW = Math.max(160, vp.w - 2 * MARGIN);
    const w = Math.min(Math.max((g && g.w) || DEFAULT_W, MIN_W), maxW);
    const hasH = !!(g && typeof g.h === 'number');
    const maxH = Math.max(MIN_H, vp.h - 2 * MARGIN);
    const h = hasH ? Math.min(Math.max(g.h, MIN_H), maxH) : null;
    const usedH = h || Math.min(Math.max(contentH, MIN_H), maxH);
    const placed = !!(g && typeof g.x === 'number' && typeof g.y === 'number');
    let x = placed ? g.x : vp.w - w - DEFAULT_RIGHT;
    let y = placed ? g.y : vp.h - usedH - DEFAULT_BOTTOM;
    x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vp.w - w - MARGIN));
    y = Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vp.h - Math.min(usedH, MIN_H) - MARGIN));
    return { x, y, w, h, maxH: Math.max(MIN_H, vp.h - y - MARGIN) };
  }

  function viewport() {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { w, h } : null;
  }

  function place() {
    if (!panel || !panel.style || !visible) return;
    const vp = viewport();
    if (!vp) return;
    // Measure the natural height under the largest allowed box first.
    css(panel, { height: geom && typeof geom.h === 'number' ? geom.h + 'px' : '', maxHeight: (vp.h - 2 * MARGIN) + 'px' });
    const g = clampGeometry(geom, vp, panel.offsetHeight || 240);
    if (geom && typeof geom.x === 'number') geom = { ...geom, x: g.x, y: g.y, w: g.w, ...(g.h ? { h: g.h } : {}) };
    css(panel, {
      left: g.x + 'px', top: g.y + 'px', right: 'auto', bottom: 'auto',
      width: g.w + 'px', height: g.h ? g.h + 'px' : '', maxHeight: g.maxH + 'px',
    });
  }

  function saveGeom(next) {
    geom = next;
    const st = storage();
    try { if (st) st.set({ [GEOM_KEY]: next }); } catch (_e) { /* storage unavailable */ }
  }

  function rect() {
    try { return panel.getBoundingClientRect(); } catch (_e) { return null; }
  }

  // Pointer-captured drag: the page never sees these moves.
  function dragWith(handle, onMove) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, textarea, a, input')) return;
      const r0 = rect();
      if (!r0) return;
      const start = { px: e.clientX, py: e.clientY, x: r0.left, y: r0.top, w: r0.width, h: r0.height };
      try { handle.setPointerCapture(e.pointerId); } catch (_e) { /* old browsers */ }
      e.preventDefault();
      const move = (ev) => {
        onMove(start, ev.clientX - start.px, ev.clientY - start.py);
        place();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (geom) saveGeom(geom);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function button(cls, text, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function chromeText() {
    if (!parts) return;
    parts.brand.textContent = t('brand');
    parts.lang.textContent = t('lang.other');
    parts.lang.title = t('lang.otherTitle');
    parts.close.title = t('close');
    parts.head.title = t('drag');
    parts.grip.title = t('resize');
    parts.send.textContent = t('note.send');
    parts.note.setAttribute('placeholder', t('note.placeholder'));
    parts.hint.textContent = lastCheck ? t('note.hintWithText', { max: noteMax() }) : t('note.hintNoText');
    if (panel) panel.setAttribute('dir', uiDir());
  }

  function ensurePanel() {
    if (panel && document.body && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'lhg-panel';
    panel.className = 'lhg-hidden';
    panel.setAttribute('role', 'dialog');

    const head = document.createElement('div');
    head.className = 'lhg-head';
    const dot = document.createElement('span');
    dot.className = 'lhg-dot';
    const brand = document.createElement('span');
    brand.className = 'lhg-brand';
    const lang = button('lhg-hbtn lhg-lang', '', () => {
      const I = globalThis.LHG_I18N;
      if (I) I.setLang(I.lang() === 'he' ? 'en' : 'he');
    });
    const close = button('lhg-hbtn lhg-close', '×', hide);
    head.append(dot, brand, lang, close);

    const body = document.createElement('div');
    body.className = 'lhg-body';
    body.setAttribute('role', 'status');

    const foot = document.createElement('div');
    foot.className = 'lhg-foot';
    const note = document.createElement('textarea');
    note.className = 'lhg-note';
    note.rows = 2;
    note.maxLength = noteMax();
    note.setAttribute('dir', 'auto');
    const send = button('lhg-send', '', sendNote);
    const hint = document.createElement('div');
    hint.className = 'lhg-note-hint';
    foot.append(note, send, hint);
    // Keys typed in the note belong to the note, not to the page's shortcuts.
    for (const ev of ['keydown', 'keyup', 'keypress']) {
      note.addEventListener(ev, (e) => {
        try { e.stopPropagation(); } catch (_e) { /* ignore */ }
        if (ev === 'keydown' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          try { e.preventDefault(); } catch (_e) { /* ignore */ }
          sendNote();
        }
      });
    }

    const grip = document.createElement('div');
    grip.className = 'lhg-grip';

    panel.append(head, body, foot, grip);
    parts = { head, brand, lang, close, body, foot, note, send, hint, grip };
    chromeText();

    dragWith(head, (s, dx, dy) => {
      geom = { x: s.x + dx, y: s.y + dy, w: s.w, ...(geom && typeof geom.h === 'number' ? { h: geom.h } : {}) };
    });
    dragWith(grip, (s, dx, dy) => {
      const rtl = uiDir() === 'rtl'; // the grip sits in the bottom inline-end corner
      const w = Math.max(MIN_W, rtl ? s.w - dx : s.w + dx);
      geom = { x: rtl ? s.x + (s.w - w) : s.x, y: s.y, w, h: Math.max(MIN_H, s.h + dy) };
    });

    document.body.appendChild(panel);
    return panel;
  }

  function hide() {
    if (panel) panel.className = 'lhg-hidden';
    visible = false;
    view = null;
  }

  // Renders into the panel body; returns the body (callers append rule blocks).
  function show(kind, title, lines, actions) {
    const p = ensurePanel();
    if (!presenting) view = null; // a caller's own text cannot be re-rendered
    p.className = 'lhg-' + kind;
    chromeText();
    const body = parts.body;
    body.textContent = '';
    const h = document.createElement('div');
    h.className = 'lhg-title';
    h.textContent = loc(title);
    body.appendChild(h);
    for (const line of lines || []) {
      if (!line) continue;
      body.appendChild(lineEl(loc(line))); // never innerHTML: evidence is user/page text
    }
    const row = actions && actions.length ? document.createElement('div') : null;
    if (row) row.className = 'lhg-actions';
    for (const a of actions || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lhg-action';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        try { a.onClick(b); } catch (_e) { b.textContent = t('failed'); }
      });
      row.appendChild(b);
    }
    if (row) body.appendChild(row);
    visible = true;
    place();
    return body;
  }

  // A view that can be rebuilt in another language.
  function present(fn) {
    presenting = true;
    try { fn(); } finally { presenting = false; }
    view = visible ? fn : null;
  }

  // The proxy's "analysis" as display lines. Explanation only: it never
  // changes the alert level. Names come from r.localNames (resolved in-page).
  function detailLines(r) {
    const a = (r && r.analysis) || {};
    const n = (r && r.localNames) || {};
    const who = (ref, local) => (ref === 'self' ? t('you') : local || '');
    const speaker = who(a.speakerRef, n.speaker);
    const q = (s) => (uiDir() === 'rtl' ? '״' + s + '״' : '"' + s + '"');
    const subject = n.subject || (a.subjectMention ? q(a.subjectMention) : '') || a.subjectDescriptionHe || '';
    const lines = [];
    if (speaker) lines.push(t('detail.speaker', { v: speaker }));
    if (subject) lines.push(t('detail.subject', { v: subject + (n.subject && a.subjectDescriptionHe ? ' (' + a.subjectDescriptionHe + ')' : '') }));
    if (a.audience && ['private', 'group', 'public'].includes(a.audience)) lines.push(t('detail.audience', { v: t('audience.' + a.audience) }));
    if (a.claimHe) lines.push(t('detail.claim', { v: a.claimHe }));
    if (a.whyHe) lines.push(t('detail.why', { v: a.whyHe }));
    // Also enforce the display budget for older proxy responses. A catalog
    // question (singular legacy or the new questions array) consumes it.
    const hasCatalogQ = !!(r && r.rules && (r.rules.question || (Array.isArray(r.rules.questions) && r.rules.questions.length)));
    if (!hasCatalogQ) {
      for (const x of (a.questionsHe || []).slice(0, 1)) lines.push('• ' + x);
    }
    const ctx = r && typeof r.contextMessages === 'number' ? r.contextMessages : null;
    if (ctx !== null) lines.push(ctx > 0 ? t('detail.ctxN', { n: ctx }) : t('detail.ctx0'));
    return lines;
  }

  // A collapsed "details" action that expands the who/about-whom/why block.
  function detailsAction(r) {
    const lines = detailLines(r);
    if (!lines.length) return [];
    let box = null;
    return [{
      label: t('details.show'),
      onClick: (btn) => {
        if (box) {
          box.remove();
          box = null;
          btn.textContent = t('details.show');
          return;
        }
        box = document.createElement('div');
        box.className = 'lhg-details';
        for (const line of lines) box.appendChild(lineEl(line));
        const host = btn.parentElement || btn;
        if (typeof host.after === 'function') host.after(box);
        btn.textContent = t('details.hide');
      },
    }];
  }

  function lineEl(text, cls = 'lhg-line') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text; // never innerHTML: server/page text
    return d;
  }

  function rulesVisible(r) {
    const rules = globalThis.LHG_RULES ? globalThis.LHG_RULES.readRules(r) : null;
    return !!(rules && (rules.findings.length || (rules.questions && rules.questions.length)));
  }

  // Draft Chafetz Chaim findings / up to 5 clarifying questions / limitations,
  // under the main result. opts.onAnswer(factId, value) re-checks with the
  // answer; without it the questions are shown as text only.
  function appendRules(p, r, opts = {}) {
    const R = globalThis.LHG_RULES;
    if (!R || !p) return;
    const rules = R.readRules(r);
    const lims = R.limitations(r);
    if (!rules && !lims.length) return;
    const box = document.createElement('div');
    box.className = 'lhg-rules';
    if (rules) {
      box.appendChild(lineEl(t('rules.title'), 'lhg-line lhg-rules-title'));
      if (rules.notChecked) box.appendChild(lineEl(t('rules.notChecked')));
      for (const f of rules.findings) {
        const d = lineEl('• ' + f.messageHe, 'lhg-line lhg-finding');
        if (f.sourceRef || f.sourceUrl) {
          const src = document.createElement('span');
          src.className = 'lhg-source';
          src.textContent = t('rules.source');
          if (f.sourceUrl) {
            const a = document.createElement('a');
            a.href = f.sourceUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = f.sourceRef || f.sourceUrl;
            src.appendChild(a);
          } else {
            src.textContent += f.sourceRef;
          }
          d.appendChild(src);
        }
        box.appendChild(d);
      }
      const questions = rules.questions && rules.questions.length ? rules.questions : (rules.question ? [rules.question] : []);
      if (!rules.notChecked && !rules.findings.length && !questions.length) box.appendChild(lineEl(t('noFurtherNote')));
      for (const q of questions) {
        box.appendChild(lineEl(t('rules.question', { q: q.textHe }), 'lhg-line lhg-question'));
        if (typeof opts.onAnswer === 'function') {
          const row = document.createElement('div');
          row.className = 'lhg-answers';
          const btns = [];
          for (const a of q.answers) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lhg-action lhg-answer';
            b.textContent = a.labelHe;
            b.addEventListener('click', () => {
              for (const x of btns) x.disabled = true;
              try { opts.onAnswer(q.factId, a.value); } catch (_e) { b.textContent = t('failed'); }
            });
            btns.push(b);
            row.appendChild(b);
          }
          box.appendChild(row);
        }
      }
    }
    for (const l of lims) box.appendChild(lineEl(l, 'lhg-line lhg-limit'));
    p.appendChild(box);
  }

  function renderResult(r, opts = {}) {
    present(() => renderResultNow(r, opts));
  }

  function renderResultNow(r, opts) {
    const manual = !!opts.manual;
    const mech = r && r.mechanism && globalThis.LHG_I18N ? globalThis.LHG_I18N.mechanism(r.mechanism) : '';
    const quote = (s) => (uiDir() === 'rtl' ? '״' + s + '״' : '"' + s + '"');
    const evidence = r && r.evidence ? quote(r.evidence) : '';
    const yours = opts.userNote ? t('note.yours', { v: quote(opts.userNote) }) : '';
    let p = null;
    switch (r && r.alert) {
      case 'warn':
        p = show('warn', t('warn.title'), [
          mech && t('warn.mech', { v: mech }),
          evidence && t('warn.because', { v: evidence }),
          yours,
          t('warn.reminder'),
        ], detailsAction(r));
        break;
      case 'unsure':
        p = show('unsure', t('unsure.title'), [
          evidence && t('unsure.check', { v: evidence }),
          t('unsure.ask'),
          yours,
          t('reminderOnly'),
        ], detailsAction(r));
        break;
      case 'not_checked':
        p = show('muted', t('notChecked.title'), [t('notChecked.body')]);
        break;
      case 'not_configured':
        show('muted', t('notConfigured.title'), [t('notConfigured.body')]);
        break;
      case 'none':
        if (manual || rulesVisible(r)) {
          p = show('muted', t('none.title'), [yours, t('none.body')]);
        } else {
          hide();
        }
        break;
      default:
        if (manual) p = show('muted', t('unknown.title'), [t('unknown.body')]);
        else hide();
    }
    if (p) appendRules(p, r, opts);
    if (p && (opts.onRecheck || (opts.onApprove && ['warn', 'unsure'].includes(r?.alert)))) {
      const action = (key, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lhg-action'; b.textContent = t(key);
        b.addEventListener('click', fn); p.appendChild(b);
      };
      if (opts.onRecheck) action('check.again', opts.onRecheck);
      if (opts.onApprove && ['warn', 'unsure'].includes(r?.alert)) action('send.anyway', opts.onApprove);
    }
  }

  // One check (compose, manual or free note) with the conversation's stored
  // answers; answering the clarifying question stores the answer and checks
  // again with the cumulative confirmedFacts (<= 20). A free note rides along
  // as `userNote` on that same check: one request, one billed check.
  // opts: { manual, isCurrent() }.
  function check(payload, el, opts = {}) {
    const R = globalThis.LHG_RULES;
    const send = globalThis.LHG_CONTEXT_RUNTIME?.send || ((msg, cb) => chrome.runtime.sendMessage(msg, cb));
    const conv = R ? R.conversationKey(payload.platform, el) : null;
    const current = () => (typeof opts.isCurrent === 'function' ? opts.isCurrent() : true);
    const { userNote, ...base } = payload;
    lastCheck = { payload: base, el, opts };
    if (parts) chromeText();
    // answered: a re-check after the user answered; its result is always shown
    // (even "none"), so the user sees the outcome of the answer.
    const go = (facts, answered = false, forceRecheck = false) => {
      const msg = { ...(R ? R.withAnswers(payload, facts) : payload), ...(forceRecheck ? { forceRecheck: true } : {}) };
      send(msg, (r) => {
        if (!current()) return;
        const res = chrome.runtime.lastError ? { alert: 'not_checked' } : r || { alert: 'not_checked' };
        if (typeof opts.onResult === 'function') opts.onResult(res);
        renderResult(res, {
          manual: !!opts.manual || answered || !!userNote,
          userNote: userNote || '',
          onApprove: opts.onApprove,
          onRecheck: () => { if (current()) { show('checking', t('recheck'), []); go(facts, true, true); } },
          onAnswer: R
            ? (factId, value) => {
                Promise.resolve(R.saveAnswer(conv, factId, value, msg.confirmedFacts || {})).then((all) => {
                  if (!current()) return;
                  show('checking', t('recheck'), []);
                  go(all, true);
                });
              }
            : null,
        });
      }, el);
    };
    if (!R || !conv) { go({}); return; } // nothing stored: send at once
    Promise.resolve(R.loadAnswers(conv)).then((f) => go(f), () => go({}));
  }

  // The free-text input: always available, whatever the panel shows.
  function sendNote() {
    if (!parts) return;
    const R = globalThis.LHG_RULES;
    const note = R ? R.userNote(parts.note.value) : String(parts.note.value || '').trim().slice(0, noteMax());
    if (!note) return;
    parts.note.value = '';
    if (lastCheck) {
      present(() => show('checking', t('note.sending'), []));
      check({ ...lastCheck.payload, userNote: note }, lastCheck.el, { ...lastCheck.opts, manual: true });
      return;
    }
    present(() => show('checking', t('checkingText'), []));
    check(
      { type: 'lhg-check', text: note, platform: boundPlatform || 'unknown', direction: 'outgoing' },
      document.activeElement,
      { manual: true },
    );
  }

  function selectionContext(resolveDirection) {
    const sel = window.getSelection ? window.getSelection() : null;
    const text = sel ? String(sel.toString() || '').trim() : '';
    if (!text) return null;
    let node = sel.anchorNode || null;
    if (node && node.nodeType === 3) node = node.parentElement;
    let direction = 'incoming';
    if (typeof resolveDirection === 'function') {
      try {
        direction = resolveDirection(node, text) || direction;
      } catch (_e) {
        // keep the incoming default; direction never turns a failure into "ok"
      }
    }
    return { text: text.slice(0, 2000), direction };
  }

  function siteActive(platform) {
    const S = globalThis.LHG_SETTINGS;
    return !S || !platform || S.isActive(platform);
  }

  function openManual(opts = {}) {
    if (visible) {
      hide();
      return;
    }
    if (!siteActive(opts.platform)) {
      present(() => show('muted', t('off.title'), [t('off.body')], [{
        label: t('off.enable'),
        onClick: () => {
          const S = globalThis.LHG_SETTINGS;
          Promise.resolve(S && S.enable(opts.platform)).then(() => { hide(); openManual(opts); });
        },
      }]));
      return;
    }
    const selected = selectionContext(opts.resolveDirection);
    const fallbackText =
      typeof opts.fallbackText === 'function' ? opts.fallbackText() : opts.fallbackText;
    const text = selected ? selected.text : String(fallbackText || '').trim();
    const direction = selected
      ? selected.direction
      : opts.fallbackDirection || opts.direction || 'incoming';

    if (!text || text.length < 6) {
      // Structure-only diagnostics (no message text) the user can paste to a
      // developer when the page is not recognised.
      const actions = () => (typeof opts.getDiagnostics === 'function'
        ? [{
            label: t('copyDiag'),
            onClick: (btn) => {
              const data = JSON.stringify(opts.getDiagnostics());
              Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(data))
                .then(() => { btn.textContent = t('copied'); })
                .catch(() => { btn.textContent = t('copyFailed'); });
            },
          }]
        : []);
      present(() => {
        const statusLines = typeof opts.getStatusLines === 'function' ? opts.getStatusLines() : [];
        show('muted', t('active.title'), [...statusLines, t('active.howto'), t('reminderOnly')], actions());
      });
      return;
    }

    show('checking', t('checkingText'), []);
    check(
      {
        type: 'lhg-check',
        text: text.slice(0, 2000),
        platform: opts.platform || 'unknown',
        direction,
      },
      globalThis.getSelection?.()?.anchorNode?.parentElement || document.activeElement,
      { manual: true },
    );
  }

  // Preferred manual trigger: the native Chrome command. Chrome fires it
  // before any page/browser default, so it cannot be eaten by Chrome's
  // built-in zoom (Ctrl+Shift+= / Ctrl+plus) the way a page keydown can.
  // The command message reaches EVERY frame of the tab (Gmail's Chat windows
  // are iframes). Exactly one frame should answer: the one holding focus. The
  // top frame answers unless focus is inside one of its child frames (or when
  // nothing in the page has focus, e.g. the shortcut came from the toolbar).
  function ownsCommand(win = globalThis.window, doc = globalThis.document) {
    try {
      const ae = doc.activeElement;
      const focusInChild = !!ae && /^(IFRAME|FRAME)$/.test(ae.tagName || '');
      const hasFocus = typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;
      if (!win || win.top === win) return !(hasFocus && focusInChild);
      return hasFocus && !focusInChild;
    } catch (_e) {
      return true;
    }
  }

  function bindCommandOpenPanel(opts = {}) {
    if (opts.platform) boundPlatform = opts.platform;
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'lhg-open-panel') {
          if (!ownsCommand()) return false;
          openManual(opts);
          // Answer at once so the popup's "open panel" button gets a reply.
          try { if (typeof sendResponse === 'function') sendResponse({ ok: true }); } catch (_e) { /* ignore */ }
          return false;
        }
        return false;
      });
      return true;
    } catch (_e) {
      return false;
    }
  }

  // The user's Ctrl+Shift+"+" is physically Ctrl+Shift+= on the main keyboard
  // (code Equal) or Ctrl+Shift+NumpadAdd on a numeric keypad. This is ONLY a
  // page-level fallback for builds without the native command bound. Chrome
  // reserves Ctrl+Shift+=/Ctrl+plus for built-in page zoom, and a content
  // script keydown cannot reliably pre-empt it — do not claim it does.
  function isPlusShortcut(e) {
    return !!(
      e &&
      e.ctrlKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      (e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')
    );
  }

  function bindManualShortcut(opts = {}) {
    // Arm the native command first; keep the page-level plus as fallback.
    bindCommandOpenPanel(opts);
    document.addEventListener(
      'keydown',
      (e) => {
        if (!isPlusShortcut(e)) return;
        try { e.preventDefault(); } catch (_e) { /* may already be handled */ }
        try { e.stopPropagation(); } catch (_e) { /* ignore */ }
        openManual(opts);
      },
      true,
    );
  }

  // Live updates: language (re-render the current view), switches (a site
  // turned off closes its panel), and the stored geometry (reset from options).
  try {
    if (globalThis.LHG_I18N) {
      globalThis.LHG_I18N.onChange(() => {
        if (!panel) return;
        chromeText();
        if (visible && view) view();
      });
    }
    if (globalThis.LHG_SETTINGS) {
      globalThis.LHG_SETTINGS.onChange(() => { if (visible && boundPlatform && !siteActive(boundPlatform)) hide(); });
    }
    const st = storage();
    if (st) {
      st.get([GEOM_KEY], (s) => {
        const g = s && s[GEOM_KEY];
        geom = g && typeof g === 'object' ? g : null;
        place();
      });
    }
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area && area !== 'local') return;
      if (!ch || !ch[GEOM_KEY]) return;
      const g = ch[GEOM_KEY].newValue;
      geom = g && typeof g === 'object' ? g : null;
      place();
    });
  } catch (_e) { /* tests / no storage */ }
  try { globalThis.addEventListener('resize', place); } catch (_e) { /* no window */ }

  globalThis.LHG_PANEL = {
    show,
    hide,
    renderResult,
    check,
    appendRules,
    get NO_FURTHER_NOTE_HE() { return t('noFurtherNote'); },
    openManual,
    bindManualShortcut,
    bindCommandOpenPanel,
    ownsCommand,
    detailLines,
    clampGeometry,
    sendNote,
    GEOM_KEY,
    isVisible: () => visible,
  };
})();
