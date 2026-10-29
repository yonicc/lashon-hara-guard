// Owner request 2026-10-29 (two parts):
//  1. A held/pending incoming message must show a LOADING indicator, not a
//     flat placeholder that reads as "nothing there".
//  2. The outgoing send gate waits at most 30s, then explains that pressing
//     Enter again (or Send anyway) sends immediately without the result.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
// Minimal fake element, same shape hold-buttons.test.cjs uses (incoming.js is
// written against it: querySelector(':scope > .x'), classList, attrs only).
function textNode(v) { return { nodeType: 3, nodeValue: v, parent: null, get textContent() { return this.nodeValue; } }; }
function el(tag = 'div') {
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodes: [], parent: null, attrs: {}, listeners: [],
    isContentEditable: false, isConnected: true,
    classList: {
      set: new Set(),
      add(...c) { c.forEach((x) => this.set.add(x)); },
      remove(...c) { c.forEach((x) => this.set.delete(x)); },
      contains(c) { return this.set.has(c); },
    },
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return Array.from(this.classList.set).join(' '); },
    get children() { return this.nodes.filter((n) => n.nodeType === 1); },
    get childNodes() { return this.nodes.slice(); },
    get parentElement() { return this.parent; },
    set textContent(v) { this.nodes = []; if (String(v)) this.append(textNode(String(v))); },
    get textContent() { return this.nodes.map((c) => c.textContent).join(''); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    append(c) { c.parent = this; this.nodes.push(c); return c; },
    appendChild(c) { return this.append(c); },
    remove() { if (this.parent) this.parent.nodes = this.parent.nodes.filter((c) => c !== this); this.parent = null; },
    matches(sel) { return sel.split(',').some((s) => { const m = s.trim().match(/^\.([\w-]+)$/); return m && this.classList.contains(m[1]); }); },
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parent) if (n.matches(sel)) return n; return null; },
    querySelector(sel) {
      const m = sel.match(/^:scope > \.([\w-]+)$/);
      if (!m) return null;
      return this.children.find((c) => c.classList.contains(m[1])) || null;
    },
  };
  return e;
}
const h = (tag, ...kids) => { const e = el(tag); for (const k of kids) e.append(typeof k === 'string' ? textNode(k) : k); return e; };

// --- incoming loading indicator ---------------------------------------------

function incomingSetup() {
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, setInterval: () => 0,
    document: { createElement: (t) => el(t) },
    chrome: { runtime: { lastError: null, sendMessage: (_m, cb) => { /* never resolves: stays pending */ } } },
    LHG_SELECTORS: { weakId: (p, _e, t) => p + ':' + t },
    addEventListener: () => {},
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'), ctx);
  ctx.LHG_I18N.setLang('he', { persist: false });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'incoming.js'), 'utf8'), ctx);
  return ctx.LHG_INCOMING;
}

test('held pending message shows an animated loading indicator, not a blank', () => {
  const G = incomingSetup();
  const msg = h('div', 'הודעה נכנסת שממתינה לבדיקה ארוכה');
  let rows = [];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  rows = [{ el: msg, text: 'הודעה נכנסת שממתינה לבדיקה ארוכה' }];
  sc.scan();
  const hold = msg.querySelector(':scope > .lhg-hold');
  assert.ok(hold, 'placeholder rendered');
  assert.ok(hold.children.some((c) => c.classList && c.classList.contains('lhg-spinner')), 'loading indicator present while pending');
  assert.ok(msg.classList.contains('lhg-held-pending'), 'pending phase class');
});

test('unheld pending message (mail) shows the checking tag with a spinner', () => {
  const G = incomingSetup();
  const msg = h('div', 'גוף מייל נפתח ונשלח לבדיקה');
  let rows = [];
  const sc = G.createScanner({ platform: 'gmail', findRows: () => rows, hold: () => false });
  sc.scan(); // baseline
  rows = [{ el: msg, text: 'גוף מייל נפתח ונשלח לבדיקה', kind: 'email' }];
  sc.scan();
  const chip = msg.querySelector(':scope > .lhg-tag');
  assert.ok(chip, 'checking tag rendered');
  assert.ok(chip.classList.contains('lhg-tag-checking'), 'checking kind');
  assert.ok(chip.children.some((c) => c.classList && c.classList.contains('lhg-spinner')), 'loading indicator in the tag');
  assert.match(chip.textContent, /נבדקת/);
});

// --- outgoing 30s cap --------------------------------------------------------

function composeFixture() {
  const listeners = {}, views = [], calls = [];
  let sends = 0;
  const timers = [];
  const box = { innerText: 'Synthetic outgoing message.' };
  const c = vm.createContext({
    document: { addEventListener: (k, f) => listeners[k] = f },
    chrome: { runtime: { sendMessage() {} } }, Date,
    setTimeout: (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return t; },
    clearTimeout: (t) => { t.off = true; },
    LHG_PANEL: { show: (...args) => views.push(args), hide() {},
      check: (p, b, o) => calls.push({ p, b, o }) },
  });
  c.globalThis = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'compose-watch.js'), 'utf8'), c);
  c.LHG_COMPOSE.createComposeWatcher({ platform: 'gmail',
    composeBox: (e) => (e === box ? box : null), findCompose: () => box,
    sendAction: () => ({ box, send: () => sends++ }) });
  const send = () => { const e = { preventDefault() { this.blocked = true; }, stopImmediatePropagation() {} };
    listeners.click(e); if (!e.blocked) sends++; return e; };
  const fireCap = () => timers.filter((t) => !t.off && t.ms === c.LHG_COMPOSE.SEND_CAP_MS).forEach((t) => { t.off = true; t.fn(); });
  return { c, calls, views, send, fireCap, timers, sends: () => sends };
}

test('cap: SEND_CAP_MS is 30 seconds', () => {
  const f = composeFixture();
  assert.equal(f.c.LHG_COMPOSE.SEND_CAP_MS, 30000);
});

test('cap: after 30s the panel explains Enter-again sends immediately; sending then bypasses', () => {
  const f = composeFixture();
  assert.equal(f.send().blocked, true);
  assert.equal(f.calls.length, 1);
  f.fireCap();
  const last = f.views.at(-1);
  assert.match(last[2][0], /Press Enter again|Send anyway/);
  assert.equal(f.send().blocked, undefined, 'second Enter goes through');
  assert.equal(f.sends(), 1);
});

test('cap: a result before the cap cancels the timer (no late panel swap)', () => {
  const f = composeFixture();
  f.send();
  f.calls[0].o.onResult({ alert: 'none' });
  assert.equal(f.sends(), 1, 'clean result replays the send');
  assert.ok(f.timers.every((t) => t.off || t.ms !== 30000), 'cap timer cleared');
  f.fireCap();
  assert.equal(f.sends(), 1);
});
