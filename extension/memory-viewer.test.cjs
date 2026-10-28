// Local memory viewer: admin views in memory.mjs, the sender gate in
// memory-background.js, and the masked-by-default page (memory-viewer.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fakeIndexedDB } = require('./fake-idb.testlib.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 5));
const DAY = 86400000;

// Deterministic synthetic embedding: topic words pick a dimension.
function embed(text) {
  const v = new Array(384).fill(0);
  v[383] = 0.05;
  if (/garage/.test(text)) v[0] = 1;
  if (/school/.test(text)) v[1] = 1;
  if (/x{50}/.test(text)) v[2] = 1;
  return v;
}
const scope = (platform, conv, account = 'a@example.invalid') => ({ platform, accountId: account, conversationId: conv });

async function seeded() {
  globalThis.indexedDB = fakeIndexedDB();
  const { LocalMemory } = await import('./memory.mjs');
  let now = 10 * DAY;
  const m = new LocalMemory({ name: 'viewer-test', embed: async (t) => embed(t), now: () => now });
  const put = (sc, id, text, at, type = 'context_observed', direction = 'incoming') =>
    m.ingest({ enabled: true, scope: sc, sourceId: id, text, type, direction, observedAt: at });
  await put(scope('gmail', 't1'), 'm1', 'the garage bill is late', now - 3 * DAY);
  await put(scope('gmail', 't1'), 'm2', 'school trip on sunday', now - 2 * DAY, 'input_observed', 'outgoing');
  await put(scope('gmail', 't2'), 'm3', 'garage again', now - DAY);
  await put(scope('whatsapp-web', 'j1', '1@c.us'), 'w1', 'x'.repeat(2500), now - DAY / 2);
  await put(scope('google-chat', 'g1'), 'old', 'expired garage', now - 13.9 * DAY);
  now += DAY / 5; // 'old' crosses the 14-day line
  return { m, setNow: (v) => { now = v; }, now: () => now };
}
const noVectors = (o) => assert.doesNotMatch(JSON.stringify(o), /embedding/i, 'vectors never leave the vault');

test('memory admin: stats count per platform and conversation, skip expired rows, carry no vectors', async () => {
  const { m } = await seeded();
  const s = await m.stats();
  noVectors(s);
  assert.equal(s.messages, 4);
  assert.equal(s.conversations, 3);
  assert.equal(s.chunks, 1 + 1 + 1 + 3, '2,500 chars = 3 chunks of 1,000');
  assert.equal(s.chars, 23 + 21 + 12 + 2500);
  assert.equal(s.byPlatform.gmail.messages, 3);
  assert.equal(s.byPlatform.gmail.conversations, 2);
  assert.equal(s.byPlatform['whatsapp-web'].chunks, 3);
  assert.equal(s.byPlatform['google-chat'].messages, 0, 'the expired row is not counted');
  assert.ok(s.oldest < s.newest);
  assert.deepEqual(s.conversationList.map((c) => c.scope.conversationId), ['j1', 't2', 't1'], 'newest first');
});

test('memory admin: list pages newest first and filters by platform and scope, without vectors', async () => {
  const { m } = await seeded();
  const all = await m.list({ limit: 2 });
  noVectors(all);
  assert.equal(all.total, 4);
  assert.deepEqual(all.items.map((i) => i.ref), ['w1', 'm3']);
  assert.deepEqual((await m.list({ offset: 2, limit: 2 })).items.map((i) => i.ref), ['m2', 'm1']);
  const gmail = await m.list({ platform: 'gmail' });
  assert.equal(gmail.total, 3);
  const t1 = await m.list({ scope: scope('gmail', 't1') });
  assert.deepEqual(t1.items.map((i) => i.ref), ['m2', 'm1']);
  assert.equal(t1.items[0].kind, 'draft');
  assert.equal(t1.items[0].direction, 'outgoing');
  assert.ok(t1.items[0].expiresAt > t1.items[0].observedAt);
  await assert.rejects(m.list({ platform: 'evil.example' }), /invalid-platform/);
  await assert.rejects(m.list({ limit: 1000 }), /invalid-page/);
  await assert.rejects(m.list({ scope: { platform: 'gmail' } }), /scope-required/);
});

test('memory admin: search ranks by cosine across all scopes or inside the chosen one', async () => {
  const { m } = await seeded();
  const hits = await m.search({ query: 'garage' });
  noVectors(hits);
  assert.deepEqual(hits.slice(0, 2).map((h) => h.ref).sort(), ['m1', 'm3'], 'both garage rows lead, across conversations');
  assert.ok(hits[0].score > 0.9 && hits[0].score <= 1.0001);
  assert.ok(hits[0].score > hits[hits.length - 1].score);
  assert.ok(!hits.some((h) => h.ref === 'old'), 'expired rows are never searched');
  const inT2 = await m.search({ query: 'garage', scope: scope('gmail', 't2') });
  assert.deepEqual(inT2.map((h) => h.ref), ['m3']);
  const long = await m.search({ query: 'x'.repeat(60), platform: 'whatsapp-web' });
  assert.equal(long[0].ref, 'w1');
  assert.equal(long[0].match.length, 1000, 'the best chunk is returned as the match');
  await assert.rejects(m.search({ query: '  ' }), /invalid-query/);
});

test('memory admin: deleting one entry and a whole conversation removes text and vectors together', async () => {
  const { m } = await seeded();
  await m.deleteMessage(scope('gmail', 't1'), 'm1');
  assert.deepEqual((await m.list({ scope: scope('gmail', 't1') })).items.map((i) => i.ref), ['m2']);
  await m.deleteConversation(scope('gmail', 't1'));
  assert.equal((await m.list({ scope: scope('gmail', 't1') })).total, 0);
  assert.equal((await m.stats()).messages, 2);
  assert.throws(() => m.deleteMessage(scope('gmail', 't2'), ''), /stable-source-id-required/);
});

// --- background gate ---------------------------------------------------------

function background() {
  const ID = 'extid';
  const relayed = [];
  let listener;
  const store = { lhgMemoryEnabled: true };
  const chrome = {
    runtime: {
      id: ID,
      getURL: (p) => 'chrome-extension://' + ID + '/' + p,
      getContexts: async () => [{}], // offscreen already exists
      sendMessage: async (m) => { relayed.push(m); return { ok: true, result: { op: m.op } }; },
      onMessage: { addListener: (fn) => { listener = fn; } },
    },
    offscreen: { createDocument: async () => {} },
    storage: { local: { get: async () => store } },
  };
  const ctx = vm.createContext({ chrome, console: { warn() {} }, setTimeout, URL, Promise });
  vm.runInContext(read('memory-background.js'), ctx);
  const send = (m, sender) => new Promise((resolve) => listener({ type: 'lhg-memory', ...m }, sender, resolve));
  const page = (p) => ({ id: ID, url: chrome.runtime.getURL(p), tab: { id: 1, incognito: false } });
  const site = { id: ID, url: 'https://mail.google.com/mail/u/0/', tab: { id: 2, incognito: false } };
  return { send, page, site, relayed, ID };
}

test('background: viewer operations are refused from a site content script, even with a valid scope', async () => {
  const b = background();
  const sc = scope('gmail', 't1');
  for (const op of ['stats', 'list', 'search', 'delete_message', 'delete_conversation']) {
    const r = await b.send({ op, scope: sc, sourceId: 'm1', args: { query: 'garage' } }, b.site);
    assert.deepEqual({ ...r }, { ok: false, error: 'memory-unavailable' }, op);
    for (const p of ['popup.html', 'options.html#x', 'memory-viewer.html?evil=1']) {
      const r2 = await b.send({ op }, b.page(p));
      assert.equal(r2.ok, false, op + ' from ' + p);
    }
    const r3 = await b.send({ op }, { id: 'other-extension', url: 'chrome-extension://extid/memory-viewer.html' });
    assert.equal(r3.ok, false, op + ' from another extension');
  }
  assert.equal(b.relayed.length, 0, 'nothing reached the vault');
});

test('background: the viewer page and options page may read, search and delete; the site keeps its own scoped delete', async () => {
  const b = background();
  const sc = scope('gmail', 't1');
  for (const p of ['memory-viewer.html', 'options.html']) {
    for (const op of ['stats', 'list', 'search', 'delete_message', 'delete_conversation']) {
      const r = await b.send({ op, scope: sc, sourceId: 'm1', args: { limit: 5 } }, b.page(p));
      assert.equal(r.ok, true, op + ' from ' + p);
    }
  }
  assert.equal(b.relayed.length, 10);
  assert.deepEqual({ ...b.relayed[4].scope }, sc);
  assert.equal(b.relayed[3].sourceId, 'm1');
  const own = await b.send({ op: 'delete', scope: sc, sourceId: 'draft' }, b.site);
  assert.equal(own.ok, true, 'cleared draft on its own site still deletes');
  const viewerIngest = await b.send({ op: 'ingest', event: { scope: sc } }, b.page('memory-viewer.html'));
  assert.equal(viewerIngest.ok, false, 'the viewer cannot forge DOM ingestion');
  const viewerClear = await b.send({ op: 'clear' }, b.page('memory-viewer.html'));
  assert.equal(viewerClear.ok, false, 'clear-all stays on the options page');
});

// --- viewer page -------------------------------------------------------------

function fakeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), className: '', children: [], listeners: {}, attrs: {}, hidden: false, disabled: false,
    value: '', title: '', type: '', _tc: '',
    set textContent(v) { this._tc = String(v); this.children = []; },
    get textContent() { return this._tc + this.children.map((c) => c.textContent).join(''); },
    appendChild(c) { this.children.push(c); if (this.tagName === 'SELECT' && this.children.length === 1 && !this.value) this.value = c.value; return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  };
}
const click = async (el, ev = {}) => { for (const fn of el.listeners.click || []) await fn(ev); await tick(); };

function viewer({ items, enabled = true, lang = 'en', confirmAnswer = true } = {}) {
  const ids = ['langToggle', 'viewerNotice', 'statsLine', 'statsRange', 'statsPlatforms', 'refresh', 'platformFilter',
    'conversationFilter', 'deleteConversation', 'searchQuery', 'searchBtn', 'searchClear', 'toggleAll', 'pageInfo',
    'prevPage', 'nextPage', 'viewerStatus', 'entries'];
  const els = Object.fromEntries(ids.map((id) => [id, fakeElement(/Filter$/.test(id) ? 'select' : 'div')]));
  const sent = [];
  const confirms = [];
  const sc = scope('gmail', 't1');
  const stats = { messages: items.length, conversations: 1, chunks: items.length, chars: 10, oldest: 1, newest: 2,
    byPlatform: { gmail: { messages: items.length, conversations: 1 }, 'google-chat': { messages: 0 }, 'whatsapp-web': { messages: 0 } },
    conversationList: [{ scope: sc, messages: items.length, chars: 10, newest: 2 }] };
  const storage = { lhgMemoryEnabled: enabled, lhgLang: lang };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Promise, JSON, Date, Set, Map,
    document: { getElementById: (id) => els[id], createElement: fakeElement, querySelectorAll: () => [], documentElement: null, title: '' },
    Option: function Option(text, value) { const o = fakeElement('option'); o.textContent = text; o.value = value; return o; },
    confirm: (q) => { confirms.push(q); return confirmAnswer; },
    chrome: {
      storage: { local: { get: (k, cb) => { const o = { ...storage }; if (cb) cb(o); else return Promise.resolve(o); }, set() {} }, onChanged: { addListener() {} } },
      runtime: {
        sendMessage: async (m) => {
          sent.push(JSON.parse(JSON.stringify(m)));
          if (m.op === 'stats') return { ok: true, result: stats };
          if (m.op === 'list') return { ok: true, result: { total: items.length, offset: 0, limit: 50, items } };
          return { ok: true, result: {} };
        },
      },
    },
  });
  ctx.globalThis = ctx;
  for (const f of ['i18n.js', 'settings.js', 'memory-viewer.js']) vm.runInContext(read(f), ctx);
  return { ctx, els, sent, confirms, V: ctx.LHG_MEMORY_VIEWER };
}
const SECRET = 'synthetic secret about the garage';
const item = (ref, text = SECRET) => ({ ref, scope: scope('gmail', 't1'), text, chars: text.length, chunks: 1, kind: 'message',
  direction: 'incoming', observedAt: 1, expiresAt: 2 });
const texts = (els) => els.entries.children.map((row) => row.children[1]);

test('viewer: text is masked by default, one click reveals one entry, "Show all" is not kept across loads', async () => {
  const v = viewer({ items: [item('a'), item('b')] });
  await v.V.started;
  await tick();
  assert.equal(v.els.entries.children.length, 2);
  assert.doesNotMatch(v.els.entries.textContent, /secret/, 'nothing readable before a click');
  assert.ok(texts(v.els).every((t) => /masked/.test(t.className) && t.textContent === v.V.MASK));
  await click(texts(v.els)[0]);
  assert.equal(texts(v.els)[0].textContent, SECRET);
  assert.equal(texts(v.els)[1].textContent, v.V.MASK, 'the other entry stays hidden');
  assert.equal(v.els.toggleAll.textContent, 'Show all text');
  await click(v.els.toggleAll);
  assert.ok(texts(v.els).every((t) => t.textContent === SECRET));
  assert.equal(v.els.toggleAll.textContent, 'Hide all text');
  assert.ok(!v.sent.some((m) => m.op === 'set' || /show/i.test(JSON.stringify(m))), 'the choice is not stored');
  const again = viewer({ items: [item('a')] });
  await again.V.started;
  await tick();
  assert.equal(texts(again.els)[0].textContent, again.V.MASK, 'a reload starts hidden again');
  assert.match(v.els.statsLine.textContent, /2 entries in 1 conversations/);
  assert.match(v.els.entries.children[0].children[0].textContent, /Message · incoming · Gmail/);
});

test('viewer: memory off and a missing model each show a clear notice; Hebrew comes from i18n', async () => {
  const v = viewer({ items: [], enabled: false, lang: 'he' });
  await v.V.started;
  await tick();
  assert.equal(v.els.viewerNotice.hidden, false);
  assert.match(v.els.viewerNotice.textContent, /הזיכרון המקומי כבוי/);
  assert.match(v.els.viewerNotice.textContent, /מודל החיפוש המקומי לא מותקן/, 'no model in node: search is unavailable');
  assert.equal(v.els.searchBtn.disabled, true);
  assert.match(v.els.pageInfo.textContent, /אין שום דבר שמור/);
});

test('viewer: deleting asks first; cancel sends nothing, confirm deletes that entry or the chosen conversation', async () => {
  const no = viewer({ items: [item('a')], confirmAnswer: false });
  await no.V.started;
  await tick();
  await click(no.els.entries.children[0].children[2]);
  assert.equal(no.confirms.length, 1);
  assert.ok(!no.sent.some((m) => m.op === 'delete_message'));
  const yes = viewer({ items: [item('a')] });
  await yes.V.started;
  await tick();
  await click(yes.els.entries.children[0].children[2]);
  const del = yes.sent.find((m) => m.op === 'delete_message');
  assert.deepEqual(del.scope, scope('gmail', 't1'));
  assert.equal(del.sourceId, 'a');
  assert.equal(yes.els.deleteConversation.disabled, true, 'no conversation chosen yet');
  yes.els.conversationFilter.value = JSON.stringify(['gmail', 'a@example.invalid', 't1']);
  for (const fn of yes.els.conversationFilter.listeners.change) await fn();
  await tick();
  assert.equal(yes.els.deleteConversation.disabled, false);
  const list = yes.sent.filter((m) => m.op === 'list').pop();
  assert.deepEqual(list.args.scope, scope('gmail', 't1'), 'the list follows the chosen conversation');
  await click(yes.els.deleteConversation);
  assert.match(yes.confirms.pop(), /Delete all 1 stored entries/);
  assert.deepEqual(yes.sent.find((m) => m.op === 'delete_conversation').scope, scope('gmail', 't1'));
});
