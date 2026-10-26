// Shared compose watcher + frame ownership of the panel command (0.5.2).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPanelOwns() {
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), addEventListener() {} },
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8'), context);
  return context.LHG_PANEL.ownsCommand;
}

test('panel command: only the focused frame answers', () => {
  const owns = loadPanelOwns();
  const top = {}; top.top = top;
  const child = { top };
  const iframeFocused = { activeElement: { tagName: 'IFRAME' }, hasFocus: () => true };
  const bodyFocused = { activeElement: { tagName: 'BODY' }, hasFocus: () => true };
  const unfocused = { activeElement: { tagName: 'IFRAME' }, hasFocus: () => false };
  // Focus inside a Gmail chat iframe: the child answers, the top stays quiet.
  assert.equal(owns(top, iframeFocused), false);
  assert.equal(owns(child, bodyFocused), true);
  // Focus in the mailbox itself: top answers, unfocused chat frames do not.
  assert.equal(owns(top, bodyFocused), true);
  assert.equal(owns(child, { activeElement: { tagName: 'BODY' }, hasFocus: () => false }), false);
  // Nothing focused (toolbar popup button): the top frame answers.
  assert.equal(owns(top, unfocused), true);
});

test('incoming: the compose box is never scanned or tagged (Google Chat draft bug)', () => {
  const context = vm.createContext({ setTimeout, clearTimeout, Date, document: {} });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'incoming.js'), 'utf8'), context);
  const G = context.LHG_INCOMING;
  const inCompose = { isContentEditable: true, closest: () => ({}) };
  const bubble = { isContentEditable: false, closest: () => null };
  assert.equal(G.isEditable(inCompose), true);
  assert.equal(G.isEditable(bubble), false);
  const sent = [];
  context.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); cb({ alert: 'none' }); } } };
  context.LHG_SELECTORS = { weakId: (_p, _el, t) => t };
  let rows = [];
  const scanner = G.createScanner({ platform: 'google-chat', findRows: () => rows });
  scanner.scan(); // baseline
  const appended = [];
  const draft = { ...inCompose, appendChild: (x) => appended.push(x), querySelector: () => null };
  rows = [{ el: draft, text: 'למי יש כח לשיעור הזה' }];
  scanner.scan();
  assert.equal(appended.length, 0, 'no tag inside the compose box');
  assert.equal(scanner.seenCount(), 0, 'the draft is not treated as an incoming message');
});

test('compose watcher: sends one outgoing check after the pause, nothing for short text', async () => {
  const listeners = {};
  const sent = [];
  const shown = [];
  const context = vm.createContext({
    setTimeout, clearTimeout, Date,
    chrome: { runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg); if (cb) cb({ alert: 'warn' }); } } },
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    LHG_PANEL: { show: (k) => shown.push(k), hide: () => shown.push('hide'), renderResult: (r) => shown.push('r:' + r.alert) },
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'compose-watch.js'), 'utf8'), context);
  const box = { isContentEditable: true, innerText: 'וואו, איזה גאון, שוב באיחור' };
  context.LHG_COMPOSE.createComposeWatcher({
    platform: 'google-chat',
    composeBox: (el) => (el === box ? box : null),
    findCompose: () => box,
  });
  listeners.input({ target: { isContentEditable: true } }); // not the compose box: ignored
  listeners.input({ target: box });
  await new Promise((r) => setTimeout(r, 1400));
  const checks = sent.filter((m) => m.type === 'lhg-check');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].direction, 'outgoing');
  assert.equal(checks[0].platform, 'google-chat');
  assert.ok(shown.includes('r:warn'));
  box.innerText = 'קצר';
  listeners.input({ target: box });
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal(sent.filter((m) => m.type === 'lhg-check').length, 1);
});
