// WhatsApp Web adapter (MVP): watches the compose box (outgoing, non-blocking
// reminder) and newly arriving incoming messages (direction=incoming, subtle
// tag next to the bubble). Sending is never blocked and nothing is ever
// rewritten automatically. All selectors come from selectors.js.
(() => {
  const S = globalThis.LHG_SELECTORS;
  const PLATFORM = 'whatsapp-web';
  const PAUSE_MS = 1200;
  const MIN_CHARS = 6;
  const COMPOSE_WATCH_MS = 4000;

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
  let composeMissingSince = 0;

  function findCompose() {
    if (!S) return null;
    for (const base of S.all(document, S.whatsapp.composeContainer.length ? ['footer', '#main'] : [])) {
      const el = S.first(base, S.whatsapp.compose);
      if (el && el.isContentEditable) return el;
    }
    return S.first(document, S.whatsapp.compose);
  }

  function composeBox(el) {
    if (!el || !el.isContentEditable) return null;
    // Strict: only the element the user is typing in (or its editable
    // container). Never substitute a different box found elsewhere.
    if (!S) return null;
    return S.closestMatch(el, S.whatsapp.compose);
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
    chrome.runtime.sendMessage(
      { type: 'lhg-check', text, platform: PLATFORM, direction: 'outgoing' },
      (r) => {
        if (my !== seq) return; // the user kept typing: a newer check owns the panel
        if (chrome.runtime.lastError) {
          render({ alert: 'not_checked' });
          return;
        }
        render(r);
      },
    );
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

  // --- "compose box not recognized" instead of silently failing -------------
  // Only relevant once a conversation view exists; the chat list legitimately
  // has no compose box, so require a chat-root element first.
  function watchComposePresence() {
    const chatOpen = S && !!S.first(document, S.whatsapp.chatRoot);
    const compose = findCompose();
    if (compose) {
      composeMissingSince = 0;
      if (panel && panel.dataset.lhgMissing === '1') hide();
      return;
    }
    if (!chatOpen) return;
    if (!composeMissingSince) composeMissingSince = Date.now();
    if (Date.now() - composeMissingSince > COMPOSE_WATCH_MS) {
      show('muted', 'התוסף לא מזהה את שורת הכתיבה', [
        'מבנה העמוד השתנה, לכן הבדיקה בזמן כתיבה מושהית. ההודעה לא נבדקה.',
      ]);
      if (panel) panel.dataset.lhgMissing = '1';
    }
  }
  setInterval(watchComposePresence, 2000);

  // --- incoming messages ---------------------------------------------------
  if (S && globalThis.LHG_INCOMING) {
    const scanner = globalThis.LHG_INCOMING.createScanner({
      platform: PLATFORM,
      findRows: (root) => {
        const rows = S.all(root, S.whatsapp.incomingMessage);
        return rows
          .map((el) => ({ el, text: S.extractText(el, S.whatsapp.messageText) }))
          .filter((r) => r.text);
      },
    });
    let scanTimer = null;
    const requestScan = () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => scanner.scan(), 700);
    };
    scanner.scan(); // baseline only: history is marked seen, never sent
    new MutationObserver(requestScan).observe(document.body, { childList: true, subtree: true });
    setInterval(() => scanner.scan(), 15000);
  }
})();
