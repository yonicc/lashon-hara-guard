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
  const PLATFORM = onChat ? 'google-chat' : 'gmail';
  const MIN_CHARS = 6;
  const IS_TOP = window.top === window;
  const t = (k, v) => (globalThis.LHG_I18N ? globalThis.LHG_I18N.t(k, v) : k);
  // On/off switches (settings.js), asked before every watcher action. The
  // Gmail top frame (mail + embedded Chat panel rows) follows "gmail"; a
  // chat.google.com frame (standalone or inside Gmail) follows "google-chat".
  const active = (p = PLATFORM) => !globalThis.LHG_SETTINGS || globalThis.LHG_SETTINGS.isActive(p);

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
      composeBox: (el) => (active('google-chat') ? chatComposeBox(el) : null),
      findCompose: findChatCompose,
    });
  }

  // Outgoing check of an e-mail DRAFT (new message, reply, forward) in the
  // Gmail mailbox frame. Previously the only watcher was the Chat one, and
  // it explicitly rejects Gmail's compose body, so drafts were never checked
  // (bug 2026-10-27). E-mails are longer and typed in bursts: a longer pause.
  // The quoted history and signature under a reply are not the user's text.
  function gmailComposeBox(el) {
    if (!el || !el.isContentEditable) return null;
    const box = S.closestMatch(el, S.gmail.compose);
    if (!box || !S.gmailIsDraftBox(box)) return null;
    if (chatFrame && chatComposeBox(el)) return null; // a Chat box is the Chat watcher's
    return box;
  }
  function findGmailCompose() {
    const boxes = S.all(document, S.gmail.compose).map(gmailComposeBox).filter(Boolean);
    const active = document.activeElement;
    return boxes.find((b) => active && (b === active || (b.contains && b.contains(active)))) || boxes[0] || null;
  }
  const gmailDraftText = (box) => S.textWithout(box, S.gmail.quotedPart);
  let mailCompose = null;
  if (onMailHost && IS_TOP && globalThis.LHG_COMPOSE) {
    mailCompose = globalThis.LHG_COMPOSE.createComposeWatcher({
      platform: 'gmail',
      composeBox: (el) => (active('gmail') ? gmailComposeBox(el) : null),
      findCompose: findGmailCompose,
      textOf: gmailDraftText,
      sendAction: (e) => {
        if (!active('gmail')) return null;
        const shortcut = e.type === 'keydown' && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing;
        const button = e.type === 'click'
          ? S.closestMatch(e.target, S.gmail.sendButton)
          : null;
        if (!shortcut && !button) return null;
        const root = (button || e.target)?.closest?.('[role="dialog"], .M9, .ip');
        const box = shortcut ? gmailComposeBox(e.target) : root?.querySelector('[contenteditable="true"][role="textbox"]');
        if (!box || !gmailComposeBox(box)) return null;
        const sendButton = button || (root && S.first(root, S.gmail.sendButton));
        if (!sendButton) return null;
        return { box, button: sendButton, send: () => sendButton.click(), ready: async () => {
          const deadline = Date.now() + 2100;
          while (expandCollapsedGmail() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        } };
      },
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
  // The text is the WHOLE body minus quoted history/signature. It used to be
  // the body's first <div> (messageText ['.a3s', 'div']), which in many
  // mails is an empty spacer or only the first line, so the row was dropped
  // as "too short" and opened mail looked undetected (bug 2026-10-27).
  // Nested matches (.a3s inside .a3s.aiL) keep only the outermost body.
  // The sender comes from the message header next to the body (local-only,
  // anonymised to a ref by the builder before POST /check). A collapsed
  // ("..."/trimmed) older message with no body in the DOM still counts:
  // content-google.js expands it on open before the scanner checks it.
  function gmailSenderOf(body) {
    try {
      const container = S.closestMatch(body, S.gmail.messageContainer);
      const sender = container && S.first(container, S.gmail.messageSender);
      if (!sender) return '';
      const v = sender.getAttribute('name') || sender.getAttribute('email')
        || sender.getAttribute('data-hovercard-id') || sender.textContent || '';
      return String(v).replace(/\s+/g, ' ').trim().slice(0, 80);
    } catch (_) {
      return '';
    }
  }
  function gmailRows(root) {
    const bodies = S.all(root, S.gmail.messageBody).filter((el) => S.gmailIsMessageBody(el));
    return bodies
      .filter((el) => !bodies.some((o) => o !== el && o.contains && o.contains(el)))
      // Opened mail participates in the same hold policy as chat.
      .map((el) => ({ el, text: S.textWithout(el, S.gmail.quotedPart), sender: gmailSenderOf(el), kind: 'email' }))
      .filter((r) => {
        if (r.text && r.text.length >= MIN_CHARS) return true;
        r.el.setAttribute('data-lhg-scanned', 'true'); // existing short-text policy: no remote check
        return false;
      });
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
        // The user's own bubble is never an incoming row (bug 2026-10-27:
        // a message just sent reappeared, held, as "incoming"). Tested on the
        // leaf, before textRunRoot widens it.
        if (S.isOutgoing(el)) continue;
        const target = I.textRunRoot ? I.textRunRoot(el) : el;
        if (taken.has(target)) continue;
        taken.add(target);
        if (I.isEditable && I.isEditable(target)) continue;
        if (target !== el && S.isOutgoing(target)) continue;
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
        // Gmail senders come from the message header (content-google.js),
        // not from a chat bubble: attach() finds no bubble author there.
        if (!localContext && row.sender) localContext = { authorDisplayName: row.sender };
        return localContext ? { ...row, localContext } : row;
      });
    } catch (_e) {
      return rows;
    }
  }

  const scanner = globalThis.LHG_INCOMING.createScanner({
    platform: PLATFORM,
    findRows: (root) => decorateRows(findRows(root)),
    beforeScan: () => !expandCollapsedGmail(),
  });
  if (globalThis.LHG_PANEL) {
    globalThis.LHG_PANEL.bindManualShortcut({
      platform: PLATFORM,
      direction: 'incoming',
      getStatusLines: () => {
        const rows = findRows(document);
        const inChat = !onChat && rows.some((r) => S.closestMatch(r.el, S.googleChat.area));
        const lines = [
          rows.length ? t('g.rows') : t('g.noRows'),
          inChat ? t('g.inChat') : t('g.manual'),
        ];
        if (chatFrame) {
          lines.push(findChatCompose() ? t('g.compose') : t('g.noCompose'));
          const ids = new Set(Array.from(document.querySelectorAll('[data-group-id], [data-space-id]'),
            (n) => n.getAttribute('data-group-id') || n.getAttribute('data-space-id')));
          lines.push(ids.size === 1 ? t('g.convId') : t('g.noConvId', { n: ids.size }));
        } else {
          const frames = chatIframes().filter((f) => f.visible).length;
          if (frames) lines.push(t('g.frames', { n: frames }));
        }
        return lines;
      },
      fallbackText: () => (compose && compose.readText()) || (mailCompose && mailCompose.readText()) || '',
      fallbackDirection: 'outgoing',
      resolveDirection: (node) => ((chatComposeBox(node) || gmailComposeBox(node) || S.isOutgoing(node)) ? 'outgoing' : 'incoming'),
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
      // Gmail e-mail detection (structure only): body candidates vs. accepted
      // opened bodies, list rows, and the draft box the draft watcher sees.
      gmail: onMailHost && IS_TOP ? {
        bodyMatches: S.gmail.messageBody.map((sel) => [sel, count(sel)]),
        openBodies: S.all(document, S.gmail.messageBody).filter((el) => S.gmailIsMessageBody(el)).length,
        listRows: count(S.gmail.listRow.join(',')),
        containers: S.gmail.messageContainer.map((sel) => [sel, count(sel)]),
        composeMatches: S.gmail.compose.map((sel) => [sel, count(sel)]),
        draftBox: describe(findGmailCompose()),
      } : null,
      // Direction: own-message markers seen (counts only).
      outgoingMarkers: S.outgoing.marker.map((sel) => [sel, count(sel)]),
      idAttrs: Object.fromEntries(['data-group-id', 'data-space-id', 'data-topic-id', 'data-message-id', 'data-member-id', 'data-thread-id', 'data-id']
        .map((a) => [a, count('[' + a + ']')])),
      groupIdKinds: Array.from(new Set(Array.from(document.querySelectorAll('[data-group-id]'),
        (n) => (n.getAttribute('data-group-id') || '').split('/')[0]))).slice(0, 5),
      contentEditables: Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 5).map(describe),
      iframes: IS_TOP ? chatIframes() : null,
    };
  }

  // Collapsed ("..."/trimmed) older messages have no body in the DOM, so
  // they can never seed thread context. Expand each collapsed node ONCE
  // (a programmatic click on the expand handle, never on a draft/send
  // button): Gmail then renders the body and the MutationObserver scan
  // picks it up as baseline history. Bounded: at most 5 unexpanded nodes
  // per call, tracked in a WeakSet so a failed expand is never retried.
  const expandedCollapsed = new WeakSet();
  const expansionStarted = new WeakMap();
  function expandCollapsedGmail() {
    if (!onMailHost || !IS_TOP) return;
    let waiting = false;
    try {
      const S2 = globalThis.LHG_SELECTORS;
      if (!S2 || !S2.gmail || typeof S2.all !== 'function') return;
      const root = S2.first(document, S2.gmail.threadRoot) || document;
      let n = 0;
      for (const handle of S2.all(root, S2.gmail.expandHandle)) {
        if (n >= 5) break;
        if (!handle) continue;
        if (handle.closest && handle.closest('[role="dialog"], form')) continue; // never inside compose
        let container = null;
        try { container = S2.closestMatch(handle, S2.gmail.messageContainer); } catch (_) { container = null; }
        if (!container) continue;
        let body = null;
        try { body = S2.first(container, S2.gmail.messageBody); } catch (_) { body = null; }
        if (body) continue; // already expanded
        if (expandedCollapsed.has(handle)) {
          if (Date.now() - expansionStarted.get(handle) < 2000) waiting = true;
          continue;
        }
        try {
          expandedCollapsed.add(handle);
          expansionStarted.set(handle, Date.now());
          if (typeof handle.click === 'function') handle.click();
          waiting = true;
          n++;
        } catch (_) { /* one failed expand never breaks the scan */ }
      }
    } catch (_) { /* never breaks the scan */ }
    return waiting;
  }

  // Frame-synchronised scan: a new chat message is held before it is painted.
  const origScan = scanner.scan.bind(scanner);
  let expansionTimer;
  scanner.scan = () => {
    if (expandCollapsedGmail()) {
      clearTimeout(expansionTimer);
      expansionTimer = setTimeout(() => scanner.scan(), 50);
      return;
    }
    return origScan();
  };
  scanner.scan(); // baseline: history present at load is marked seen, never sent
  globalThis.LHG_INCOMING.observe(scanner);
})();
