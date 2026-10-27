// WhatsApp Web adapter (MVP): watches the compose box (outgoing, non-blocking
// reminder) and newly arriving incoming messages (direction=incoming, subtle
// tag next to the bubble). Sending is never blocked and nothing is ever
// rewritten automatically. All selectors come from selectors.js.
(() => {
  const S = globalThis.LHG_SELECTORS;
  const PLATFORM = 'whatsapp-web';
  const COMPOSE_WATCH_MS = 4000;

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

  const show = (kind, title, lines) => P && P.show(kind, title, lines);

  function readComposeText() {
    const box = findCompose();
    return box ? (box.innerText || '').trim() : '';
  }

  // What the extension can currently see of the open conversation. Shown in
  // the manual panel so "nothing detected" is visible instead of silent.
  function conversationInfo() {
    const root = S ? S.first(document, S.whatsapp.chatRoot) : null;
    const titleEl = S ? S.first(document, S.whatsapp.conversationTitle) : null;
    const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
    return {
      chatOpen: !!root,
      title,
      incoming: root ? S.all(root, S.whatsapp.incomingMessage).length : 0,
      outgoing: root ? S.all(root, S.whatsapp.outgoingMessage).length : 0,
      bubbles: root ? S.all(root, S.whatsapp.messageBubble).length : 0,
    };
  }

  function statusLines() {
    const c = conversationInfo();
    const lines = [];
    if (!c.chatOpen) {
      lines.push('לא זוהתה שיחה פתוחה. פתח שיחה ונסה שוב.');
    } else if (!c.title) {
      lines.push('יש שיחה פתוחה, אבל שם השיחה לא זוהה, ולכן הקשר השיחה לא נאסף.');
    } else {
      lines.push('שיחה פתוחה: ״' + c.title.slice(0, 40) + '״ (הקשר שיחה פעיל)');
    }
    if (c.chatOpen) {
      lines.push('הודעות גלויות שזוהו: ' + c.incoming + ' נכנסות, ' + c.outgoing + ' יוצאות, ' +
        c.bubbles + ' עם פרטי שולח.');
    }
    lines.push(findCompose()
      ? 'שורת הכתיבה זוהתה; הקלדה חדשה תיבדק אוטומטית אחרי הפסקה קצרה.'
      : 'שורת הכתיבה לא זוהתה; הבדיקה האוטומטית בזמן כתיבה אינה פעילה כעת.');
    return lines;
  }

  // Structure only: tag names, attribute NAMES, counts and text LENGTHS.
  // Never message text, names or titles.
  function diagnostics() {
    const describe = (el) => el ? {
      tag: el.tagName.toLowerCase(),
      attrs: Array.from(el.attributes).map((a) => a.name).filter((n) => n !== 'class').slice(0, 15),
      role: el.getAttribute('role'), dir: el.getAttribute('dir'),
      classes: el.classList.length, children: el.children.length, textLen: (el.textContent || '').length,
    } : null;
    const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_e) { return -1; } };
    const matches = {};
    for (const [k, list] of Object.entries((S && S.whatsapp) || {})) {
      if (Array.isArray(list)) matches[k] = list.map((sel) => [sel, count(sel)]);
    }
    const header = document.querySelector('#main header') || document.querySelector('header');
    return {
      version: chrome.runtime.getManifest().version,
      host: location.host,
      matches,
      header: describe(header),
      headerSpans: header ? Array.from(header.querySelectorAll('span, div[role]')).slice(0, 20).map(describe) : null,
      main: describe(document.querySelector('#main')),
      rows: count('#main [role="row"]'),
      rowSample: describe(document.querySelector('#main [role="row"]')),
      rowSampleChildren: Array.from((document.querySelector('#main [role="row"]') || { children: [] }).children).slice(0, 5).map(describe),
      prePlain: count('[data-pre-plain-text]'),
      contentEditables: Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 5).map((el) => ({
        ...describe(el), inFooter: !!el.closest('footer'), inMain: !!el.closest('#main'),
      })),
    };
  }

  function resolveDirection(node) {
    if (node && node.closest) {
      if (node.closest(S ? S.whatsapp.compose.join(',') : 'footer [contenteditable="true"]')) return 'outgoing';
      if (node.closest('.message-out, [class*="message-out"]')) return 'outgoing';
      if (node.closest('.message-in, [class*="message-in"]')) return 'incoming';
    }
    return 'incoming';
  }

  // Outgoing check while typing: shared watcher (compose-watch.js).
  if (globalThis.LHG_COMPOSE) {
    globalThis.LHG_COMPOSE.createComposeWatcher({ platform: PLATFORM, composeBox, findCompose });
  }

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
      getStatusLines: statusLines,
      getDiagnostics: diagnostics,
    });
  }

  // --- incoming messages ---------------------------------------------------
  if (S && globalThis.LHG_INCOMING) {
    const scanner = globalThis.LHG_INCOMING.createScanner({
      platform: PLATFORM,
      findRows: (root) => {
        const rows = S.all(root, S.whatsapp.incomingMessage);
        const mapped = rows
          .map((el) => ({ el, text: S.cleanText(S.extractText(el, S.whatsapp.messageText)) }))
          .filter((r) => r.text && !(S.isMessageHeader && S.isMessageHeader(r.text)));
        // Local-only context (checkpoint 3b): attach per-bubble, guarded.
        // Names stay in-page; the queue still sends { text } only.
        try {
          const api = globalThis.LHG_LOCAL_CONTEXT;
          if (api && typeof api.attach === 'function') {
            return mapped.map((row) => {
              let localContext = null;
              try { localContext = api.attach(row.el); } catch (_e) { localContext = null; }
              return localContext ? { ...row, localContext } : row;
            });
          }
        } catch (_e) { /* fall through without localContext */ }
        return mapped;
      },
    });
    scanner.scan(); // baseline only: history is marked seen, never sent
    // Frame-synchronised scan: a new message is held before it is painted.
    globalThis.LHG_INCOMING.observe(scanner);
  }
})();
