// Hold incoming chat messages until checked; manual approval on a warning.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function el(tag = 'div') {
  const e = {
    tagName: tag.toUpperCase(), children: [], parent: null, attrs: {}, listeners: {}, _text: '',
    isContentEditable: false,
    classList: {
      set: new Set(),
      add(...c) { c.forEach((x) => this.set.add(x)); },
      remove(...c) { c.forEach((x) => this.set.delete(x)); },
      contains(c) { return this.set.has(c); },
    },
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return Array.from(this.classList.set).join(' '); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    closest(sel) {
      const cls = sel.split(',').map((s) => (s.trim().match(/^\.([\w-]+)$/) || [])[1]).filter(Boolean);
      for (let n = this; n; n = n.parent) if (cls.some((c) => n.classList.contains(c))) return n;
      return null;
    },
    querySelector(sel) {
      const m = sel.match(/^:scope > \.([\w-]+)$/);
      if (!m) return null;
      return this.children.find((c) => c.classList.contains(m[1])) || null;
    },
  };
  return e;
}
const hold = (e) => e.querySelector(':scope > .lhg-hold');
// Buttons are handled by the delegated window capture listener (see
// hold-buttons.test.cjs for the full browser-like dispatch).
let winClick = [];
const click = (b) => winClick.forEach((fn) => fn({ target: b, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }));
const buttons = (h) => h.children.filter((c) => c.tagName === 'BUTTON');

function setup(reply) {
  const sent = [];
  winClick = [];
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, setInterval: () => 0,
    document: { createElement: (t) => el(t) },
    chrome: { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); cb(reply(m)); } } },
    LHG_SELECTORS: { weakId: (p, _e, t) => p + ':' + t },
    addEventListener: (t, fn) => { if (t === 'click') winClick.push(fn); },
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'incoming.js'), 'utf8'), ctx);
  return { G: ctx.LHG_INCOMING, sent };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

test('hold: history is never held; a live message is held, then revealed when clear', async () => {
  const { G, sent } = setup(() => ({ alert: 'none' }));
  let rows = [{ el: el(), text: 'הודעה ישנה מההיסטוריה' }];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  assert.equal(hold(rows[0].el), null);
  const live = el();
  rows = [...rows, { el: live, text: 'נפגשים מחר בשמונה בבוקר' }];
  sc.scan();
  assert.ok(live.classList.contains('lhg-held'), 'covered before the check returns');
  assert.match(hold(live).textContent, /נבדקת לפני הצגה/);
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(hold(live), null, 'revealed automatically when no alert');
  assert.ok(!live.classList.contains('lhg-held'));
});

test('hold: a warning stays hidden until the user presses "show"', async () => {
  const { G } = setup(() => ({ alert: 'warn', mechanism: 'mockery' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'whatsapp-web', findRows: () => rows, hold: () => true });
  sc.scan();
  const live = el();
  rows = [{ el: live, text: 'איזה גאון, שוב באיחור' }];
  sc.scan();
  await tick();
  const h = hold(live);
  assert.ok(h, 'still hidden');
  assert.match(h.textContent, /עלולה להתפרש כגנאי \(לעג\)/);
  const [show] = buttons(h);
  assert.equal(show.textContent, 'הצג בכל זאת');
  click(show);
  assert.equal(hold(live), null, 'revealed after explicit approval');
  assert.ok(live.querySelector(':scope > .lhg-tag'), 'a reminder tag stays next to it');
});

test('hold: a failed check is never an implicit approval (IN-02)', async () => {
  const { G } = setup(() => ({ alert: 'not_checked', error: 'timeout' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan();
  const live = el();
  rows = [{ el: live, text: 'הודעה שהבדיקה שלה נכשלה' }];
  sc.scan();
  await tick();
  const h = hold(live);
  assert.ok(h);
  assert.equal(buttons(h)[0].textContent, 'הצג בלי בדיקה');
});

test('hold: a burst (other chat / older history) is not held and not sent; e-mail is never held', async () => {
  const { G, sent } = setup(() => ({ alert: 'warn' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'gmail', findRows: () => rows, hold: () => true });
  sc.scan();
  rows = [1, 2, 3, 4].map((i) => ({ el: el(), text: 'הודעה ישנה מספר ' + i }));
  sc.scan();
  await tick();
  assert.equal(sent.length, 0);
  assert.ok(rows.every((r) => !hold(r.el)));
  const mail = el();
  rows = [...rows, { el: mail, text: 'גוף של מייל שנפתח עכשיו', kind: 'email' }];
  sc.scan();
  assert.equal(hold(mail), null, 'e-mail is tagged, not held');
  await tick();
  assert.ok(mail.querySelector(':scope > .lhg-tag'));
});

test('hold: a re-mounted held message is covered again', async () => {
  const { G } = setup(() => ({ alert: 'warn' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'whatsapp-web', findRows: () => rows, hold: () => true });
  sc.scan();
  rows = [{ el: el(), text: 'כולם יודעים למה הוא עזב' }];
  sc.scan();
  await tick();
  const again = el();
  rows = [{ el: again, text: 'כולם יודעים למה הוא עזב' }];
  sc.scan();
  assert.ok(hold(again), 'virtualised re-render does not uncover it');
});

test('hold off: tags only, as before', async () => {
  const { G } = setup(() => ({ alert: 'warn' }));
  let rows = [];
  const sc = G.createScanner({ platform: 'whatsapp-web', findRows: () => rows, hold: () => false });
  sc.scan();
  const live = el();
  rows = [{ el: live, text: 'איזה גאון, שוב באיחור' }];
  sc.scan();
  assert.match(live.querySelector(':scope > .lhg-tag').textContent, /נבדקת/, 'checking tag, not "לא נבדק"');
  await tick();
  assert.equal(hold(live), null);
  assert.match(live.querySelector(':scope > .lhg-tag').textContent, /עלולה להתפרש/);
});
