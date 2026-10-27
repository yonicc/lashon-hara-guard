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
      '[data-legacy-message-id] .a3s',
      '.ii.gt .a3s',
      '[role="listitem"] .a3s',
    ],
    // Quoted history / signature inside a body or a draft: never the text
    // of THIS message (dropped only when something else remains).
    quotedPart: ['.gmail_quote', 'blockquote', '.gmail_signature', '.im'],
    // Containers that prove a body belongs to an opened message.
    messageContainer: ['.adn', 'div[data-message-id]', '[data-legacy-message-id]', '.ii.gt', '[role="listitem"]'],
    // E-mail compose body (new message, reply, forward).
    compose: ['.Am.Al.editable', '[g_editable="true"]', 'div[role="textbox"][contenteditable="true"]'],
    // Gmail-only compose body classes: enough on their own.
    composeStrong: ['.Am.Al.editable'],
    // A generic textbox counts only inside a compose window / inline reply.
    composeWindow: ['[role="dialog"]', '.M9', '.AD', '.aoP', '.iN', '.ip.adB', '.gA', 'form'],
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
    // Never a draft being written (the compose body is not a received mail).
    if (el.isContentEditable || S.closestMatch(el, S.gmail.composeStrong)) return false;
    const container = S.closestMatch(el, S.gmail.messageContainer);
    if (!container || S.gmailInListRow(container)) return false;
    // A folder preview is a bare .a3s directly in the list table; an opened
    // message body is wrapped in the .adn message container above.
    return true;
  };

  // Is this contenteditable an e-mail draft body (not a Chat compose box,
  // not a search field)? Strong Gmail classes count alone; a generic
  // role=textbox / g_editable box only inside a compose window.
  S.gmailIsDraftBox = (el) => {
    if (!el || !el.isContentEditable) return false;
    if (S.closestMatch(el, S.gmail.composeStrong)) return true;
    if (!S.closestMatch(el, S.gmail.compose)) return false;
    return !!S.closestMatch(el, S.gmail.composeWindow);
  };

  // --- direction: is a rendered bubble the user's OWN message? -------------
  // Root cause of "my message shows up as incoming" (2026-10-27): Google
  // Chat rows were every text leaf with no direction test, so the bubble the
  // user had just sent was scanned (and held) as an incoming message.
  // Evidence, any one is enough (never a guess from layout or position):
  //   - an explicit marker on the bubble or an ancestor (WhatsApp
  //     message-out, data-is-self and friends);
  //   - an aria-label / sender name on the bubble's ancestors that names the
  //     user ("You", "את/ה", "Sent by you");
  //   - the local context says the author is the user (isSelf).
  S.outgoing = {
    marker: [
      '.message-out',
      '[class*="message-out"]',
      '[data-is-self="true"]',
      '[data-self="true"]',
      '[data-is-own="true"]',
      '[data-is-outgoing="true"]',
      '[data-outgoing="true"]',
      '[data-from-self="true"]',
    ],
    // The incoming twin: stops the ancestor climb (a row that says "in").
    incomingMarker: ['.message-in', '[data-is-self="false"]', '[data-outgoing="false"]'],
    // Sender-name chips inside a bubble/row.
    sender: ['[data-sender-name]', '[data-name]', '[data-hovercard-id]', '[data-member-id]'],
  };
  const SELF_NAME_RE = /^\s*(?:you|me|אתה|את|את\/ה|אתם|אני)\s*$/iu;
  // A label that STARTS with the self pronoun must be followed by ':' / ','
  // or end there ("את" alone is also a common Hebrew particle).
  const SELF_LABEL_RE = /(?:^\s*(?:you|me|אתה|את|את\/ה|אני)\s*(?:[:,]|$)|\b(?:sent by you|you sent|you said|your message)\b|נשלחה?\s+על[\s-]+ידך|ההודעה\s+שלך|(?:^|\s)שלחת(?=[\s:,]|$))/iu;
  S.isSelfName = (name) => SELF_NAME_RE.test(String(name || ''));
  S.isSelfContext = (lc) => !!(lc && (lc.isSelf === true || S.isSelfName(lc.authorDisplayName)));
  // opts: { localContext?, maxDepth? (default 8) }
  S.isOutgoing = (el, opts = {}) => {
    try {
      if (!el) return false;
      if (S.isSelfContext(opts.localContext)) return true;
      if (!el.closest) return false;
      if (closestMatch(el, S.outgoing.marker)) return true;
      const depth = opts.maxDepth || 8;
      let cur = el;
      for (let i = 0; cur && i < depth; i++, cur = cur.parentElement) {
        if (cur.tagName === 'BODY') break;
        let label = '';
        try { label = cur.getAttribute('aria-label') || ''; } catch (_e) { label = ''; }
        if (label && SELF_LABEL_RE.test(label)) return true;
        let selfAttr = null;
        try { selfAttr = cur.getAttribute('data-sender-name') || cur.getAttribute('data-name'); } catch (_e) { selfAttr = null; }
        if (selfAttr && S.isSelfName(selfAttr)) return true;
        // A sender chip that names the user ("You") directly inside this
        // ancestor (Google Chat shows the author above the first bubble).
        if (i > 0 && cur.children) {
          for (const c of Array.from(cur.children)) {
            if (c === el || (c.contains && c.contains(el))) continue;
            let isSender = false;
            try { isSender = !!(c.matches && c.matches(S.outgoing.sender.join(','))); } catch (_e) { isSender = false; }
            if (isSender && S.isSelfName(c.textContent)) return true;
          }
        }
        // An explicit incoming row ends the search: its ancestors belong to
        // the whole conversation, not to this message.
        let inRow = false;
        try { inRow = !!(cur.matches && cur.matches(S.outgoing.incomingMarker.join(','))); } catch (_e) { inRow = false; }
        if (inRow) return false;
        if (cur.tagName === 'C-WIZ') break;
      }
    } catch (_e) {
      return false;
    }
    return false;
  };

  // Text of an element WITHOUT the parts listed in `skip` (quoted history,
  // signature) and without our own tag/placeholder; <br> and block elements
  // become line breaks. Falls back to the full text when skipping would leave
  // nothing (a body that is ONLY a forwarded quote is still a message).
  S.textWithout = (el, skip = []) => {
    if (!el) return '';
    const BLOCK = /^(?:DIV|P|LI|TR|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE)$/;
    const walk = (n, skipping) => {
      let out = '';
      for (const c of Array.from(n.childNodes || [])) {
        if (c.nodeType === 3) { out += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        if (c.classList && (c.classList.contains('lhg-hold') || c.classList.contains('lhg-tag'))) continue;
        if (c.tagName === 'BR') { out += '\n'; continue; }
        let skipIt = false;
        if (skipping) {
          for (const s of skip) { try { if (c.matches(s)) { skipIt = true; break; } } catch (_e) { /* keep */ } }
        }
        if (skipIt) continue;
        const inner = walk(c, skipping);
        if (BLOCK.test(c.tagName) && out && !out.endsWith('\n')) out += '\n';
        out += inner;
        if (BLOCK.test(c.tagName) && inner && !out.endsWith('\n')) out += '\n';
      }
      return out;
    };
    const norm = (t) => t.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const own = norm(walk(el, true));
    return own || norm(walk(el, false));
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
