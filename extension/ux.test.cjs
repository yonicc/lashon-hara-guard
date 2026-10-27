// 0.9 UX: i18n (English default, Hebrew switch), on/off switches, the free
// note in the panel (userNote), panel geometry, popup/options wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 15));

// chrome.storage.local fake with onChanged, shared by everything in a context.
function fakeStorage(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const changed = [];
  const fireChange = (ch) => { for (const fn of changed) fn(ch, 'local'); };
  return {
    store,
    fireChange,
    local: {
      get(keys, cb) {
        const ks = Array.isArray(keys) ? keys : [keys];
        const out = Object.fromEntries(ks.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]));
        if (cb) cb(out); else return Promise.resolve(out);
      },
      set(o, cb) {
        const ch = {};
        for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = JSON.parse(JSON.stringify(v)); }
        if (cb) cb();
        fireChange(ch);
      },
      remove(k, cb) { const ch = { [k]: { oldValue: store[k] } }; delete store[k]; if (cb) cb(); fireChange(ch); },
    },
    onChanged: { addListener: (fn) => changed.push(fn) },
  };
}

function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), className: '', children: [], parent: null, _tc: '', listeners: {}, attrs: {},
    style: {}, value: '', disabled: false, id: '', title: '', type: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    set textContent(v) { this._tc = String(v); this.children = []; },
    get textContent() { return this._tc + this.children.map((c) => c.textContent).join(''); },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    after() {},
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener() {},
    contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; },
  };
}
const all = (root) => { const out = []; const w = (n) => { for (const c of n.children) { out.push(c); w(c); } }; w(root); return out; };
const byClass = (root, c) => all(root).filter((n) => String(n.className).split(/\s+/).includes(c));
const fire = (el, type, ev = {}) => (el.listeners[type] || []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {}, ...ev }));

function i18nContext(storage) {
  const ctx = vm.createContext({ setTimeout, clearTimeout, Promise, JSON, console });
  if (storage) ctx.chrome = { storage };
  ctx.globalThis = ctx;
  vm.runInContext(read('i18n.js'), ctx);
  return ctx;
}

// --- i18n --------------------------------------------------------------------

test('i18n: English by default, Hebrew on request, both dictionaries have the same keys', () => {
  const ctx = i18nContext(fakeStorage());
  const I = ctx.LHG_I18N;
  assert.equal(I.lang(), 'en');
  assert.equal(I.dir(), 'ltr');
  assert.equal(I.t('lang.other'), 'עברית', 'English UI offers a clear "עברית" switch');
  assert.equal(I.t('detail.ctxN', { n: 3 }), '3 earlier messages in the conversation were taken into account.');
  I.setLang('he');
  assert.equal(I.dir(), 'rtl');
  assert.equal(I.t('lang.other'), 'English');
  assert.equal(I.t('no.such.key'), 'no.such.key');
  assert.deepEqual(Object.keys(I.DICT.he).sort(), Object.keys(I.DICT.en).sort());
  for (const [k, v] of Object.entries(I.DICT.en)) {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(v), vars(I.DICT.he[k]), 'same placeholders in ' + k);
  }
});

test('i18n: the choice is stored and followed live through storage.onChanged', async () => {
  const st = fakeStorage({ lhgLang: 'he' });
  const ctx = i18nContext(st);
  const I = ctx.LHG_I18N;
  assert.equal(I.lang(), 'he', 'stored choice is loaded');
  const seen = [];
  I.onChange((l) => seen.push(l));
  I.setLang('en');
  assert.equal(st.store.lhgLang, 'en');
  st.fireChange({ lhgLang: { newValue: 'he' } }); // another tab switched
  assert.equal(I.lang(), 'he');
  st.fireChange({ lhgLang: { newValue: undefined } }); // removed -> default
  assert.equal(I.lang(), 'en');
  assert.deepEqual(seen, ['en', 'he', 'en']);
  assert.equal(I.setLang('fr'), 'en', 'unknown languages are ignored');
});

test('i18n: a Hebrew literal from an unmigrated caller is shown in English; mechanisms are translated', () => {
  const I = i18nContext(null).LHG_I18N;
  assert.equal(I.localize('…בודק ניסוח'), '…Checking the wording');
  assert.equal(I.localize('something else'), 'something else');
  assert.equal(I.mechanism('irony'), 'irony');
  assert.equal(I.mechanism('nope'), '');
  I.setLang('he', { persist: false });
  assert.equal(I.mechanism('mockery'), 'לעג');
  assert.equal(I.localize('…בודק ניסוח'), '…בודק ניסוח');
});

test('i18n: every literal key used by the extension exists in the dictionary', () => {
  const I = i18nContext(null).LHG_I18N;
  const files = ['panel.js', 'incoming.js', 'content.js', 'content-google.js', 'options.js'];
  const missing = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\('([a-zA-Z0-9_.-]+)'\s*[,)]/g)) if (!(m[1] in I.DICT.en)) missing.push(f + ': ' + m[1]);
  }
  for (const f of ['options.html', 'popup.html']) {
    for (const m of read(f).matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) if (!(m[1] in I.DICT.en)) missing.push(f + ': ' + m[1]);
  }
  for (const k of ['tag.checking', 'tag.warn', 'tag.unsure', 'tag.not_checked', 'tag.unchecked_overflow',
    'hold.pending', 'hold.warn', 'hold.unsure', 'hold.not_checked', 'reveal.warn', 'reveal.unsure', 'reveal.not_checked',
    'audience.private', 'audience.group', 'audience.public', 'plat.whatsapp-web', 'plat.gmail', 'plat.google-chat']) {
    if (!(k in I.DICT.en)) missing.push('dynamic: ' + k);
  }
  assert.deepEqual(missing, []);
  // No Hebrew UI literal is left in the migrated scripts (comments aside).
  for (const f of ['panel.js', 'incoming.js', 'content.js', 'content-google.js', 'options.js']) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const hebrewStrings = (code.match(/'[^'\n]*[֐-׿][^'\n]*'/g) || [])
      .filter((s) => !/וואו, איזה גאון/.test(s) && !/^'[״]'$/.test(s)); // synthetic test text / quote marks
    assert.deepEqual(hebrewStrings, [], f);
  }
});

// --- settings ----------------------------------------------------------------

function settingsContext(storage) {
  const ctx = vm.createContext({ setTimeout, clearTimeout, Promise, JSON });
  ctx.chrome = { storage };
  ctx.globalThis = ctx;
  vm.runInContext(read('settings.js'), ctx);
  return ctx.LHG_SETTINGS;
}

test('settings: everything on by default; master and per-platform switches; live updates', async () => {
  const st = fakeStorage();
  const S = settingsContext(st);
  for (const p of ['whatsapp-web', 'gmail', 'google-chat', 'options-test']) assert.equal(S.isActive(p), true, p);
  const seen = [];
  S.onChange((s) => seen.push(s.lhgEnabled));
  await S.setPlatform('gmail', false);
  assert.equal(S.isActive('gmail'), false);
  assert.equal(S.isActive('google-chat'), true);
  assert.equal(st.store.lhgPlatforms.gmail, false);
  st.fireChange({ lhgEnabled: { newValue: false } }); // switched off in the popup
  for (const p of ['whatsapp-web', 'google-chat', 'options-test']) assert.equal(S.isActive(p), false, p);
  await S.enable('gmail');
  assert.equal(S.isActive('gmail'), true);
  assert.equal(S.isActive('whatsapp-web'), true);
  assert.ok(seen.length >= 3);
  const loaded = settingsContext(fakeStorage({ lhgEnabled: false, lhgPlatforms: { 'whatsapp-web': false } }));
  assert.equal(loaded.get().lhgEnabled, false);
  assert.equal(loaded.get().lhgPlatforms['whatsapp-web'], false);
  assert.equal(loaded.get().lhgPlatforms.gmail, true, 'a missing platform defaults to on');
  assert.equal(loaded.get().hideIncoming, true);
});

// --- panel -------------------------------------------------------------------

function panelEnv({ reply = () => ({ alert: 'warn', mechanism: 'irony', evidence: 'גאון' }), lang = 'en', stored = {} } = {}) {
  const st = fakeStorage(stored);
  const body = element('body');
  const sent = [];
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, Promise, JSON, console,
    document: { body, createElement: element, addEventListener() {}, activeElement: null },
    window: { getSelection: () => ({ toString: () => '', anchorNode: null }) },
    navigator: {},
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {},
    chrome: {
      storage: st,
      runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage: (m, cb) => { sent.push(JSON.parse(JSON.stringify(m))); if (cb) cb(reply(m)); } },
    },
  });
  ctx.globalThis = ctx;
  for (const f of ['i18n.js', 'settings.js', 'rules.js', 'panel.js']) vm.runInContext(read(f), ctx);
  ctx.LHG_I18N.setLang(lang, { persist: false });
  ctx.LHG_RULES.conversationKey = () => null; // single-message checks
  const panel = () => all(body).find((n) => n.id === 'lhg-panel');
  return { ctx, st, body, sent, panel, P: ctx.LHG_PANEL };
}

test('panel: the free note is there in every state and goes out as userNote with the last checked text (one request)', async () => {
  const env = panelEnv();
  const payload = { type: 'lhg-check', text: 'וואו, איזה גאון, שוב באיחור', platform: 'whatsapp-web', direction: 'outgoing' };
  env.P.check(payload, null, {});
  await flush();
  const p = env.panel();
  assert.match(p.className, /lhg-warn/);
  for (const kind of ['muted', 'checking', 'warn', 'unsure']) {
    env.P.show(kind, 'x', []);
    assert.equal(byClass(env.panel(), 'lhg-note').length, 1, kind + ': note input present');
    assert.equal(byClass(env.panel(), 'lhg-send').length, 1, kind + ': send button present');
  }
  const note = byClass(p, 'lhg-note')[0];
  note.value = '  הוא אחי,\n אני מתייעץ איך לעזור לו  ' + 'x'.repeat(600);
  fire(byClass(p, 'lhg-send')[0], 'click');
  await flush();
  assert.equal(env.sent.length, 2, 'exactly one more /check for the note');
  const last = env.sent[1];
  assert.equal(last.text, payload.text, 'same checked text');
  assert.equal(last.direction, 'outgoing');
  assert.equal(last.userNote.length, env.ctx.LHG_RULES.USER_NOTE_MAX);
  assert.ok(last.userNote.startsWith('הוא אחי, אני מתייעץ'), 'one line, trimmed');
  assert.equal(last.confirmedFacts, undefined, 'a note is never a confirmed fact');
  assert.equal(note.value, '', 'the input is cleared after sending');
  assert.match(env.panel().textContent, /Your note: "הוא אחי/);
  // A later note replaces (does not accumulate onto) the previous one.
  note.value = 'second note';
  fire(note, 'keydown', { key: 'Enter', shiftKey: false });
  await flush();
  assert.equal(env.sent[2].userNote, 'second note');
  assert.equal(env.sent[2].text, payload.text);
  // Shift+Enter is a new line, not a send.
  note.value = 'draft';
  fire(note, 'keydown', { key: 'Enter', shiftKey: true });
  await flush();
  assert.equal(env.sent.length, 3);
});

test('panel: with nothing checked yet, the note itself is checked as text; an empty note sends nothing', async () => {
  const env = panelEnv({ reply: () => ({ alert: 'none' }) });
  env.P.bindManualShortcut({ platform: 'gmail' });
  env.P.show('muted', 'status', []);
  const note = byClass(env.panel(), 'lhg-note')[0];
  note.value = '   ';
  fire(byClass(env.panel(), 'lhg-send')[0], 'click');
  assert.equal(env.sent.length, 0);
  note.value = 'is this ok to say about the teacher';
  fire(byClass(env.panel(), 'lhg-send')[0], 'click');
  await flush();
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].text, 'is this ok to say about the teacher');
  assert.equal(env.sent[0].platform, 'gmail');
  assert.equal('userNote' in env.sent[0], false);
  assert.match(env.panel().className, /lhg-muted/, 'a manual check always shows its result');
});

test('panel: English by default with a clear "עברית" button; switching re-renders the open result in Hebrew, RTL', async () => {
  const env = panelEnv();
  env.P.renderResult({ alert: 'warn', mechanism: 'mockery', evidence: 'גאון' }, {});
  const p = env.panel();
  assert.equal(p.getAttribute('dir'), 'ltr');
  assert.match(p.textContent, /may be understood as disparaging/);
  assert.match(p.textContent, /How: mockery/);
  const lang = byClass(p, 'lhg-lang')[0];
  assert.equal(lang.textContent, 'עברית');
  fire(lang, 'click');
  assert.equal(env.st.store.lhgLang, 'he', 'the choice is stored');
  assert.equal(p.getAttribute('dir'), 'rtl');
  assert.match(p.textContent, /עלולה להתפרש כגנאי/);
  assert.match(p.textContent, /אופן: לעג/);
  assert.equal(byClass(p, 'lhg-lang')[0].textContent, 'English');
  assert.doesNotMatch(p.textContent, /may be understood/);
});

test('panel: geometry — 420px default in the bottom corner, clamped on small screens and for off-screen saved positions', () => {
  const { P } = panelEnv();
  const d = P.clampGeometry(null, { w: 1280, h: 800 }, 300);
  assert.equal(d.w, 420);
  assert.equal(d.x, 1280 - 420 - 24);
  assert.equal(d.y, 800 - 300 - 84);
  assert.equal(d.h, null, 'auto height until the user resizes');
  const phone = P.clampGeometry({ x: 500, y: 900, w: 600, h: 1200 }, { w: 360, h: 640 });
  assert.equal(phone.w, 360 - 16, 'full width on a small screen');
  assert.equal(phone.x, 8);
  assert.ok(phone.h <= 640 - 16 && phone.h >= 180);
  assert.ok(phone.y + 180 <= 640 - 8, 'the panel stays reachable');
  const tiny = P.clampGeometry({ x: 10, y: 10, w: 100, h: 50 }, { w: 1280, h: 800 });
  assert.equal(tiny.w, 300, 'min width');
  assert.equal(tiny.h, 180, 'min height');
});

test('panel: position/size come from storage and a reset in options returns to the default', async () => {
  const env = panelEnv({ stored: { lhgPanelGeom: { x: 40, y: 50, w: 500, h: 400 } } });
  env.P.show('muted', 'x', []);
  const p = env.panel();
  assert.equal(p.style.left, '40px');
  assert.equal(p.style.top, '50px');
  assert.equal(p.style.width, '500px');
  assert.equal(p.style.height, '400px');
  env.st.local.remove(env.P.GEOM_KEY);
  assert.equal(p.style.width, '420px');
  assert.equal(p.style.height, '');
});

test('panel: on a switched-off site the shortcut shows "off" with a "Turn on" button and sends nothing', async () => {
  const env = panelEnv({ stored: { lhgPlatforms: { 'whatsapp-web': false } } });
  env.ctx.window.getSelection = () => ({ toString: () => 'טקסט מסומן לבדיקה ידנית', anchorNode: null });
  env.P.openManual({ platform: 'whatsapp-web' });
  assert.equal(env.sent.length, 0);
  assert.match(env.panel().textContent, /off on this site/);
  const btn = byClass(env.panel(), 'lhg-action')[0];
  assert.equal(btn.textContent, 'Turn on');
  fire(btn, 'click');
  await flush();
  assert.equal(env.ctx.LHG_SETTINGS.isActive('whatsapp-web'), true);
  assert.equal(env.sent.length, 1, 'after turning on, the selection is checked');
});

// --- incoming scanner + switches -------------------------------------------

function holdEl(tag = 'div') {
  const e = element(tag);
  e.classList = {
    set: new Set(),
    add(...c) { c.forEach((x) => this.set.add(x)); },
    remove(...c) { c.forEach((x) => this.set.delete(x)); },
    contains(c) { return this.set.has(c); },
  };
  Object.defineProperty(e, 'className', {
    get() { return Array.from(this.classList.set).join(' '); },
    set(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  e.closest = function (sel) {
    const cls = sel.split(',').map((s) => (s.trim().match(/^\.([\w-]+)$/) || [])[1]).filter(Boolean);
    for (let n = this; n; n = n.parent) if (cls.some((c) => n.classList && n.classList.contains(c))) return n;
    return null;
  };
  e.querySelector = function (sel) {
    const m = sel.match(/^:scope > \.([\w-]+)$/);
    return m ? this.children.find((c) => c.classList && c.classList.contains(m[1])) || null : null;
  };
  return e;
}

test('incoming: a switched-off platform sends nothing and releases held messages; re-enabling baselines (no burst)', async () => {
  const st = fakeStorage();
  const sent = [];
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Date, Promise, JSON, setInterval: () => 0,
    document: { createElement: (t) => holdEl(t) },
    addEventListener() {},
    LHG_SELECTORS: { weakId: (p, _e, t) => p + ':' + t },
    chrome: { storage: st, runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(m); cb({ alert: 'warn' }); } } },
  });
  ctx.globalThis = ctx;
  for (const f of ['i18n.js', 'settings.js', 'incoming.js']) vm.runInContext(read(f), ctx);
  let rows = [];
  const sc = ctx.LHG_INCOMING.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => true });
  sc.scan(); // baseline
  const live = holdEl();
  rows = [{ el: live, text: 'הודעה חדשה שעלולה להתפרש' }];
  sc.scan();
  await flush();
  await flush();
  assert.equal(sent.length, 1);
  const h = live.querySelector(':scope > .lhg-hold');
  assert.ok(h, 'held after a warning');
  assert.equal(h.getAttribute('dir'), 'ltr');
  assert.match(h.textContent, /Message hidden/);
  ctx.LHG_I18N.setLang('he');
  assert.match(live.querySelector(':scope > .lhg-hold').textContent, /ההודעה הוסתרה/, 'repainted in Hebrew');
  st.local.set({ lhgPlatforms: { 'whatsapp-web': true, gmail: true, 'google-chat': false } });
  assert.equal(sc.isActive(), false);
  assert.equal(live.querySelector(':scope > .lhg-hold'), null, 'released when switched off');
  assert.equal(live.querySelector(':scope > .lhg-tag'), null, 'no tag from a guard that is off');
  rows = [...rows, { el: holdEl(), text: 'עוד הודעה בזמן שהתוסף כבוי' }];
  sc.scan();
  await flush();
  assert.equal(sent.length, 1, 'nothing sent while off');
  st.local.set({ lhgPlatforms: { 'whatsapp-web': true, gmail: true, 'google-chat': true } });
  sc.scan(); // first scan after re-enabling = baseline
  await flush();
  assert.equal(sent.length, 1, 'what arrived while off is history, never a burst');
  const after = holdEl();
  rows = [...rows, { el: after, text: 'הודעה חדשה אחרי ההפעלה' }];
  sc.scan();
  assert.ok(after.querySelector(':scope > .lhg-hold'), 'a live message after re-enabling is held and checked again');
  assert.equal(sc.queueSize(), 1, 'queued for the (paced) check');
});

// --- background --------------------------------------------------------------

test('background: userNote (capped, one line) and the UI language reach POST /check', async () => {
  const bodies = [];
  let onMsg = null;
  const st = fakeStorage({ accessKey: 'k' });
  const ctx = vm.createContext({
    setTimeout, clearTimeout, AbortController, JSON, Promise,
    fetch: async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ alert: 'none' }) }; },
    chrome: { storage: st, runtime: { onMessage: { addListener: (fn) => { onMsg = fn; } } } },
  });
  ctx.globalThis = ctx;
  ctx.importScripts = (f) => vm.runInContext(read(f), ctx);
  vm.runInContext(read('background.js'), ctx);
  const ask = (m) => new Promise((resolve) => onMsg({ type: 'lhg-check', text: 'טקסט', direction: 'outgoing', ...m }, null, resolve));
  await ask({ userNote: 'line one\nline two ' + 'y'.repeat(700) });
  await ask({ userNote: '   ' });
  await ask({ userNote: 42 });
  st.local.set({ lhgLang: 'he' });
  await ask({});
  assert.equal(bodies[0].userNote.length, 500);
  assert.ok(bodies[0].userNote.startsWith('line one line two'));
  assert.equal('userNote' in bodies[1], false);
  assert.equal('userNote' in bodies[2], false);
  assert.equal(bodies[0].lang, 'en', 'English by default');
  assert.equal(bodies[3].lang, 'he');
});

// --- manifest / pages --------------------------------------------------------

test('manifest: i18n.js and settings.js load first everywhere; the action opens the quick popup', () => {
  const m = JSON.parse(read('manifest.json'));
  for (const cs of m.content_scripts) {
    assert.deepEqual(cs.js.slice(0, 2), ['i18n.js', 'settings.js']);
  }
  assert.equal(m.action.default_popup, 'popup.html');
  assert.equal(m.options_page, 'options.html');
  for (const page of ['options.html', 'popup.html']) {
    const html = read(page);
    const order = ['i18n.js', 'settings.js', 'options.js'].map((s) => html.indexOf('src="' + s + '"'));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], page);
    for (const id of ['enabled', 'hideIncoming', 'langToggle', 'openPanel']) assert.ok(html.includes('id="' + id + '"'), page + ' #' + id);
    for (const p of ['whatsapp-web', 'gmail', 'google-chat']) assert.ok(html.includes('data-platform="' + p + '"'), page + ' ' + p);
  }
  assert.ok(read('options.html').includes('id="accessKey"'));
});
