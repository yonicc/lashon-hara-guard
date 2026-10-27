// Draft Chafetz Chaim rules in the extension (live_draft, docs/18), against a
// MOCK proxy that speaks the fixed wire contract:
//   request  confirmedFacts?: Record<factId, boolean|null>  (<= 20)
//   response rules?: { mode:'live_draft', notChecked?, findings[], question? }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FORBIDDEN = /מותר|תקין|אושר/;

function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), className: '', children: [], parent: null, _tc: '', listeners: {},
    disabled: false, href: '', target: '', rel: '', type: '', id: '',
    setAttribute() {},
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
const all = (root) => { const out = []; const w = (n) => { for (const c of n.children) { out.push(c); w(c); } }; w(root); return out; };
const byClass = (root, c) => all(root).filter((n) => String(n.className).split(/\s+/).includes(c));
const click = (b) => (b.listeners.click || []).forEach((fn) => fn({}));
const flush = () => new Promise((r) => setTimeout(r, 10));

// Mock proxy: asks about "toelet_purpose" until it is answered, then returns
// one finding; every reply carries limitationsHe.
function mockProxy(calls, opts = {}) {
  return (msg) => {
    calls.push(JSON.parse(JSON.stringify(msg)));
    if (opts.noRules) return { alert: 'none', limitationsHe: [] };
    if (opts.notChecked) return { alert: 'none', limitationsHe: ['מגבלה לדוגמה'], rules: { mode: 'live_draft', notChecked: true, findings: [] } };
    const f = msg.confirmedFacts || {};
    if (!('toelet_purpose' in f)) {
      return {
        alert: 'none', limitationsHe: ['הבדיקה לא הושלמה: חסר מידע.'],
        rules: {
          mode: 'live_draft', findings: [],
          question: { factId: 'toelet_purpose', textHe: 'האם המטרה לתועלת לעתיד?', answers: [
            { value: true, labelHe: 'כן' }, { value: false, labelHe: 'לא' }, { value: null, labelHe: 'לא יודע' }] },
        },
      };
    }
    if (f.toelet_purpose === false) {
      return {
        alert: 'warn', limitationsHe: ['לפי כללי טיוטה מספר חפץ חיים — לא נבדקו בידי מומחה; אינו פסק הלכה.'],
        rules: { mode: 'live_draft', findings: [{ ruleId: 'cc.toelet.1', code: 'NO_TOELET', messageHe: 'לא הוצהרה תועלת לעתיד.',
          sourceRef: 'חפץ חיים, הלכות רכילות, כלל ט', sourceUrl: 'https://www.sefaria.org/Chofetz_Chaim.2.9.1' }] },
      };
    }
    return { alert: 'none', limitationsHe: [], rules: { mode: 'live_draft', findings: [] } };
  };
}

function setup(reply, { conv = 'whatsapp-web:שיחה סינתטית' } = {}) {
  const body = element('body');
  const store = {};
  const calls = [];
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, Promise, JSON, console,
    document: { body, createElement: element, addEventListener() {}, activeElement: null },
    window: {},
    navigator: {},
    chrome: {
      runtime: { lastError: null, sendMessage: (m, cb) => cb && cb(reply(calls)(m)), onMessage: { addListener() {} } },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]))),
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      } },
    },
  });
  ctx.globalThis = ctx;
  ctx.LHG_CONTEXT_RUNTIME = {
    conversationKey: () => conv,
    send: (msg, cb) => ctx.chrome.runtime.sendMessage(msg, cb),
  };
  for (const f of ['i18n.js', 'rules.js', 'panel.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  ctx.LHG_I18N.setLang('he', { persist: false }); // these assertions read Hebrew texts
  const panel = () => all(body).find((n) => n.id === 'lhg-panel') || body.children[0];
  return { ctx, body, store, calls, panel, P: ctx.LHG_PANEL, R: ctx.LHG_RULES };
}

const payload = (text = 'הוא שוב איחר לפגישה, תיזהרו ממנו בעסקה') => ({ type: 'lhg-check', text, platform: 'whatsapp-web', direction: 'outgoing' });

test('rules: one question, answer stored per conversation, re-check with cumulative confirmedFacts', async () => {
  const env = setup((calls) => mockProxy(calls));
  env.P.check(payload(), null, {});
  await flush();
  const p = env.panel();
  assert.match(p.textContent, /שאלת בירור: האם המטרה לתועלת לעתיד\?/);
  const answers = byClass(p, 'lhg-answer');
  assert.deepEqual(answers.map((b) => b.textContent), ['כן', 'לא', 'לא יודע']);
  assert.equal(env.calls[0].confirmedFacts, undefined, 'nothing to send before an answer');
  click(answers[1]); // "לא"
  await flush();
  assert.deepEqual(env.calls[1].confirmedFacts, { toelet_purpose: false });
  assert.match(env.panel().textContent, /לא הוצהרה תועלת לעתיד/);
  const facts = Object.values(env.store[env.R.STORE_KEY]);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].facts, { toelet_purpose: false });
  assert.ok(!JSON.stringify(env.store).includes('שיחה סינתטית'), 'the conversation name is never stored');
  // A later check in the same conversation carries the stored answer.
  env.P.check(payload('הודעה אחרת באותה שיחה בדיוק'), null, {});
  await flush();
  assert.deepEqual(env.calls[2].confirmedFacts, { toelet_purpose: false });
});

test('rules: finding shows messageHe and the source as a link to sourceUrl; limitationsHe shown', async () => {
  const env = setup((calls) => mockProxy(calls));
  await env.R.saveAnswer(env.R.conversationKey('whatsapp-web', null), 'toelet_purpose', false);
  env.P.check(payload(), null, {});
  await flush();
  const p = env.panel();
  const f = byClass(p, 'lhg-finding')[0];
  assert.match(f.textContent, /לא הוצהרה תועלת לעתיד\./);
  const a = all(f).find((n) => n.tagName === 'A');
  assert.equal(a.href, 'https://www.sefaria.org/Chofetz_Chaim.2.9.1');
  assert.equal(a.textContent, 'חפץ חיים, הלכות רכילות, כלל ט');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.match(byClass(p, 'lhg-limit')[0].textContent, /אינו פסק הלכה/);
});

test('rules: never "permitted/fine/approved" — after answering everything only "no further note; not a ruling"', async () => {
  const env = setup((calls) => mockProxy(calls));
  env.P.check(payload(), null, {});
  await flush();
  click(byClass(env.panel(), 'lhg-answer')[0]); // "כן"
  await flush();
  const text = env.panel().textContent;
  assert.ok(text.includes(env.P.NO_FURTHER_NOTE_HE), text);
  assert.equal(env.P.NO_FURTHER_NOTE_HE, 'לא נמצאה הערה נוספת לפי כללי הטיוטה; אינו פסק.');
  assert.doesNotMatch(text, FORBIDDEN);
  for (const r of [{ alert: 'none' }, { alert: 'not_checked' }, { alert: 'weird' }, { alert: 'unsure' }, { alert: 'warn' }]) {
    env.P.renderResult(r, { manual: true });
    assert.doesNotMatch(env.panel().textContent, FORBIDDEN, r.alert);
  }
});

test('rules: notChecked is shown as "הכללים לא נבדקו"', async () => {
  const env = setup((calls) => mockProxy(calls, { notChecked: true }));
  env.P.check(payload(), null, { manual: true });
  await flush();
  assert.match(env.panel().textContent, /הכללים לא נבדקו/);
  assert.ok(!env.panel().textContent.includes(env.P.NO_FURTHER_NOTE_HE));
});

test('rules: a response without rules (old proxy) breaks nothing; compose "none" stays silent', async () => {
  const env = setup((calls) => mockProxy(calls, { noRules: true }));
  env.P.renderResult({ alert: 'warn', mechanism: 'mockery' }, {});
  assert.match(env.panel().textContent, /עלולה להתפרש כגנאי/);
  assert.equal(byClass(env.panel(), 'lhg-rules').length, 0);
  env.P.check(payload(), null, {});
  await flush();
  assert.equal(env.panel().className, 'lhg-hidden', 'no popup for a clean compose check without rules');
  env.P.renderResult({ alert: 'none', rules: { mode: 'something_else', findings: [{ messageHe: 'x' }] } }, {});
  assert.equal(env.panel().className, 'lhg-hidden', 'an unknown rules mode is ignored');
});

test('rules: confirmedFacts capped at 20, newest answers win; invalid ids/values dropped', async () => {
  const env = setup((calls) => mockProxy(calls));
  const conv = env.R.conversationKey('whatsapp-web', null);
  for (let i = 0; i < 25; i++) await env.R.saveAnswer(conv, 'fact_' + i, i % 3 === 0 ? null : i % 2 === 0);
  const facts = await env.R.loadAnswers(conv);
  assert.equal(Object.keys(facts).length, 20);
  assert.ok(!('fact_0' in facts) && 'fact_24' in facts);
  assert.deepEqual({ ...env.R.sanitize({ ok: true, 'bad id': true, x: 'yes', n: null }) }, { ok: true, n: null });
});

test('rules: unknown conversation keeps nothing across checks but accumulates within one check', async () => {
  const env = setup((calls) => mockProxy(calls), { conv: null });
  env.P.check(payload(), null, {});
  await flush();
  click(byClass(env.panel(), 'lhg-answer')[2]); // "לא יודע" = null, stays unknown
  await flush();
  assert.deepEqual({ ...env.calls[1].confirmedFacts }, { toelet_purpose: null });
  assert.equal(env.store[env.R.STORE_KEY], undefined, 'nothing persisted without a conversation identity');
  env.P.check(payload('בדיקה חדשה בשיחה לא מזוהה'), null, {});
  await flush();
  assert.equal(env.calls[2].confirmedFacts, undefined);
});

test('background: confirmedFacts reach POST /check (sanitized, shared rules.js)', async () => {
  const bodies = [];
  let onMsg = null;
  const ctx = vm.createContext({
    setTimeout, clearTimeout, AbortController, JSON, Promise,
    fetch: async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ alert: 'none' }) }; },
    chrome: {
      storage: { local: { get: async () => ({ accessKey: 'k' }) } },
      runtime: { onMessage: { addListener: (fn) => { onMsg = fn; } } },
    },
  });
  ctx.globalThis = ctx;
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), ctx);
  await new Promise((resolve) => onMsg({ type: 'lhg-check', text: 'טקסט', direction: 'outgoing', confirmedFacts: { toelet_purpose: true, 'bad id': 1 } }, null, resolve));
  await new Promise((resolve) => onMsg({ type: 'lhg-check', text: 'טקסט', direction: 'outgoing' }, null, resolve));
  assert.deepEqual(bodies[0].confirmedFacts, { toelet_purpose: true });
  assert.equal('confirmedFacts' in bodies[1], false);
});

test('manifest: rules.js loads before panel.js on every content-script entry', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  for (const cs of m.content_scripts) assert.ok(cs.js.indexOf('rules.js') > -1 && cs.js.indexOf('rules.js') < cs.js.indexOf('panel.js'));
});
