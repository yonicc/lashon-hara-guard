// Hold UI regressions seen live on 2026-10-27 (extension 0.7.1):
//  1. "הצג בלי בדיקה" / "הצג בכל זאת" / "למה?" did nothing: the placeholder
//     had CAPTURE listeners calling stopPropagation(), and an ancestor's
//     capture listener runs before the target, so the button never got the
//     click. The old test called the button's listener directly and missed it;
//     this fake DOM dispatches like a browser (capture → target → bubble).
//  2. "⏳ נבדקת לפני הצגה" with the message text still visible under it:
//     Google Chat rows were text LEAVES, so in "see <a>link</a> now" only the
//     link was held; and a second copy of the same text was never held.
// Set LHG_INCOMING_JS to run these against another build (e.g. the old one).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    addEventListener(t, fn, opt) { this.listeners.push({ t, fn, capture: opt === true || !!(opt && opt.capture) }); },
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

// Browser-like dispatch: window → … → parent (capture), target, parent → … → window (bubble).
function dispatch(win, target, type) {
  let stop = false; let stopNow = false; let prevented = false;
  const ev = {
    type, target,
    stopPropagation() { stop = true; }, stopImmediatePropagation() { stop = true; stopNow = true; },
    preventDefault() { prevented = true; },
  };
  const anc = [];
  for (let n = target.parent; n; n = n.parent) anc.unshift(n);
  const path = [win, ...anc];
  const run = (node, phase) => {
    for (const l of node.listeners.filter((x) => x.t === type)) {
      if (phase === 'capture' && !l.capture) continue;
      if (phase === 'bubble' && l.capture) continue;
      l.fn(ev);
      if (stopNow) return;
    }
  };
  for (const n of path) { run(n, 'capture'); if (stop) return { prevented, reached: false }; }
  run(target, 'target'); if (stop) return { prevented, reached: true };
  for (const n of path.slice().reverse()) { run(n, 'bubble'); if (stop) break; }
  return { prevented, reached: true };
}

function setup(reply, extra = {}) {
  const sent = [];
  const win = { listeners: [], addEventListener(t, fn, opt) { this.listeners.push({ t, fn, capture: opt === true }); } };
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, setInterval: () => 0,
    document: { createElement: (t) => el(t) },
    chrome: { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); cb(reply(m)); } } },
    LHG_SELECTORS: { weakId: (p, _e, t) => p + ':' + t },
    addEventListener: (t, fn, opt) => win.addEventListener(t, fn, opt),
    ...extra,
  });
  ctx.globalThis = ctx;
  // Hebrew UI (the default is English): the buttons are found by Hebrew label.
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'), ctx);
  ctx.LHG_I18N.setLang('he', { persist: false });
  const file = process.env.LHG_INCOMING_JS || path.join(__dirname, 'incoming.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return { G: ctx.LHG_INCOMING, sent, win };
}
const tick = () => new Promise((r) => setTimeout(r, 30));
const holdOf = (e) => e.querySelector(':scope > .lhg-hold');
const btn = (e, label) => holdOf(e).children.find((c) => c.tagName === 'BUTTON' && c.textContent === label);

// A page: document > chat row (page listeners) > message element.
function page() {
  const doc = el('html');
  const row = el('div');
  doc.append(row);
  const pageClicks = [];
  row.addEventListener('click', () => pageClicks.push('row'));
  return { doc, row, pageClicks };
}

async function heldMessage(reply, text, extra) {
  const env = setup(reply, extra);
  const { doc, row, pageClicks } = page();
  let rows = [];
  const sc = env.G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  const msg = h('div', text);
  row.append(msg);
  rows = [{ el: msg, text }];
  sc.scan();
  await tick();
  return { ...env, doc, row, msg, pageClicks, sc };
}

test('bug 1: "הצג בלי בדיקה" reveals a not-checked message (real event dispatch)', async () => {
  const t = await heldMessage(() => ({ alert: 'not_checked', error: 'timeout' }), 'הודעה שהבדיקה שלה נכשלה');
  const b = btn(t.msg, 'הצג בלי בדיקה');
  assert.ok(b, 'button rendered');
  dispatch(t.win, b, 'click');
  assert.equal(holdOf(t.msg), null, 'revealed');
  assert.ok(!t.msg.classList.contains('lhg-held'));
  assert.deepEqual(t.pageClicks, [], 'the page never saw the click');
});

test('bug 1: "הצג בכל זאת" reveals a flagged message and leaves a reminder tag', async () => {
  const t = await heldMessage(() => ({ alert: 'unsure', mechanism: 'other' }), 'איזה גאון, שוב באיחור');
  dispatch(t.win, btn(t.msg, 'הצג בכל זאת'), 'click');
  assert.equal(holdOf(t.msg), null);
  assert.ok(t.msg.querySelector(':scope > .lhg-tag'), 'reminder tag');
});

test('bug 1: "למה?" opens the panel with the result', async () => {
  const shown = [];
  const t = await heldMessage(() => ({ alert: 'warn', mechanism: 'mockery' }), 'כולם יודעים למה הוא עזב',
    { LHG_PANEL: { renderResult: (r, o) => shown.push([r.alert, o.manual]) } });
  dispatch(t.win, btn(t.msg, 'למה?'), 'click');
  assert.deepEqual(shown, [['warn', true]]);
  assert.ok(holdOf(t.msg), '"why" does not reveal');
});

test('bug 1: a page capture listener that swallows clicks cannot kill the buttons; mousedown never reaches the page', async () => {
  const t = await heldMessage(() => ({ alert: 'warn' }), 'הודעה עם אזהרה כלשהי');
  const pageDown = [];
  t.doc.addEventListener('click', (e) => e.stopPropagation(), true); // e.g. a site-wide handler
  t.row.addEventListener('mousedown', () => pageDown.push('row'));
  const b = btn(t.msg, 'הצג בכל זאת');
  dispatch(t.win, b, 'mousedown');
  assert.deepEqual(pageDown, [], 'page does not react to mousedown on the placeholder');
  dispatch(t.win, b, 'click');
  assert.equal(holdOf(t.msg), null);
});

test('bug 1: buttons keep working after the phase changes (pending → not_checked rebuild)', async () => {
  let answer = null;
  const env = setup(() => answer);
  const { row } = page();
  let rows = [];
  const sc = env.G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  const msg = h('div', 'הודעה שממתינה לבדיקה');
  row.append(msg);
  answer = { alert: 'not_checked' };
  rows = [{ el: msg, text: msg.textContent }];
  sc.scan();
  assert.match(holdOf(msg).textContent, /נבדקת לפני הצגה/);
  await tick();
  dispatch(env.win, btn(msg, 'הצג בלי בדיקה'), 'click');
  assert.equal(holdOf(msg), null);
});

test('bug 2: a message with an inline link/mention is held as ONE element (text run root)', () => {
  const { G } = setup(() => ({ alert: 'none' }));
  const link = h('a', 'https://example.test/x');
  const body = h('div', 'ראו את ', link, ' ותגידו מה דעתכם');
  const bubble = h('div', h('span', 'שם השולח'), body);
  h('c-wiz', bubble);
  assert.equal(G.textRunRoot(link), body, 'climbs from the leaf to the whole text run');
  assert.equal(G.textRunRoot(body), body, 'stops before a block wrapper');
  const multi = h('div', 'שורה ראשונה', h('br'), 'שורה שנייה');
  assert.equal(G.textOf(multi), 'שורה ראשונה\nשורה שנייה');
});

test('bug 2: held text-run root hides all of its text; its id stays stable (placeholder text excluded)', async () => {
  const { G, sent } = setup(() => ({ alert: 'warn' }));
  const link = h('a', 'https://example.test/x');
  const body = h('div', 'ראו את ', link, ' ותגידו מה דעתכם');
  let rows = [];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  const target = G.textRunRoot(link);
  rows = [{ el: target, text: G.textOf(target).trim() }];
  sc.scan();
  await tick();
  assert.ok(body.classList.contains('lhg-held'), 'the element owning the surrounding text is held');
  rows = [{ el: target, text: G.textOf(target).trim() }];
  sc.scan();
  await tick();
  assert.equal(sent.length, 1, 'the held element is not re-sent with the placeholder text');
});

test('bug 2: the same message rendered twice in one scan — both copies are held, both revealed', async () => {
  const { G } = setup(() => ({ alert: 'none' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  const a = h('div', 'נפגשים מחר בשמונה'); const b = h('div', 'נפגשים מחר בשמונה');
  rows = [{ el: a, text: 'נפגשים מחר בשמונה' }, { el: b, text: 'נפגשים מחר בשמונה' }];
  sc.scan();
  assert.ok(holdOf(a) && holdOf(b), 'both copies covered while pending');
  await tick();
  assert.equal(holdOf(a), null); assert.equal(holdOf(b), null);
});

test('bug 2 (CSS): held text is hidden by visibility too; the placeholder stays visible and clickable', () => {
  const css = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8');
  const rule = (sel) => (css.match(new RegExp('(^|\\n)' + sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')) || [])[2] || '';
  assert.match(rule('.lhg-held'), /visibility:\s*hidden\s*!important/);
  assert.match(rule('.lhg-hold'), /visibility:\s*visible\s*!important/);
  assert.match(rule('.lhg-hold'), /pointer-events:\s*auto\s*!important/);
});
