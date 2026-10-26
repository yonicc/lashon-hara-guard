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

  function show(kind, title, lines) {
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
    visible = true;
    return p;
  }

  function renderResult(r, opts = {}) {
    const manual = !!opts.manual;
    const mech = r && r.mechanism ? MECHANISM_HE[r.mechanism] || '' : '';
    const evidence = r && r.evidence ? '״' + r.evidence + '״' : '';
    switch (r && r.alert) {
      case 'warn':
        show('warn', '⚠️ שים לב: ההודעה עלולה להתפרש כגנאי', [
          mech && 'אופן: ' + mech,
          evidence && 'בגלל: ' + evidence,
          'זו תזכורת לשקול ניסוח, לא פסיקה הלכתית.',
        ]);
        break;
      case 'unsure':
        show('unsure', 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת', [
          evidence && 'כדאי לבדוק: ' + evidence,
          'איך יבין את זה מי שמדברים עליו?',
          'זו תזכורת בלבד, לא פסיקה הלכתית.',
        ]);
        break;
      case 'not_checked':
        show('muted', 'ההודעה לא נבדקה', ['אין חיבור לשרת הבדיקה כרגע. זה לא אומר שהיא תקינה.']);
        break;
      case 'not_configured':
        show('muted', 'Lashon Hara Guard לא מוגדר', ['פתח את הגדרות התוסף והדבק את מפתח הגישה.']);
        break;
      case 'none':
        if (manual) {
          show('muted', 'לא התקבלה התראה בבדיקה זו', [
            'אין בכך פסיקה או קביעה שהטקסט תקין.',
          ]);
        } else {
          hide();
        }
        break;
      default:
        if (manual) show('muted', 'הטקסט לא נבדק', ['לא התקבלה תשובה מזוהה משרת הבדיקה. זה לא אומר שהוא תקין.']);
        else hide();
    }
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
      show('muted', 'Lashon Hara Guard פעיל בעמוד זה', [
        ...statusLines,
        'לבדיקה ידנית של טקסט: סמן אותו בעמוד ולחץ שוב על קיצור הפאנל.',
        'זו תזכורת בלבד, לא פסיקה הלכתית.',
      ]);
      return;
    }

    show('checking', '…בודק את הטקסט', []);
    chrome.runtime.sendMessage(
      {
        type: 'lhg-check',
        text: text.slice(0, 2000),
        platform: opts.platform || 'unknown',
        direction,
      },
      (r) => {
        if (chrome.runtime.lastError) {
          renderResult({ alert: 'not_checked' }, { manual: true });
          return;
        }
        renderResult(r || { alert: 'not_checked' }, { manual: true });
      },
    );
  }

  // Preferred manual trigger: the native Chrome command. Chrome fires it
  // before any page/browser default, so it cannot be eaten by Chrome's
  // built-in zoom (Ctrl+Shift+= / Ctrl+plus) the way a page keydown can.
  // Registering it is a no-op (via bindCommandFallback) when a caller does
  // not want the native path. Returns true when the native path is armed.
  function bindCommandOpenPanel(opts = {}) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'lhg-open-panel') {
          openManual(opts);
          return true;
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
    openManual,
    bindManualShortcut,
    bindCommandOpenPanel,
    isVisible: () => visible,
  };
})();
