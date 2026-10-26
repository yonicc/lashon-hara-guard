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
  let composeMissingSince = 0;
  const P = globalThis.LHG_PANEL;

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

  const hide = () => P && P.hide();
  const show = (kind, title, lines) => P && P.show(kind, title, lines);
  const render = (r) => P && P.renderResult(r);

  function readComposeText() {
    const box = findCompose();
    return box ? (box.innerText || '').trim() : '';
  }

  function resolveDirection(node) {
    if (node && node.closest) {
      if (node.closest(S ? S.whatsapp.compose.join(',') : 'footer [contenteditable="true"]')) return 'outgoing';
      if (node.closest('.message-out, [class*="message-out"]')) return 'outgoing';
      if (node.closest('.message-in, [class*="message-in"]')) return 'incoming';
    }
    return 'incoming';
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
      return;
    }
    if (!chatOpen) return;
    if (!composeMissingSince) composeMissingSince = Date.now();
    if (!P) return;
    if (Date.now() - composeMissingSince > COMPOSE_WATCH_MS) {
      show('muted', 'התוסף לא מזהה את שורת הכתיבה', [
        'מבנה העמוד השתנה, לכן הבדיקה בזמן כתיבה מושהית. ההודעה לא נבדקה.',
      ]);
    }
  }
  setInterval(watchComposePresence, 2000);

  if (P) {
    P.bindManualShortcut({
      platform: PLATFORM,
      fallbackText: readComposeText,
      fallbackDirection: 'outgoing',
      resolveDirection,
      getStatusLines: () => {
        const compose = findCompose();
        return [
          compose
            ? 'שורת הכתיבה זוהתה; הקלדה חדשה תיבדק אוטומטית אחרי הפסקה קצרה.'
            : 'שורת הכתיבה לא זוהתה; הבדיקה האוטומטית בזמן כתיבה אינה פעילה כעת.',
        ];
      },
    });
  }

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
