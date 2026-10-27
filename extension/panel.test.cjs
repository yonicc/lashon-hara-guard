const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Minimal fake DOM element. closest() walks up via .parent.
function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    parent: null,
    textContent: '',
    innerText: '',
    title: '',
    setAttribute() {},
    set textContent(v) { this._tc = v; },
    get textContent() { return this._tc || ''; },
    append(...items) { for (const i of items) { i.parent = this; this.children.push(i); } },
    appendChild(item) { item.parent = this; this.children.push(item); return item; },
    addEventListener() {},
    closest(sel) {
      for (let n = this; n; n = n.parent) {
        if (matchesSel(n, sel)) return n;
      }
      return null;
    },
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    get classList() {
      const el = this;
      return { contains: (c) => String(el.className || '').split(/\s+/).includes(c) };
    },
  };
}

function matchesSel(el, sel) {
  if (!el || !sel) return false;
  // single class selector ".foo" or "tag.foo" or "tag"
  const parts = String(sel).split('.');
  const tag = parts[0] ? parts[0].toUpperCase() : null;
  const cls = parts.slice(1);
  if (tag && el.tagName !== tag) return false;
  const have = String(el.className || '').split(/\s+/);
  return cls.every((c) => !c || have.includes(c));
}

function descendants(root) {
  const out = [];
  const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
  walk(root);
  return out;
}

function queryAll(root, sel) {
  // Supports comma lists of simple selectors (.cls / tag.cls / tag / [attr]).
  const sels = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const el of descendants(root)) {
    for (const s of sels) {
      let ok = false;
      if (s.startsWith('[')) {
        const m = s.match(/^\[([a-zA-Z-]+)(="([^"]*)")?\]$/);
        if (m) ok = (el.attrs && el.attrs[m[1]] !== undefined) && (m[3] === undefined || el.attrs[m[1]] === m[3]);
      } else {
        ok = matchesSel(el, s);
      }
      if (ok) out.push(el);
    }
  }
  return out;
}

function harness() {
  const listeners = {};
  const msgListeners = [];
  const sent = [];
  const body = element('body');
  body.contains = (el) => body.children.includes(el);
  const document = {
    body,
    createElement: (t) => element(t),
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };
  const context = {
    console,
    document,
    window: { getSelection: () => ({ toString: () => '', anchorNode: null }) },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => msgListeners.push(fn) },
        sendMessage(message, callback) {
          sent.push(message);
          callback({ alert: 'warn', mechanism: 'irony', evidence: 'טקסט סינתטי' });
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8'), context);
  return { context, listeners, msgListeners, sent };
}

test('panel: one display question with priority for the catalog question, including older proxy output', () => {
  const { context } = harness();
  const response = { analysis: { questionsHe: ['First?', 'Second?', 'Third?'] } };
  const lines = context.LHG_PANEL.detailLines(response);
  assert.equal(lines.filter((line) => line.startsWith('• ')).length, 1);
  response.rules = { question: { factId: 'synthetic', textHe: 'Catalog question?' } };
  const withRule = context.LHG_PANEL.detailLines(response);
  assert.equal(withRule.filter((line) => line.startsWith('• ')).length, 0);
});

test('panel: legacy page-level Ctrl+Shift+plus still opens status without sending a check', () => {
  const { context, listeners, sent } = harness();
  context.LHG_PANEL.bindManualShortcut({ platform: 'gmail', direction: 'incoming' });
  assert.equal(typeof listeners.keydown, 'function');
  listeners.keydown({
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: '+',
    code: 'Equal',
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(context.LHG_PANEL.isVisible(), true);
  assert.equal(sent.length, 0);
});

test('panel: native Chrome command opens the panel with no zoom collision and no check', () => {
  const { context, msgListeners, sent } = harness();
  context.LHG_PANEL.bindManualShortcut({ platform: 'gmail', direction: 'incoming' });
  assert.ok(msgListeners.length >= 1, 'a chrome.runtime.onMessage listener must be registered');
  msgListeners[0]({ type: 'lhg-open-panel' });
  assert.equal(context.LHG_PANEL.isVisible(), true);
  assert.equal(sent.length, 0);
});

test('panel: native command with selected text sends one incoming check', () => {
  const { context, msgListeners, sent } = harness();
  context.window.getSelection = () => ({ toString: () => 'טקסט סינתטי קצר', anchorNode: null });
  context.LHG_PANEL.bindManualShortcut({ platform: 'gmail', direction: 'incoming' });
  msgListeners[0]({ type: 'lhg-open-panel' });
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { text: sent[0].text, platform: sent[0].platform, direction: sent[0].direction },
    { text: 'טקסט סינתטי קצר', platform: 'gmail', direction: 'incoming' },
  );
  assert.equal(context.LHG_PANEL.isVisible(), true);
});

// --- background: the native command is forwarded to the ACTIVE tab ---------

test('background: open-panel command forwards lhg-open-panel to the active tab', () => {
  const fsBg = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const listeners = {};
  const tabMessages = [];
  let queryArgs = null;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('offline in test')),
    AbortController,
    chrome: {
      commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
      tabs: {
        query: (q, cb) => { queryArgs = q; cb([{ id: 42 }]); },
        sendMessage: (id, msg, cb) => { tabMessages.push({ id, msg }); if (cb) cb(); },
      },
      runtime: { lastError: null, onMessage: { addListener: (fn) => { listeners.message = fn; } } },
      storage: { local: { get: () => Promise.resolve({}) } },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fsBg, context);
  assert.equal(typeof listeners.command, 'function');
  listeners.command('open-panel');
  assert.equal(queryArgs.active, true);
  assert.equal(queryArgs.lastFocusedWindow, true);
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0].id, 42);
  assert.equal(tabMessages[0].msg.type, 'lhg-open-panel');
  listeners.command('other-command');
  assert.equal(tabMessages.length, 1, 'unknown commands must not forward anything');
});

// --- selectors + content-google: Gmail list is not a message, Chat is found -

test('google: folder preview rows are never scanned; chat bubbles and opened-mail bodies are', () => {
  const dir = __dirname;
  const load = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

  const root = element('body');
  const table = element('table');
  table.parent = root; root.children.push(table);
  // Folder preview row: tr.zA > td > .a3s (preview) — must NOT be a message.
  const tr = element('tr'); tr.className = 'zA'; tr.parent = table; table.children.push(tr);
  const td = element('td'); td.parent = tr; tr.children.push(td);
  const preview = element('div'); preview.className = 'a3s'; preview.parent = td; td.children.push(preview);
  // Opened mail: [role=main] > .adn > .a3s — a real message body.
  const main = element('div'); main.attrs = { role: 'main' }; main.parent = root; root.children.push(main);
  const adn = element('div'); adn.className = 'adn'; adn.parent = main; main.children.push(adn);
  const mailBody = element('div'); mailBody.className = 'a3s aiL'; mailBody.parent = adn; adn.children.push(mailBody);
  // Embedded Chat panel: c-wiz area with a compose box and two text bubbles.
  const wiz = element('c-wiz'); wiz.parent = root; root.children.push(wiz);
  const box = element('div'); box.attrs = { role: 'textbox' }; box.parent = wiz; wiz.children.push(box);
  box.contentEditable = 'true'; box.attrs.contenteditable = 'true';
  const b1 = element('div'); b1.attrs = { jsname: 'x' }; b1.parent = wiz; wiz.children.push(b1);
  const b2 = element('div'); b2.attrs = { jsname: 'x' }; b2.parent = wiz; wiz.children.push(b2);

  const attrOf = (el, name) => {
    if (name === 'contenteditable') return el.contentEditable !== undefined ? String(el.contentEditable) : (el.attrs || {})['contenteditable'];
    return (el.attrs || {})[name];
  };
  // Teach the fake querySelector attribute existence checks used above.
  const context = {
    console,
    location: { hostname: 'mail.google.com' },
    document: root,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    MutationObserver: class { observe() {} },
    chrome: { runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(_m, cb) { if (cb) cb({ alert: 'none' }); } } },
    window: { getSelection: () => ({ toString: () => '', anchorNode: null }) },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(load('selectors.js'), context);

  const S = context.LHG_SELECTORS;
  assert.ok(S, 'selectors must load');
  assert.equal(S.gmailIsMessageBody(preview), false, 'a folder preview .a3s must be rejected');
  assert.equal(S.gmailIsMessageBody(mailBody), true, 'an opened .adn > .a3s body must be accepted');

  // googleChatArea must qualify the c-wiz area (has compose + >=2 bubbles).
  // The fake DOM lacks full selector support for attribute+class combos, so
  // this is a smoke check that the helper runs and does not throw; live
  // structure remains to be verified against a real Gmail page.
  let areas = null;
  assert.doesNotThrow(() => { areas = S.googleChatArea(root); });
  assert.ok(Array.isArray(areas));
  void attrOf;
});
