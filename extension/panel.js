// Shared in-page panel for every platform. Loaded before the adapters.
// The panel only presents the proxy result; it never defines an alert level,
// never blocks sending and never rewrites a message.
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

  const MECHANISM_HE = {
    irony: 'אירוניה',
    praise: 'שבח שעלול להישמע כלעג',
    hint: 'רמז שמזהה אדם',
    mockery: 'לעג',
    omission: 'השמטה שמרמזת',
    direct: 'ביקורת ישירה',
    other: 'משמעות שלילית אפשרית',
  };

  let panel = null;
  let visible = false;

  function ensurePanel() {
    if (panel && document.body && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'lhg-panel';
    panel.setAttribute('dir', 'rtl');
    panel.setAttribute('role', 'status');
    document.body.appendChild(panel);
    return panel;
  }

  function hide() {
    if (panel) panel.className = 'lhg-hidden';
    visible = false;
  }

  function show(kind, title, lines, actions) {
    const p = ensurePanel();
    p.className = 'lhg-' + kind;
    p.textContent = '';
    const close = document.createElement('button');
    close.className = 'lhg-close';
    close.textContent = '×';
    close.title = 'סגור';
    close.addEventListener('click', hide);
    const h = document.createElement('div');
    h.className = 'lhg-title';
    h.textContent = title;
    p.append(close, h);
    for (const line of lines || []) {
      if (!line) continue;
      const d = document.createElement('div');
      d.className = 'lhg-line';
      d.textContent = line; // never innerHTML: evidence is user/page text
      p.appendChild(d);
    }
    for (const a of actions || []) {
      const b = document.createElement('button');
      b.className = 'lhg-action';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        try { a.onClick(b); } catch (_e) { b.textContent = 'נכשל'; }
      });
      p.appendChild(b);
    }
    visible = true;
    return p;
  }

  const AUDIENCE_HE = {
    private: 'שיחה פרטית',
    group: 'קבוצה',
    public: 'פרסום פומבי',
  };

  // The proxy's "analysis" as display lines. Explanation only: it never
  // changes the alert level. Names come from r.localNames (resolved in-page).
  function detailLines(r) {
    const a = (r && r.analysis) || {};
    const n = (r && r.localNames) || {};
    const who = (ref, local) => (ref === 'self' ? 'אתה' : local || '');
    const speaker = who(a.speakerRef, n.speaker);
    const subject = n.subject || (a.subjectMention ? '״' + a.subjectMention + '״' : '') || a.subjectDescriptionHe || '';
    const lines = [];
    if (speaker) lines.push('מי אומר: ' + speaker);
    if (subject) lines.push('על מי: ' + subject + (n.subject && a.subjectDescriptionHe ? ' (' + a.subjectDescriptionHe + ')' : ''));
    if (a.audience && AUDIENCE_HE[a.audience]) lines.push('למי: ' + AUDIENCE_HE[a.audience]);
    if (a.claimHe) lines.push('מה נאמר עליו: ' + a.claimHe);
    if (a.whyHe) lines.push('למה זה עלול להתפרש כגנאי: ' + a.whyHe);
    // Also enforce the display budget for older proxy responses.
    if (!(r && r.rules && r.rules.question)) {
      for (const q of (a.questionsHe || []).slice(0, 1)) lines.push('• ' + q);
    }
    const ctx = r && typeof r.contextMessages === 'number' ? r.contextMessages : null;
    if (ctx !== null) {
      lines.push(ctx > 0
        ? 'נלקחו בחשבון ' + ctx + ' הודעות קודמות בשיחה.'
        : 'ההודעה נבדקה לבדה, בלי הקשר השיחה.');
    }
    return lines;
  }

  // A collapsed "details" action that expands the who/about-whom/why block.
  function detailsAction(r) {
    const lines = detailLines(r);
    if (!lines.length) return [];
    let box = null;
    return [{
      label: 'פרטים: מי, על מי ולמה ▾',
      onClick: (btn) => {
        if (box) {
          box.remove();
          box = null;
          btn.textContent = 'פרטים: מי, על מי ולמה ▾';
          return;
        }
        box = document.createElement('div');
        box.className = 'lhg-details';
        for (const line of lines) {
          const d = document.createElement('div');
          d.className = 'lhg-line';
          d.textContent = line; // never innerHTML
          box.appendChild(d);
        }
        btn.after(box);
        btn.textContent = 'הסתר פרטים ▴';
      },
    }];
  }

  // Never "permitted / fine / approved", even after every question was
  // answered: draft rules can only flag or ask (owner rule, docs/18).
  const NO_FURTHER_NOTE_HE = 'לא נמצאה הערה נוספת לפי כללי הטיוטה; אינו פסק.';

  function lineEl(text, cls = 'lhg-line') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text; // never innerHTML: server/page text
    return d;
  }

  function rulesVisible(r) {
    const rules = globalThis.LHG_RULES ? globalThis.LHG_RULES.readRules(r) : null;
    return !!(rules && (rules.findings.length || rules.question));
  }

  // Draft Chafetz Chaim findings / one clarifying question / limitations,
  // under the main result. opts.onAnswer(factId, value) re-checks with the
  // answer; without it the question is shown as text only.
  function appendRules(p, r, opts = {}) {
    const R = globalThis.LHG_RULES;
    if (!R || !p) return;
    const rules = R.readRules(r);
    const lims = R.limitations(r);
    if (!rules && !lims.length) return;
    const box = document.createElement('div');
    box.className = 'lhg-rules';
    if (rules) {
      box.appendChild(lineEl('כללי חפץ חיים (טיוטה, לא נבדקו בידי מומחה):', 'lhg-line lhg-rules-title'));
      if (rules.notChecked) box.appendChild(lineEl('הכללים לא נבדקו.'));
      for (const f of rules.findings) {
        const d = lineEl('• ' + f.messageHe, 'lhg-line lhg-finding');
        if (f.sourceRef || f.sourceUrl) {
          const src = document.createElement('span');
          src.className = 'lhg-source';
          src.textContent = ' מקור: ';
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
      if (!rules.notChecked && !rules.findings.length && !rules.question) box.appendChild(lineEl(NO_FURTHER_NOTE_HE));
      const q = rules.question;
      if (q) {
        box.appendChild(lineEl('שאלת בירור: ' + q.textHe, 'lhg-line lhg-question'));
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
              try { opts.onAnswer(q.factId, a.value); } catch (_e) { b.textContent = 'נכשל'; }
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
    const manual = !!opts.manual;
    const mech = r && r.mechanism ? MECHANISM_HE[r.mechanism] || '' : '';
    const evidence = r && r.evidence ? '״' + r.evidence + '״' : '';
    let p = null;
    switch (r && r.alert) {
      case 'warn':
        p = show('warn', '⚠️ שים לב: ההודעה עלולה להתפרש כגנאי', [
          mech && 'אופן: ' + mech,
          evidence && 'בגלל: ' + evidence,
          'זו תזכורת לשקול ניסוח, לא פסיקה הלכתית.',
        ], detailsAction(r));
        break;
      case 'unsure':
        p = show('unsure', 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת', [
          evidence && 'כדאי לבדוק: ' + evidence,
          'איך יבין את זה מי שמדברים עליו?',
          'זו תזכורת בלבד, לא פסיקה הלכתית.',
        ], detailsAction(r));
        break;
      case 'not_checked':
        p = show('muted', 'ההודעה לא נבדקה', ['אין חיבור לשרת הבדיקה כרגע. זה לא אומר שאין בה בעיה.']);
        break;
      case 'not_configured':
        show('muted', 'Lashon Hara Guard לא מוגדר', ['פתח את הגדרות התוסף והדבק את מפתח הגישה.']);
        break;
      case 'none':
        if (manual || rulesVisible(r)) {
          p = show('muted', 'לא התקבלה התראה בבדיקה זו', [
            'אין בכך פסיקה, ואין זו קביעה שאין בטקסט בעיה.',
          ]);
        } else {
          hide();
        }
        break;
      default:
        if (manual) p = show('muted', 'הטקסט לא נבדק', ['לא התקבלה תשובה מזוהה משרת הבדיקה. זה לא אומר שאין בו בעיה.']);
        else hide();
    }
    if (p) appendRules(p, r, opts);
  }

  // One check (compose or manual) with the conversation's stored answers;
  // answering the clarifying question stores the answer and checks again with
  // the cumulative confirmedFacts (<= 20). opts: { manual, isCurrent() }.
  function check(payload, el, opts = {}) {
    const R = globalThis.LHG_RULES;
    const send = globalThis.LHG_CONTEXT_RUNTIME?.send || ((msg, cb) => chrome.runtime.sendMessage(msg, cb));
    const conv = R ? R.conversationKey(payload.platform, el) : null;
    const current = () => (typeof opts.isCurrent === 'function' ? opts.isCurrent() : true);
    // answered: a re-check after the user answered; its result is always shown
    // (even "none"), so the user sees the outcome of the answer.
    const go = (facts, answered = false) => {
      const msg = R ? R.withAnswers(payload, facts) : payload;
      send(msg, (r) => {
        if (!current()) return;
        const res = chrome.runtime.lastError ? { alert: 'not_checked' } : r || { alert: 'not_checked' };
        renderResult(res, {
          manual: !!opts.manual || answered,
          onAnswer: R
            ? (factId, value) => {
                Promise.resolve(R.saveAnswer(conv, factId, value, msg.confirmedFacts || {})).then((all) => {
                  if (!current()) return;
                  show('checking', '…בודק שוב לפי התשובה', []);
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

  function openManual(opts = {}) {
    if (visible) {
      hide();
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
      const statusLines =
        typeof opts.getStatusLines === 'function' ? opts.getStatusLines() : [];
      // Structure-only diagnostics (no message text) the user can paste to a
      // developer when the page is not recognised.
      const actions = typeof opts.getDiagnostics === 'function'
        ? [{
            label: 'העתק אבחון למפתח',
            onClick: (btn) => {
              const data = JSON.stringify(opts.getDiagnostics());
              Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(data))
                .then(() => { btn.textContent = 'הועתק ✓ (מבנה הדף בלבד, בלי תוכן הודעות)'; })
                .catch(() => { btn.textContent = 'ההעתקה נכשלה'; });
            },
          }]
        : [];
      show('muted', 'Lashon Hara Guard פעיל בעמוד זה', [
        ...statusLines,
        'לבדיקה ידנית של טקסט: סמן אותו בעמוד ולחץ שוב על קיצור הפאנל.',
        'זו תזכורת בלבד, לא פסיקה הלכתית.',
      ], actions);
      return;
    }

    show('checking', '…בודק את הטקסט', []);
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
  // Registering it is a no-op (via bindCommandFallback) when a caller does
  // not want the native path. Returns true when the native path is armed.
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

  globalThis.LHG_PANEL = {
    show,
    hide,
    renderResult,
    check,
    appendRules,
    NO_FURTHER_NOTE_HE,
    openManual,
    bindManualShortcut,
    bindCommandOpenPanel,
    ownsCommand,
    detailLines,
    isVisible: () => visible,
  };
})();
