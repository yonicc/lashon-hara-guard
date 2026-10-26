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
