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
  };

  S.googleChat = {
    // The message stream of the open conversation/space (main pane).
    messageList: ['[role="main"]', 'c-wiz [jsname]', 'main'],
    // A rendered message row inside the stream.
    messageRow: [
      '[data-msg-id]',
      '[jsname][data-mid]',
      'c-wiz [role="listitem"]',
      '[role="list"] [role="listitem"]',
    ],
    // Text body within a row.
    messageText: ['[data-msg-text]', 'span', 'div'],
    // Compose box of the open conversation.
    compose: [
      '[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
    ],
  };

  S.gmail = {
    // Reading pane of an opened conversation.
    thread: ['[role="main"] .a3s', '[role="main"]'],
    // One message body in the opened thread.
    messageBody: [
      '.a3s.aiL',
      '.a3s',
      'div[data-message-id] .a3s',
      '[role="listitem"] .a3s',
    ],
    messageText: ['.a3s', 'div'],
    compose: ['.Am.Al.editable', 'div[role="textbox"][contenteditable="true"]'],
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

  S.first = first;
  S.all = all;
  S.closestMatch = closestMatch;

  // Text of a message bubble/row, or '' when it is not a text message
  // (image-only, reaction, system notice) — callers skip empties.
  S.extractText = (el, list) => {
    if (!el) return '';
    const t = first(el, list) || el;
    return (t.innerText || t.textContent || '').trim().replace(/\u00a0/g, ' ');
  };

  // Weak stable-ish id for DOM rows without real ids: platform + hash of text.
  // Used only for de-duplication within this page lifetime; never persisted.
  S.weakId = (platform, el, text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return platform + ':' + h.toString(36) + ':' + text.length;
  };
})();
