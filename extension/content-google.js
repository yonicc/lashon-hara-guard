// Google adapter (MVP, incoming only): Google Chat — standalone
// (chat.google.com) AND the Chat panel embedded in Gmail (mail.google.com) —
// plus opened Gmail threads. The previous build only looked for an opened
// Gmail thread (".a3s" bodies under [role="main"]), so on a folder-list view
// with the embedded Chat panel open it found nothing and reported "no open
// message". Now:
//   - An opened Gmail thread is detected structurally (message container,
//     never a folder preview row).
//   - A Chat conversation is detected by AREA (compose box + text bubbles),
//     never by folder rows or mail previews.
// Newly arriving messages get a subtle tag; history present at load is only a
// baseline and is never sent. Nothing is blocked or rewritten.
(() => {
  const S = globalThis.LHG_SELECTORS;
  if (!S || !globalThis.LHG_INCOMING) return;

  const onChat = location.hostname === 'chat.google.com';
  const MAP = onChat ? S.googleChat : S.gmail;
  const PLATFORM = onChat ? 'google-chat' : 'gmail';
  const MIN_CHARS = 6;
  const IS_TOP = window.top === window;

  // Gmail renders its Chat windows (the floating DM popups and the Chat
  // panel) inside IFRAMES. The manifest injects this script into every frame
  // (all_frames); a sub-frame is a chat frame, the top frame is the mailbox.
  const chatFrame = onChat || !IS_TOP || /^\/chat\//.test(location.pathname);

  // Gmail's own e-mail compose must never be treated as a chat compose box:
  // e-mail drafts are not sent to the checker while typing.
  // Only on mail.google.com: the Chat compose box (chat.google.com frame) ALSO
  // carries g_editable / aria-multiline (diagnostics from BI, 2026-10-27), so
  // applying this filter there rejected the real chat compose box.
  const onMailHost = location.hostname === 'mail.google.com';
  const MAIL_COMPOSE = ['.Am.Al.editable', '[g_editable="true"]', '.editable[aria-multiline="true"]'];
  function chatComposeBox(el) {
    if (!el || !el.isContentEditable) return null;
    const box = S.closestMatch(el, S.googleChat.compose);
    if (!box) return null;
    if (onMailHost && S.closestMatch(box, MAIL_COMPOSE)) return null;
    return box;
  }
  function findChatCompose() {
    for (const el of S.all(document, S.googleChat.compose)) {
      const box = chatComposeBox(el);
      if (box) return box;
    }
    return null;
  }

  // Outgoing check while typing in a Chat conversation (shared watcher).
  let compose = null;
  if (chatFrame && globalThis.LHG_COMPOSE) {
    compose = globalThis.LHG_COMPOSE.createComposeWatcher({
      platform: 'google-chat',
      composeBox: chatComposeBox,
      findCompose: findChatCompose,
    });
  }

  // Chat frames embedded in the Gmail top frame (origin + path only, no query).
  function chatIframes() {
    return Array.from(document.querySelectorAll('iframe')).map((f) => {
      try {
        const u = new URL(f.src || 'about:blank', location.href);
        return { src: u.origin + u.pathname, visible: f.offsetWidth > 0 && f.offsetHeight > 0 };
      } catch (_e) {
        return { src: '?', visible: false };
      }
    }).filter((f) => /chat|frame|mole|dynamite/i.test(f.src));
  }

  // Gmail: only bodies inside a real opened-message container count. A
  // folder preview row (tr.zA / [role="row"]) is never a message.
  function gmailRows(root) {
    return S.all(root, MAP.messageBody)
      .filter((el) => S.gmailIsMessageBody(el))
      // kind 'email': opened mail is tagged, never held (hold is for chat).
      .map((el) => ({ el, text: S.extractText(el, MAP.messageText), kind: 'email' }))
      .filter((r) => r.text && r.text.length >= MIN_CHARS);
  }

  // Chat (standalone or Gmail-embedded): bubbles are text-bearing leaves
  // inside a structurally-qualified conversation area, widened to the whole
  // run of message text around them (LHG_INCOMING.textRunRoot), so a message
  // with a link, a mention or a line break is held as ONE element. Holding
  // only the leaf left the rest of the text visible under the placeholder
  // (0.7.1). Our own placeholder/tag text is never part of the message text.
  // The text is cleaned of leading time/date header lines.
  function chatRows(root) {
    const I = globalThis.LHG_INCOMING;
    const out = [];
    const taken = new Set();
    for (const area of S.googleChatArea(root)) {
      const wrapped = S.asRoot(area);
      for (const el of S.all(wrapped, S.googleChat.messageBubble)) {
        if (!el || el.closest('.lhg-hold, .lhg-tag')) continue; // our own UI
        const own = Array.from(el.children).filter((c) => !c.matches('.lhg-hold, .lhg-tag'));
        const directText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && /\S/.test(c.nodeValue || ''));
        if (own.length !== 0 && !directText) continue; // a wrapper, not text
        if (I.isEditable && I.isEditable(el)) continue; // own draft
        const target = I.textRunRoot ? I.textRunRoot(el) : el;
        if (taken.has(target)) continue;
        taken.add(target);
        if (I.isEditable && I.isEditable(target)) continue;
        const raw = (I.textOf ? I.textOf(target) : (target.innerText || target.textContent || '')).trim();
        const text = S.cleanText(raw);
        // An author + send-time header run (e.g. "יעקב שוהם 59 דקות") is
        // chrome above the body, never a message: do not sample it.
        if (S.isMessageHeader && S.isMessageHeader(text)) continue;
        if (text && text.length >= MIN_CHARS) out.push({ el: target, text });
      }
    }
    return out;
  }

  function findRows(root) {
    if (onChat) return chatRows(root);
    // Gmail page: opened-thread bodies AND the embedded Chat panel.
    return [...gmailRows(root), ...chatRows(root)];
  }

  // Local-only context (checkpoint 3b): attach per-bubble metadata without
  // touching the POST /check contract. Rows carry localContext only in-page;
  // the scanner queue sends { text } alone, names never leave the browser.
  function decorateRows(rows) {
    try {
      const api = globalThis.LHG_LOCAL_CONTEXT;
      if (!api || typeof api.attach !== 'function') return rows;
      return rows.map((row) => {
        let localContext = null;
        try { localContext = api.attach(row.el); } catch (_e) { localContext = null; }
        return localContext ? { ...row, localContext } : row;
      });
    } catch (_e) {
      return rows;
    }
  }

  const scanner = globalThis.LHG_INCOMING.createScanner({
    platform: PLATFORM,
    findRows: (root) => decorateRows(findRows(root)),
  });
  scanner.scan(); // baseline: history present at load is marked seen, never sent

  if (globalThis.LHG_PANEL) {
    globalThis.LHG_PANEL.bindManualShortcut({
      platform: PLATFORM,
      direction: 'incoming',
      getStatusLines: () => {
        const rows = findRows(document);
        const inChat = !onChat && rows.some((r) => S.closestMatch(r.el, S.googleChat.area));
        const lines = [
          rows.length
            ? 'התוסף פעיל ומזהה הודעות בעמוד. הודעות חדשות ייבדקו אוטומטית ויתווספו לידן תגיות.'
            : 'התוסף פעיל, אך כרגע לא זוהתה הודעת דוא״ל/צ׳אט פתוחה. פתח הודעה או שיחה ונסה שוב. מצב זה אינו מוצג כבדיקה תקינה.',
          inChat
            ? 'שיחת צ׳אט בתוך ג׳ימייל זוהתה; רק הודעות חדשות בשיחה ייבדקו, שורות תיקייה לא ייסרקו.'
            : 'לבדיקה ידנית: סמן את טקסט ההודעה בעמוד ולחץ על קיצור הפאנל (Ctrl+Shift+L).',
        ];
        if (chatFrame) {
          lines.push(findChatCompose()
            ? 'שורת הכתיבה של הצ׳אט זוהתה; הקלדה תיבדק אוטומטית אחרי הפסקה קצרה.'
            : 'שורת הכתיבה של הצ׳אט לא זוהתה; הבדיקה בזמן כתיבה אינה פעילה כעת.');
          const ids = new Set(Array.from(document.querySelectorAll('[data-group-id], [data-space-id]'),
            (n) => n.getAttribute('data-group-id') || n.getAttribute('data-space-id')));
          lines.push(ids.size === 1
            ? 'מזהה השיחה זוהה: הקשר השיחה (הודעות קודמות, משתתפים) נאסף מקומית ונשלח מוסתר.'
            : 'מזהה השיחה לא זוהה (' + ids.size + ' מועמדים), ולכן כל הודעה נבדקת לבדה, בלי הקשר השיחה.');
        } else {
          const frames = chatIframes().filter((f) => f.visible).length;
          if (frames) {
            lines.push('חלונות צ׳אט פתוחים בעמוד: ' + frames +
              '. הם נטענים במסגרת נפרדת — כדי לראות את מצב השיחה, לחץ בתוך חלון הצ׳אט ואז על קיצור הפאנל.');
          }
        }
        return lines;
      },
      fallbackText: () => (compose ? compose.readText() : ''),
      fallbackDirection: 'outgoing',
      resolveDirection: (node) => (chatComposeBox(node) ? 'outgoing' : 'incoming'),
      getDiagnostics: diagnostics,
    });
  }

  // Structure only: tag/attribute NAMES, counts, text LENGTHS. Never text,
  // names or titles. Pasted to a developer when Chat is not recognised.
  function diagnostics() {
    const describe = (el) => el ? {
      tag: el.tagName.toLowerCase(),
      attrs: Array.from(el.attributes).map((a) => a.name).filter((n) => n !== 'class').slice(0, 15),
      role: el.getAttribute('role'), classes: el.classList.length,
      children: el.children.length, textLen: (el.textContent || '').length,
    } : null;
    const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_e) { return -1; } };
    const matches = {};
    for (const [k, list] of Object.entries(S.googleChat)) {
      if (Array.isArray(list)) matches[k] = list.map((sel) => [sel, count(sel)]);
    }
    return {
      version: chrome.runtime.getManifest().version,
      host: location.host, path: location.pathname.split('/').slice(0, 3).join('/'),
      top: IS_TOP, chatFrame,
      matches,
      areas: S.googleChatArea(document).length,
      rows: findRows(document).length,
      chatCompose: describe(findChatCompose()),
      idAttrs: Object.fromEntries(['data-group-id', 'data-space-id', 'data-topic-id', 'data-message-id', 'data-member-id', 'data-thread-id', 'data-id']
        .map((a) => [a, count('[' + a + ']')])),
      groupIdKinds: Array.from(new Set(Array.from(document.querySelectorAll('[data-group-id]'),
        (n) => (n.getAttribute('data-group-id') || '').split('/')[0]))).slice(0, 5),
      contentEditables: Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 5).map(describe),
      iframes: IS_TOP ? chatIframes() : null,
    };
  }

  // Frame-synchronised scan: a new chat message is held before it is painted.
  globalThis.LHG_INCOMING.observe(scanner);
})();
