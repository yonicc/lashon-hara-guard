'use strict';
// LHG context-dom tests — plain node:test script, no build.
// Fake minimal DOM: plain objects with getAttribute/querySelector/querySelectorAll/textContent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'context-dom.js'), 'utf8');
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const C = sandbox.LHG_CONTEXT_DOM;

function el(attrs, children, text) {
  return {
    _attrs: attrs || {},
    _children: children || {},
    textContent: typeof text === 'string' ? text : '',
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    querySelector(sel) {
      return this._children[sel] || null;
    },
    querySelectorAll() { return []; }
  };
}

test('parsePrePlainText: regular author bubble', () => {
  const r = C.parsePrePlainText('[10:23, 26/10/2026] John Doe: ');
  assert.equal(r.authorDisplayName, 'John Doe');
  assert.equal(r.timeText, '10:23');
  assert.equal(r.dateText, '26/10/2026');
  assert.equal(r.isSystem, false);
});

test('parsePrePlainText: Hebrew author name', () => {
  const r = C.parsePrePlainText('[21:05, 1/1/2026] אדם לדוגמה: ');
  assert.equal(r.authorDisplayName, 'אדם לדוגמה');
  assert.equal(r.isSystem, false);
});

test('parsePrePlainText: system message has no trailing colon', () => {
  const r = C.parsePrePlainText('[10:24, 26/10/2026] Messages to this chat are now secured');
  assert.equal(r.isSystem, true);
  assert.equal(r.authorDisplayName, null);
});

test('parsePrePlainText: corrupt input returns null', () => {
  assert.equal(C.parsePrePlainText('garbage without brackets'), null);
  assert.equal(C.parsePrePlainText(''), null);
  assert.equal(C.parsePrePlainText(null), null);
  assert.equal(C.parsePrePlainText(undefined), null);
  assert.equal(C.parsePrePlainText(42), null);
  assert.equal(C.parsePrePlainText('[, ] : '), null);
});

test('parsePrePlainText: empty author is system, not a guess', () => {
  const r = C.parsePrePlainText('[10:24, 26/10/2026] : ');
  assert.equal(r.isSystem, true);
  assert.equal(r.authorDisplayName, null);
});

test('extractAuthorFromBubble: direct attribute', () => {
  const b = el({ 'data-pre-plain-text': '[10:23, 26/10/2026] Jane Doe: ' }, {});
  assert.equal(C.extractAuthorFromBubble(b), 'Jane Doe');
});

test('extractAuthorFromBubble: nested attribute', () => {
  const inner = el({ 'data-pre-plain-text': '[10:23, 26/10/2026] Nested Name: ' }, {});
  const b = el({}, { '[data-pre-plain-text]': inner });
  assert.equal(C.extractAuthorFromBubble(b), 'Nested Name');
});

test('extractAuthorFromBubble: no author info returns null, never false', () => {
  assert.equal(C.extractAuthorFromBubble(el({}, {})), null);
  assert.equal(C.extractAuthorFromBubble(el({ 'data-pre-plain-text': 'corrupt' }, {})), null);
  assert.equal(C.extractAuthorFromBubble(el({ 'data-pre-plain-text': '[10:24, 26/10/2026] system line' }, {})), null);
  assert.equal(C.extractAuthorFromBubble(null), null);
});

test('detectForwarded: explicit indicator returns true', () => {
  const b = el({}, { '[data-testid="forwarded"], [data-testid="forward-indicator"], [data-testid="forwarded-message-indicator"]': el({}, {}) });
  assert.equal(C.detectForwarded(b), true);
});

test('detectForwarded: no indicator returns null, never false', () => {
  assert.equal(C.detectForwarded(el({}, {})), null);
  assert.equal(C.detectForwarded(null), null);
});

test('detectQuoted: quote with author', () => {
  const author = el({}, {}, 'Quoted Person');
  author.querySelector = () => null;
  const q = el({ 'data-quoted-author': '' }, {});
  q.querySelector = (sel) => (sel === '[data-quoted-author], .quoted-author' ? author : null);
  const b = el({}, { '[data-testid="quoted-message"], [data-testid="quote"], .quoted-message, .reply-quote': q });
  const r = C.detectQuoted(b);
  assert.equal(r.hasQuote, true);
  assert.equal(r.authorDisplayName, 'Quoted Person');
});

test('detectQuoted: no quote returns null, never false', () => {
  assert.equal(C.detectQuoted(el({}, {})), null);
  assert.equal(C.detectQuoted(null), null);
});

test('extractVisibleParticipants: group vs private', () => {
  const group = C.extractVisibleParticipants(['Alice', 'Bob', 'Carol'], 'Alice');
  assert.equal(group.length, 3);
  assert.equal(group[0].isSelf, true);
  assert.equal(group[1].isSelf, undefined);
  const priv = C.extractVisibleParticipants(['Bob']);
  assert.equal(priv.length, 1);
  assert.equal(priv[0].displayName, 'Bob');
  assert.equal(priv[0].localId, 'Bob');
  assert.equal(priv[0].isSelf, undefined);
});

test('extractVisibleParticipants: empty/unknown returns null', () => {
  assert.equal(C.extractVisibleParticipants([]), null);
  assert.equal(C.extractVisibleParticipants(null), null);
  assert.equal(C.extractVisibleParticipants(['', '  ']), null);
});
;(() => {
const { test: t3a } = require('node:test');
const a3a = require('node:assert/strict');
const f3a = require('fs');
const v3a = require('vm');
const p3a = require('path');
function load3a() {
  const fp = p3a.join(__dirname, 'context-dom.js');
  const code = f3a.readFileSync(fp, 'utf8');
  const sb = {};
  sb.globalThis = sb;
  sb.console = console;
  v3a.createContext(sb);
  v3a.runInContext(code, sb, { filename: 'context-dom.js' });
  return sb;
}
function el3a(attrs, kids) {
  attrs = attrs || {};
  kids = kids || [];
  const el = {
    _a: attrs,
    _k: kids,
    textContent: attrs.text || '',
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._a, n) ? this._a[n] : null; },
    querySelector(sel) {
      if (String(sel).indexOf('data-pre-plain-text') !== -1) {
        if (this._a['data-pre-plain-text'] != null) return this;
        for (const c of this._k) { if (c && c._a && c._a['data-pre-plain-text'] != null) return c; }
        return null;
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  return el;
}
t3a('local-context attach returns author for bubble with pre-plain-text', () => {
  const sb = load3a();
  a3a.ok(sb.LHG_LOCAL_CONTEXT, 'LHG_LOCAL_CONTEXT exists');
  a3a.equal(typeof sb.LHG_LOCAL_CONTEXT.attach, 'function');
  const b = el3a({ 'data-pre-plain-text': '[12:00, 01/01/2024] \u05d0\u05d3\u05dd \u05dc\u05d3\u05d5\u05d2\u05de\u05d4:' });
  const r = sb.LHG_LOCAL_CONTEXT.attach(b);
  a3a.ok(r, 'result not null');
  a3a.equal(r.authorDisplayName, '\u05d0\u05d3\u05dd \u05dc\u05d3\u05d5\u05d2\u05de\u05d4');
  a3a.ok('forwarded' in r, 'has forwarded key');
  a3a.ok('quoted' in r, 'has quoted key');
});
t3a('local-context attach returns null for bubble without info', () => {
  const sb = load3a();
  const b = el3a({});
  const r = sb.LHG_LOCAL_CONTEXT.attach(b);
  a3a.equal(r, null);
});
t3a('local-context attach(null) does not throw', () => {
  const sb = load3a();
  let r;
  a3a.doesNotThrow(() => { r = sb.LHG_LOCAL_CONTEXT.attach(null); });
  a3a.equal(r, null);
  a3a.doesNotThrow(() => { r = sb.LHG_LOCAL_CONTEXT.attach(undefined); });
  a3a.equal(r, null);
});
})();