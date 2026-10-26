'use strict';
/**
 * LHG context-dom — pure DOM-context extractors (local-only).
 * Names (displayName/localId) stay in the browser only — never send to proxy.
 * Every function returns null when the info is not in the DOM — never guesses.
 * No selectors here: callers (selectors.js / content scripts) locate nodes.
 */
(function () {
  function parsePrePlainText(s) {
    if (typeof s !== 'string') return null;
    // Format: '[time, date] author: ' e.g. '[10:23, 26/10/2026] John Doe: '
    // Author may be empty (system message) -> null author, not a guess.
    var m = s.match(/^\[\s*([^,\]]+?)\s*,\s*([^\]]+?)\s*\]\s*([\s\S]*)$/);
    if (!m) return null;
    var timeText = m[1].trim();
    var dateText = m[2].trim();
    var rest = m[3];
    if (!timeText || !dateText) return null;
    // Rest should end with ':' (author prefix). 'foo:' -> author 'foo'.
    // System lines like 'Messages to this group are now secured' have no trailing colon.
    var am = rest.match(/^([\s\S]*?):\s*$/);
    if (!am) {
      return { authorDisplayName: null, timeText: timeText, dateText: dateText, raw: s, isSystem: true };
    }
    var author = am[1].trim();
    if (!author) return { authorDisplayName: null, timeText: timeText, dateText: dateText, raw: s, isSystem: true };
    return { authorDisplayName: author, timeText: timeText, dateText: dateText, raw: s, isSystem: false };
  }

  function getAttr(el, name) {
    try {
      if (!el || typeof el.getAttribute !== 'function') return null;
      var v = el.getAttribute(name);
      return typeof v === 'string' ? v : null;
    } catch (e) { return null; }
  }

  function findPrePlainTextNode(bubbleEl) {
    if (!bubbleEl) return null;
    var direct = getAttr(bubbleEl, 'data-pre-plain-text');
    if (direct) return direct;
    try {
      if (typeof bubbleEl.querySelector === 'function') {
        var inner = bubbleEl.querySelector('[data-pre-plain-text]');
        if (inner) {
          var v = getAttr(inner, 'data-pre-plain-text');
          if (v) return v;
        }
      }
    } catch (e) {}
    return null;
  }

  function extractAuthorFromBubble(bubbleEl) {
    var raw = findPrePlainTextNode(bubbleEl);
    if (!raw) return null;
    var parsed = parsePrePlainText(raw);
    if (!parsed) return null;
    if (parsed.isSystem || !parsed.authorDisplayName) return null;
    return parsed.authorDisplayName;
  }

  function nodeText(el) {
    try {
      if (!el) return '';
      if (typeof el.textContent === 'string') return el.textContent;
      if (typeof el.innerText === 'string') return el.innerText;
      return '';
    } catch (e) { return ''; }
  }

  function detectForwarded(bubbleEl) {
    if (!bubbleEl) return null;
    try {
      if (typeof bubbleEl.querySelector === 'function') {
        if (bubbleEl.querySelector('[data-testid="forwarded"], [data-testid="forward-indicator"], [data-testid="forwarded-message-indicator"]')) return true;
        var badge = bubbleEl.querySelector('.forwarded-badge, .forward-badge');
        if (badge) return true;
      }
      // Explicit opt-in marker used by tests / future selectors.js wiring.
      var flag = getAttr(bubbleEl, 'data-forwarded');
      if (flag === 'true') return true;
      // Real visible label — only when an indicator element actually carries it.
      // We do NOT scan the whole bubble text (would false-positive on quoted 'forwarded').
      if (typeof bubbleEl.querySelectorAll === 'function') {
        var spans = bubbleEl.querySelectorAll('span, div');
        for (var i = 0; i < spans.length; i++) {
          var el = spans[i];
          var cls = '';
          try { cls = el.className || ''; } catch (e) {}
          if (typeof cls !== 'string') continue;
          if (/forward/i.test(cls)) {
            var t = nodeText(el).trim();
            if (/forwarded|הועבר/i.test(t)) return true;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function detectQuoted(bubbleEl) {
    if (!bubbleEl) return null;
    try {
      if (typeof bubbleEl.querySelector === 'function') {
        var q = bubbleEl.querySelector('[data-testid="quoted-message"], [data-testid="quote"], .quoted-message, .reply-quote');
        if (q) {
          var author = null;
          try {
            var a = q.querySelector('[data-quoted-author], .quoted-author');
            if (a) {
              var t = nodeText(a).trim();
              if (t) author = t;
              else {
                var aa = getAttr(a, 'data-quoted-author');
                if (aa) author = aa;
              }
            } else {
              var qa = getAttr(q, 'data-quoted-author');
              if (qa) author = qa;
            }
          } catch (e) {}
          return { hasQuote: true, authorDisplayName: author };
        }
        var flag = getAttr(bubbleEl, 'data-quoted');
        if (flag === 'true') return { hasQuote: true, authorDisplayName: null };
      }
    } catch (e) {}
    return null;
  }

  function toNameList(input) {
    if (!input) return null;
    var arr = null;
    if (Array.isArray(input)) arr = input;
    else if (typeof input.length === 'number' && typeof input !== 'string') {
      try { arr = Array.prototype.slice.call(input); } catch (e) { return null; }
    } else return null;
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var name = '';
      if (typeof item === 'string') name = item.trim();
      else if (item && typeof item.textContent === 'string') name = item.textContent.trim();
      else continue;
      if (!name) continue;
      if (seen[name]) continue;
      seen[name] = true;
      out.push({ displayName: name, localId: name });
    }
    return out.length ? out : null;
  }

  function extractVisibleParticipants(input, selfName) {
    var list = toNameList(input);
    if (!list) return null;
    if (typeof selfName === 'string' && selfName) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].displayName === selfName) list[i].isSelf = true;
      }
    }
    return list;
  }

  globalThis.LHG_CONTEXT_DOM = {
    parsePrePlainText: parsePrePlainText,
    extractAuthorFromBubble: extractAuthorFromBubble,
    detectForwarded: detectForwarded,
    detectQuoted: detectQuoted,
    extractVisibleParticipants: extractVisibleParticipants
  };
})();
