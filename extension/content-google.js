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

  // Gmail: only bodies inside a real opened-message container count. A
  // folder preview row (tr.zA / [role="row"]) is never a message.
  function gmailRows(root) {
    return S.all(root, MAP.messageBody)
      .filter((el) => S.gmailIsMessageBody(el))
      .map((el) => ({ el, text: S.extractText(el, MAP.messageText) }))
      .filter((r) => r.text && r.text.length >= MIN_CHARS);
  }

  // Chat (standalone or Gmail-embedded): bubbles are text-bearing leaves
  // inside a structurally-qualified conversation area. The text is cleaned
  // of leading time/date header lines.
  function chatRows(root) {
    const out = [];
    for (const area of S.googleChatArea(root)) {
      const wrapped = S.asRoot(area);
      for (const el of S.all(wrapped, S.googleChat.messageBubble)) {
        if (!el || el.children.length !== 0) continue; // text leaf, not a wrapper
        const raw = (el.innerText || el.textContent || '').trim();
        const text = S.cleanText(raw);
        if (text && text.length >= MIN_CHARS) out.push({ el, text });
      }
    }
    return out;
  }

  function findRows(root) {
    if (onChat) return chatRows(root);
    // Gmail page: opened-thread bodies AND the embedded Chat panel.
    return [...gmailRows(root), ...chatRows(root)];
  }

  const scanner = globalThis.LHG_INCOMING.createScanner({ platform: PLATFORM, findRows });
  scanner.scan(); // baseline: history present at load is marked seen, never sent

  if (globalThis.LHG_PANEL) {
    globalThis.LHG_PANEL.bindManualShortcut({
      platform: PLATFORM,
      direction: 'incoming',
      getStatusLines: () => {
        const rows = findRows(document);
        const inChat = !onChat && rows.some((r) => S.closestMatch(r.el, S.googleChat.area));
        return [
          rows.length
            ? 'התוסף פעיל ומזהה הודעות בעמוד. הודעות חדשות ייבדקו אוטומטית ויתווספו לידן תגיות.'
            : 'התוסף פעיל, אך כרגע לא זוהתה הודעת דוא״ל/צ׳אט פתוחה. פתח הודעה או שיחה ונסה שוב. מצב זה אינו מוצג כבדיקה תקינה.',
          inChat
            ? 'שיחת צ׳אט בתוך ג׳ימייל זוהתה; רק הודעות חדשות בשיחה ייבדקו, שורות תיקייה לא ייסרקו.'
            : 'לבדיקה ידנית: סמן את טקסט ההודעה בעמוד ולחץ על קיצור הפאנל (Ctrl+Shift+L).',
        ];
      },
    });
  }

  let t = null;
  const requestScan = () => {
    clearTimeout(t);
    t = setTimeout(() => scanner.scan(), 800);
  };
  new MutationObserver(requestScan).observe(document.body, { childList: true, subtree: true });
  setInterval(() => scanner.scan(), 15000);
})();
