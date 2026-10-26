// WhatsApp Web adapter (MVP): watch the compose box, ask the proxy once the
// user pauses typing, and show a small NON-blocking panel. Sending is never
// blocked and nothing is ever rewritten automatically.
(() => {
  const PLATFORM = 'whatsapp-web';
  const PAUSE_MS = 1200;
  const MIN_CHARS = 6;

  const MECHANISM_HE = {
    irony: 'אירוניה',
    praise: 'שבח שעלול להישמע כלעג',
    hint: 'רמז שמזהה אדם',
    mockery: 'לעג',
    omission: 'השמטה שמרמזת',
    direct: 'ביקורת ישירה',
    other: 'משמעות שלילית אפשרית',
  };

  let timer = null;
  let lastChecked = '';
  let seq = 0;
  let panel = null;

  function composeBox(el) {
    if (!el || !el.isContentEditable) return null;
    const box = el.closest('[contenteditable="true"]');
    return box && box.closest('footer') ? box : null;
  }

  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'lhg-panel';
    panel.setAttribute('dir', 'rtl');
    panel.setAttribute('role', 'status');
    document.body.appendChild(panel);
    return panel;
  }

  function hide() {
    if (panel) panel.className = 'lhg-hidden';
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
    for (const line of lines) {
      if (!line) continue;
      const d = document.createElement('div');
      d.className = 'lhg-line';
      d.textContent = line; // never innerHTML: the evidence is user text
      p.appendChild(d);
    }
  }

  function render(r) {
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
        ]);
        break;
      case 'not_checked':
        show('muted', 'ההודעה לא נבדקה', ['אין חיבור לשרת הבדיקה כרגע. זה לא אומר שהיא תקינה.']);
        break;
      case 'not_configured':
        show('muted', 'Lashon Hara Guard לא מוגדר', ['פתח את הגדרות התוסף והדבק את מפתח הגישה.']);
        break;
      default:
        hide();
    }
  }

  function schedule(box) {
    clearTimeout(timer);
    const text = (box.innerText || '').trim();
    if (text.length < MIN_CHARS) {
      lastChecked = '';
      hide();
      return;
    }
    timer = setTimeout(() => run(text), PAUSE_MS);
  }

  function run(text) {
    if (text === lastChecked) return;
    lastChecked = text;
    const my = ++seq;
    show('checking', '…בודק ניסוח', []);
    chrome.runtime.sendMessage({ type: 'lhg-check', text, platform: PLATFORM }, (r) => {
      if (my !== seq) return; // the user kept typing: a newer check owns the panel
      if (chrome.runtime.lastError) {
        render({ alert: 'not_checked' });
        return;
      }
      render(r);
    });
  }

  document.addEventListener(
    'input',
    (e) => {
      const box = composeBox(e.target);
      if (box) schedule(box);
    },
    true,
  );

  // After sending (Enter clears the box) drop any stale panel.
  document.addEventListener(
    'keyup',
    (e) => {
      const box = composeBox(e.target);
      if (box && !(box.innerText || '').trim()) {
        seq++;
        lastChecked = '';
        hide();
      }
    },
    true,
  );
})();
