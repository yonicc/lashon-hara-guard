// ALL DOM selectors for Lashon Hara Guard live in this one file.
// Loaded before every content script (manifest order). Platforms evolve, so
// every lookup tries a list of fallbacks and callers must handle "not found"
// explicitly (show "not recognized") instead of failing silently.
(() => {
  const S = (globalThis.LHG_SELECTORS = globalThis.LHG_SELECTORS || {});

  S.whatsapp = {
    // Compose box at the bottom of the open chat.
    compose: [
      'footer [contenteditable="true"]',
      'footer [role="textbox"]',
      '[data-tab="10"]',
      'footer div[contenteditable]',
    ],
    // Incoming messages: WhatsApp wraps each bubble in a row; incoming rows
    // carry message-in, outgoing message-out (legacy classes survive in
    // several current builds). Fallbacks degrade to "all bubbles" and the
    // caller then filters by the outgoing marker list below.
    incomingMessage: [
      '.message-in',
      '[class*="message-in"]',
    ],
    outgoingMessage: [
      '.message-out',
      '[class*="message-out"]',
    ],
    // Text node(s) inside a bubble. Empty = system/encryption notice (skip).
    messageText: ['.copyable-text', 'span.selectable-text', '[class*="copyable"]'],
    chatRoot: ['#main', 'main'],
    composeContainer: ['footer', '#pane-side'],
    // Context-DOM locators (checkpoint 2): locating only, extraction stays
    // in LHG_CONTEXT_DOM. Every list is fallbacks; unknown => null, never guess.
    conversationTitle: [
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header [data-testid="conversation-header-title"]',
      '#main header span[title]',
      // Current builds dropped most data-testid/title attributes: the chat
      // name is the first dir="auto" text span in the conversation header.
      // (A bare '#main header [title]' was removed: it can match an icon
      // button such as "Search", giving every chat the same key and mixing
      // their context.)
      '#main header span[dir="auto"]',
      '#main header div[role="button"] span',
    ],
    visibleParticipants: [
      '#main header [data-testid="conversation-info-header-chat-subtitle"]',
      '#main header span[title] + span',
      '#main header div span',
    ],
    messageBubble: [
      '[data-pre-plain-text]',
      '.message-in [data-pre-plain-text]',
      '.message-out [data-pre-plain-text]',
    ],
    authorPrePlain: ['[data-pre-plain-text]'],
    forwardedMark: [
      '[data-testid="forwarded-message"]',
      '[data-testid="forwarded-badge"]',
      '[aria-label*="Forwarded"]',
    ],
    quotedMark: [
      '[data-testid="quote-message"]',
      '[data-testid="quoted-message"]',
      '[class*="quoted"]',
    ],
  };

  S.googleChat = {
    // GROUPS/DMs (not single messages): a message in Google Chat — including
    // the Chat panel embedded in Gmail (mail.google.com) — lives inside a
    // c-wiz conversation container, NOT in a dedicated id'd stream root.
    // These are area candidates only; a candidate must satisfy
    // S.googleChatAreaOk (text bubbles + a compose box) before anything in it
    // is ever treated as a message, so a mail row or a directory list can
    // never be scanned as a conversation by these alone.
    area: ['c-wiz', 'div[jscontroller]'],
    // A rendered message bubble: text-bearing leaves inside jsname'd wrappers.
    messageBubble: ['[jsname]', 'c-wiz div', 'div[jsname]'],
    // Text body inside a bubble. 'span' alone is too broad (time/name chips
    // also match), so the caller walks up to the bubble and cleans the text.
    messageText: ['[data-msg-text]', '[jsname] span', '[jsname] div', 'span'],
    // Compose box of the open conversation. The data-placeholder fallback is
    // what separates a real compose box from any other contenteditable.
    compose: [
      '[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
    ],
  };

  // Structural test for a Google Chat conversation area (used with S.all on
  // S.googleChat.area). An area qualifies only if it actually looks like a
  // conversation: it has a compose box AND at least two text-bearing leaves.
  // Gmail folder rows (tr.zA / [role="row"]) are never inside such an area.
  S.googleChatArea = (root) => {
    const areas = [];
    for (const a of S.all(root, S.googleChat.area)) {
      if (!a || typeof a.querySelector !== 'function') continue;
      if (!S.first(a, S.googleChat.compose)) continue;
      const leaves = S.all(a, S.googleChat.messageBubble).filter(
        (el) => el.children.length === 0 && (el.innerText || el.textContent || '').trim().length >= 4,
      );
      if (leaves.length >= 2) areas.push(a);
    }
    return areas;
  };

  S.gmail = {
    // Reading pane of an opened conversation.
    thread: ['[role="main"] .a3s', '[role="main"]'],
    // One message body in the opened thread. Only treated as a message when
    // it lives inside a real message container (S.gmail.isMessageContainer):
    // a body in the folder LIST is a preview row (tr.zA), never a message.
    messageBody: [
      '.a3s.aiL',
      '.a3s',
      'div[data-message-id] .a3s',
      '[role="listitem"] .a3s',
    ],
    messageText: ['.a3s', 'div'],
    compose: ['.Am.Al.editable', 'div[role="textbox"][contenteditable="true"]'],
    // Folder list rows: previews, never messages.
    listRow: ['tr.zA', '[role="row"]', '.zA'],
  };

  // Guards: is this element part of an actually-open message (as opposed to a
  // folder preview row)? Used to keep Gmail list previews out of the scanner.
  // Gmail DOM fact (long-standing, .adn/.ads layout): an opened message's
  // body sits inside a message container with class "adn", not directly under
  // the thread row. The container must also not itself be a list row.
  S.gmailInListRow = (el) => !!S.closestMatch(el, S.gmail.listRow);
  S.gmailIsMessageBody = (el) => {
    if (!el || S.gmailInListRow(el)) return false;
    const container = S.closestMatch(el, ['.adn', 'div[data-message-id]', '[role="listitem"]']);
    if (!container || S.gmailInListRow(container)) return false;
    // A folder preview is a bare .a3s directly in the list table; an opened
    // message body is wrapped in the .adn message container above.
    return true;
  };

  function first(node, list) {
    if (!node) return null;
    for (const sel of list) {
      try {
        const el = node.querySelector(sel);
        if (el) return el;
      } catch (_e) {
        // invalid selector in this build: keep trying fallbacks
      }
    }
    return null;
  }

  function all(node, list) {
    if (!node) return [];
    const seen = new Set();
    const out = [];
    for (const sel of list) {
      let els;
      try {
        els = node.querySelectorAll(sel);
      } catch (_e) {
        continue;
      }
      for (const el of els) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }
    return out;
  }

  function closestMatch(el, list) {
    if (!el) return null;
    for (const sel of list) {
      try {
        const m = el.closest(sel);
        if (m) return m;
      } catch (_e) {
        // keep trying
      }
    }
    return null;
  }

  // Wrap an element in a fake root exposing querySelector(All) so callers can
  // run findRows against a chat area instead of the whole document.
  S.asRoot = (el) => ({
    node: el,
    querySelector: (sel) => (el && el.querySelector ? el.querySelector(sel) : null),
    querySelectorAll: (sel) => (el && el.querySelectorAll ? el.querySelectorAll(sel) : []),
  });

  S.first = first;
  S.all = all;
  S.closestMatch = closestMatch;

  // Text of a message bubble/row, or '' when it is not a text message
  // (image-only, reaction, system notice) — callers skip empties.
  S.extractText = (el, list) => {
    if (!el) return '';
    const t = first(el, list) || el;
    return (t.innerText || t.textContent || '').trim().replace(/ /g, ' ');
  };

  // Message chrome is never message text: the send-time stamp (a clock time,
  // a date, or a relative stamp such as "59 דקות" / "59 minutes ago") and the
  // chat header line "author + send-time" above the body. Conservative: a
  // line is dropped only when it is ONLY a time token, and a header line is
  // dropped only when a body line follows it. A time phrase inside a real
  // sentence (e.g. "חיכיתי 59 דקות ליד הדלת") is kept whole.
  const TIME_TOKEN_SRC = '(?:\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:[AP]M)?'
    + '|(?:לפני\\s+)?\\d+\\s*(?:דקות|דקה|שעות|שעה|שניות|שנייה|שניה|ימים|יום|שבועות|שבוע|חודשים|חודש)'
    + '|\\d+\\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?)(?:\\s+ago)?'
    + '|(?:an?|one)\\s+(?:minute|hour)\\s+ago|just\\s+now|לפני\\s+(?:דקה|שעה|יום|רגע)|עכשיו'
    + '|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|היום|אתמול|שלשום|יום\\s+\\S+)';
  const TIME_ONLY_RE = new RegExp('^\\s*' + TIME_TOKEN_SRC + '(?:\\s*[,·•]\\s*' + TIME_TOKEN_SRC + ')?\\s*$', 'iu');
  const HEADER_RE = new RegExp("^\\s*[\\p{L}][\\p{L}.'’-]*(?:\\s+[\\p{L}][\\p{L}.'’-]*){0,2}\\s*[•·,-]?\\s*" + TIME_TOKEN_SRC + '\\s*$', 'iu');

  // True when the whole text is only a send-time stamp (e.g. "59 דקות").
  S.isTimeOnly = (text) => TIME_ONLY_RE.test(String(text || ''));
  // True when a single line is only an author header ending in a send-time
  // stamp (e.g. "יעקב שוהם 59 דקות"): chrome, never a message on its own.
  S.isMessageHeader = (text) => {
    const t = String(text || '').trim();
    return !!t && !t.includes('\n') && HEADER_RE.test(t);
  };

  // Strip time/date header lines from extracted bubble text, so the checked
  // text is the message body rather than its chrome.
  S.cleanText = (text) => {
    const lines = String(text || '').split('\n');
    while (lines.length && TIME_ONLY_RE.test(lines[0])) lines.shift();
    while (lines.length && TIME_ONLY_RE.test(lines[lines.length - 1])) lines.pop();
    if (lines.length > 1 && HEADER_RE.test(lines[0])) {
      lines.shift();
      while (lines.length && TIME_ONLY_RE.test(lines[0])) lines.shift();
    }
    return lines.join('\n').trim();
  };

  // Weak stable-ish id for DOM rows without real ids: platform + hash of text.
  // Used only for de-duplication within this page lifetime; never persisted.
  S.weakId = (platform, el, text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return platform + ':' + h.toString(36) + ':' + text.length;
  };
})();
