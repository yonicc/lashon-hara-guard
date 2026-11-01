// Owner requests (2026-11-01):
//  1. Incoming messages send NOTHING to the server until the user presses
//     "Send for check"; "Show without check" reveals with zero sends, and
//     "Send for check" sends exactly once.
//  2. The rabbi referral has a Simple view (kid-friendly: no source quotes,
//     no open doubts, no provenance labels) and a PRO view (everything).
// These tests FAIL on origin/main: incoming auto-sends on scan, and the
// referral always renders the full PRO packet with no toggle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
const all = (root) => { const out = []; const w = (n) => { for (const c of n.children || []) { out.push(c); w(c); } }; w(root); return out; };
const byClass = (root, c) => all(root).filter((n) => String(n.className).split(/\s+/).includes(c));
const holdOf = (e) => e.querySelector(':scope > .lhg-hold');
const buttonsOf = (holdEl) => (holdEl ? holdEl.children.filter((c) => c.tagName === 'BUTTON') : []);
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// Browser-like dispatch (capture at window first), as in hold-buttons.test.cjs.
function dispatch(win, target, type) {
  let stop = false; let stopNow = false;
  const ev = { type, target, stopPropagation() { stop = true; }, stopImmediatePropagation() { stop = true; stopNow = true; }, preventDefault() {} };
  const anc = [];
  for (let n = target.parent; n; n = n.parent) anc.unshift(n);
  const pathNodes = [win, ...anc];
  const run = (node, phase) => {
    for (const l of (node.listeners || []).filter((x) => x.t === type)) {
      if (phase === 'capture' && !l.capture) continue;
      if (phase === 'bubble' && l.capture) continue;
      l.fn(ev);
      if (stopNow) return;
    }
  };
  for (const n of pathNodes) { run(n, 'capture'); if (stop) return; }
  run(target, 'target');
  if (stop) return;
  for (const n of pathNodes.slice().reverse()) { run(n, 'bubble'); if (stop) break; }
}

// --- 1. manual incoming -------------------------------------------------------

function incomingSetup(reply) {
  const sent = [];
  const win = { listeners: [], addEventListener(t, fn, opt) { this.listeners.push({ t, fn, capture: opt === true }); } };
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, setInterval: () => 0,
    document: { createElement: (t) => el(t) },
    chrome: { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); cb(reply(m)); } } },
    LHG_SELECTORS: { weakId: (p, _e, t) => p + ':' + t },
    addEventListener: (t, fn, opt) => win.addEventListener(t, fn, opt),
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'), ctx);
  ctx.LHG_I18N.setLang('he', { persist: false });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'incoming.js'), 'utf8'), ctx);
  return { G: ctx.LHG_INCOMING, sent, win };
}

test('manual incoming: scan sends nothing; reveal sends nothing; Send sends exactly once', async () => {
  const { G, sent, win } = incomingSetup(() => ({ alert: 'warn', mechanism: 'mockery' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true, manual: () => true });
  sc.scan(); // baseline
  const first = h('div', 'הודעה נכנסת ראשונה לבדיקה ידנית');
  rows = [{ el: first, text: 'הודעה נכנסת ראשונה לבדיקה ידנית' }];
  sc.scan();
  await tick();
  assert.equal(sent.length, 0, 'scan alone must not send anything');
  const hold1 = holdOf(first);
  assert.ok(hold1, 'message is held while awaiting the user');
  const btns1 = buttonsOf(hold1);
  assert.equal(btns1.length, 2, 'two choices: send for check / show without check');
  assert.equal(btns1[0].textContent, 'שלח לבדיקה');
  assert.equal(btns1[1].textContent, 'הצג בלי בדיקה');
  dispatch(win, btns1[1], 'click'); // reveal without checking
  await tick();
  assert.equal(sent.length, 0, 'reveal must not send anything');
  assert.equal(holdOf(first), null, 'revealed after Show without check');

  const second = h('div', 'הודעה נכנסת שניה לבדיקה ידנית');
  rows = [...rows, { el: second, text: 'הודעה נכנסת שניה לבדיקה ידנית' }];
  sc.scan();
  await tick();
  assert.equal(sent.length, 0, 'second scan also sends nothing');
  const sendBtn = buttonsOf(holdOf(second))[0];
  assert.equal(sendBtn.textContent, 'שלח לבדיקה');
  dispatch(win, sendBtn, 'click');
  await tick(80);
  assert.equal(sent.length, 1, 'Send for check sends exactly once');
});

test('manual incoming: an opened e-mail also sends nothing until "Send for check" is pressed', async () => {
  // The 0.17.0 bug the owner caught: row.kind === 'email' skipped the manual
  // gate, so Gmail kept auto-sending on scan (⏳ "נבדקת לפני הצגה").
  const { G, sent, win } = incomingSetup(() => ({ alert: 'warn', mechanism: 'mockery' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'gmail', findRows: () => rows, hold: () => false, manual: () => true });
  sc.scan(); // baseline
  const mail = h('div', 'גוף של מייל נכנס שמחכה לאישור בדיקה');
  rows = [{ el: mail, text: 'גוף של מייל נכנס שמחכה לאישור בדיקה', kind: 'email' }];
  sc.scan();
  await tick();
  assert.equal(sent.length, 0, 'opening an e-mail must not send anything');
  const chip = mail.querySelector(':scope > .lhg-tag');
  assert.ok(chip, 'manual tag rendered on the e-mail');
  assert.ok(chip.classList.contains('lhg-tag-not_checked'), 'manual state is the not_checked tag, never checking');
  const btn = chip.children.find((c) => c.tagName === 'BUTTON');
  assert.ok(btn, 'the tag carries a Send for check button');
  assert.equal(btn.textContent, 'שלח לבדיקה');
  assert.equal(mail.querySelector(':scope > .lhg-hold'), null, 'e-mail is still never held');
  dispatch(win, btn, 'click');
  await tick(80);
  assert.equal(sent.length, 1, 'Send for check sends exactly once');
  assert.equal(sent[0].type, 'lhg-check');
  assert.equal(sent[0].direction, 'incoming');
  dispatch(win, btn, 'click'); // a second press while pending is a no-op
  await tick(40);
  assert.equal(sent.length, 1, 'no duplicate send from the same press path');
});

// --- 2. Simple / PRO referral --------------------------------------------------

function panelSetup() {
  function element(tag = 'div') {
    return {
      tagName: tag.toUpperCase(), className: '', children: [], parent: null, _tc: '', listeners: {},
      disabled: false, href: '', target: '', rel: '', type: '', id: '', attrs: {}, style: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      set textContent(v) { this._tc = String(v); this.children = []; },
      get textContent() { return this._tc + this.children.map((c) => c.textContent).join(''); },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.appendChild(c); },
      after() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; },
    };
  }
  const body = element('body');
  body.contains = (n) => { for (let x = n; x; x = x.parent) if (x === body) return true; return false; };
  const store = {};
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, Promise, JSON, console,
    document: { body, createElement: element, addEventListener() {}, activeElement: null },
    window: {}, navigator: {},
    chrome: {
      runtime: { lastError: null, sendMessage: (m, cb) => cb && cb({ alert: 'warn' }), onMessage: { addListener() {} } },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]))),
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); },
        onChanged: { addListener() {} },
      }, onChanged: { addListener() {} } },
    },
  });
  ctx.globalThis = ctx;
  for (const f of ['i18n.js', 'rules.js', 'panel.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  ctx.LHG_I18N.setLang('he', { persist: false });
  const panel = () => all(body).find((n) => n.id === 'lhg-panel') || body.children[0];
  return { ctx, panel, P: ctx.LHG_PANEL };
}
const clickEl = (b) => (b.listeners.click || []).forEach((fn) => fn({}));

test('referral Simple hides quotes/doubts/provenance; PRO shows everything', async () => {
  const { panel, P } = panelSetup();
  const referral = {
    sectionKey: 'p1_prin1:2', sourceRef: 'Chafetz Chaim, Part One, Principle 1:2',
    sourceUrl: 'https://www.sefaria.org/Chafetz_Chaim,_Part_One,_Principle_1:2',
    category: 'expert_ruling',
    questionHe: 'האם נסיבות המקרה נכנסות לכלל, וכיצד נוהגים?',
    howToAskHe: 'יש להציג את המקרה בפני רב מוסמך.',
    backgroundHe: 'רקע סינתטי',
    quotesHe: ['לא תלך רכיל בעמיך'],
    gatheredFacts: [{ id: 'subject.identifiable', questionHe: 'האם אפשר לזהות במי מדובר?', valueHe: 'ידוע: כן', provenanceHe: 'חולץ מהטקסט' }],
    uncertainHe: ['נדרשת הכרעה מוסמכת'],
    whyNotCheckedHe: 'סעיף זה מסווג כהכרעת מומחה (קבוצה ד׳) — אינו מוכרע אוטומטית.',
  };
  P.renderResult({ alert: 'warn', rules: { mode: 'live_draft', findings: [], referrals: [referral] } }, { manual: true });
  await tick(10);
  let text = panel().textContent;
  assert.match(text, /האם נסיבות המקרה נכנסות לכלל/, 'the question itself stays in Simple');
  assert.match(text, /האם אפשר לזהות במי מדובר\?/, 'gathered facts stay in Simple');
  assert.ok(!text.includes('לא תלך רכיל בעמיך'), 'Simple hides source quotes');
  assert.ok(!text.includes('נדרשת הכרעה מוסמכת'), 'Simple hides open doubts');
  assert.ok(!text.includes('חולץ מהטקסט'), 'Simple hides provenance labels');
  const proBtn = byClass(panel(), 'lhg-referral-pro')[0];
  assert.ok(proBtn, 'a PRO toggle is offered');
  clickEl(proBtn);
  await tick(10);
  text = panel().textContent;
  assert.ok(text.includes('לא תלך רכיל בעמיך'), 'PRO shows source quotes');
  assert.ok(text.includes('נדרשת הכרעה מוסמכת'), 'PRO shows open doubts');
  assert.ok(text.includes('חולץ מהטקסט'), 'PRO shows provenance labels');
  const simpleBtn = byClass(panel(), 'lhg-referral-simple')[0];
  assert.ok(simpleBtn, 'a Simple toggle is offered');
  clickEl(simpleBtn);
  await tick(10);
  text = panel().textContent;
  assert.ok(!text.includes('לא תלך רכיל בעמיך'), 'switching back to Simple hides quotes again');
});
