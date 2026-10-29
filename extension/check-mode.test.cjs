// Check mode (cloud / local) and cloud model choice: check-mode.js + background.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v)); // across vm realms

function modeModule() {
  const c = vm.createContext({});
  c.globalThis = c;
  vm.runInContext(src('check-mode.js'), c);
  return c.LHG_CHECK_MODE;
}

const REQ = { text: 'synthetic', platform: 'gmail', direction: 'outgoing' };
function cloudSpy(result = { alert: 'none' }) {
  const calls = [];
  return { calls, fn: async (model) => { calls.push(model); return result; } };
}
const engine = (id, check, available = async () => true) => ({ id, check, available });

test('check-mode: defaults are cloud, no fallback, default model; junk normalizes to defaults', () => {
  const M = modeModule();
  assert.deepEqual(plain(M.normalize(undefined)),
    { lhgCheckMode: 'cloud', lhgCloudFallback: false, lhgCloudModel: 'muse-spark-open-1026' });
  assert.deepEqual(plain(M.normalize({ lhgCheckMode: 'local-x', lhgCloudFallback: 'yes', lhgCloudModel: 'evil' })),
    { lhgCheckMode: 'cloud', lhgCloudFallback: false, lhgCloudModel: 'muse-spark-open-1026' });
  assert.equal(M.CLOUD_MODELS.length, 12);
  assert.equal(new Set(M.CLOUD_MODELS.map((m) => m.id)).size, 12);
  assert.equal(M.modelParam({}), null);
  assert.equal(M.modelParam({ lhgCloudModel: 'claude-haiku-5.5' }), 'claude-haiku-5.5');
  assert.equal(M.modelParam({ lhgCloudModel: 'muse-spark-1.3' }), 'muse-spark-1.3'); // no longer the default
});

test('check-mode: the old stored default moves to Baseten exactly once', () => {
  const M = modeModule();
  assert.deepEqual(plain(M.migrateDefault({ lhgCloudModel: 'muse-spark-1.3' })),
    { lhgCloudDefaultV: 2, lhgCloudModel: 'muse-spark-open-1026' });
  assert.deepEqual(plain(M.migrateDefault({ lhgCloudModel: 'claude-haiku-5.5' })), { lhgCloudDefaultV: 2 });
  assert.deepEqual(plain(M.migrateDefault({})), { lhgCloudDefaultV: 2 });
  // After the marker, choosing 1.3 again is respected.
  assert.equal(M.migrateDefault({ lhgCloudModel: 'muse-spark-1.3', lhgCloudDefaultV: 2 }), null);
});

test('check-mode: cloud sends the chosen model, and nothing for the default', async () => {
  const M = modeModule();
  const s = cloudSpy();
  await M.route(REQ, {}, s.fn);
  await M.route(REQ, { lhgCloudModel: 'gemini-3.7-flash' }, s.fn);
  assert.deepEqual(s.calls, [null, 'gemini-3.7-flash']);
});

test('check-mode: a local mode without an installed model is not_checked and never reaches the cloud', async () => {
  const M = modeModule();
  for (const mode of ['local-fast', 'local-hebrew', 'local-union']) {
    const s = cloudSpy();
    const r = await M.route(REQ, { lhgCheckMode: mode }, s.fn);
    assert.equal(r.alert, 'not_checked');
    assert.equal(r.error, 'local_unavailable');
    assert.equal(s.calls.length, 0);
  }
  assert.deepEqual(plain(await M.status()), { 'local-fast': false, 'local-hebrew': false, 'local-union': false });
});

test('check-mode: with fallback chosen, a missing local model goes to the cloud (marked)', async () => {
  const M = modeModule();
  const s = cloudSpy({ alert: 'warn' });
  const r = await M.route(REQ, { lhgCheckMode: 'local-hebrew', lhgCloudFallback: true, lhgCloudModel: 'claude-haiku-5.5' }, s.fn);
  assert.equal(r.alert, 'warn');
  assert.equal(r.checkedBy, 'cloud-fallback');
  assert.deepEqual(s.calls, ['claude-haiku-5.5']);
});

test('check-mode: union is the most cautious answer; a failed engine never yields none', async () => {
  const M = modeModule();
  const s = cloudSpy();
  const set = (a, b) => {
    M.registerLocalEngine(engine('extractor-7b-q4', a));
    M.registerLocalEngine(engine('dictalm-q4', b));
  };
  const union = { lhgCheckMode: 'local-union' };
  set(async () => ({ alert: 'none' }), async () => ({ alert: 'warn', mechanism: 'irony' }));
  let r = await M.route(REQ, union, s.fn);
  assert.equal(r.alert, 'warn'); assert.equal(r.mechanism, 'irony'); assert.equal(r.checkedBy, 'local');
  set(async () => ({ alert: 'none' }), async () => { throw new Error('boom'); });
  r = await M.route(REQ, union, s.fn);
  assert.equal(r.alert, 'not_checked');
  set(async () => ({ alert: 'none' }), async () => ({ alert: 'whatever' }));
  r = await M.route(REQ, union, s.fn);
  assert.equal(r.alert, 'not_checked');
  set(async () => ({ alert: 'unsure' }), async () => ({ alert: 'none' }));
  r = await M.route(REQ, union, s.fn);
  assert.equal(r.alert, 'unsure');
  set(async () => ({ alert: 'none' }), async () => ({ alert: 'none' }));
  r = await M.route(REQ, union, s.fn);
  assert.equal(r.alert, 'none');
  assert.equal(s.calls.length, 0);
  // Local failure + fallback: the cloud answers.
  set(async () => { throw new Error('boom'); }, async () => ({ alert: 'none' }));
  r = await M.route(REQ, { ...union, lhgCloudFallback: true }, s.fn);
  assert.equal(r.checkedBy, 'cloud-fallback');
  assert.equal(s.calls.length, 1);
});

test('check-mode: an engine whose available() throws or is false counts as not installed', async () => {
  const M = modeModule();
  const s = cloudSpy();
  M.registerLocalEngine(engine('dictalm-q4', async () => ({ alert: 'none' }), async () => { throw new Error('x'); }));
  assert.equal((await M.route(REQ, { lhgCheckMode: 'local-hebrew' }, s.fn)).error, 'local_unavailable');
  M.registerLocalEngine(engine('dictalm-q4', async () => ({ alert: 'none' }), async () => false));
  assert.equal((await M.route(REQ, { lhgCheckMode: 'local-hebrew' }, s.fn)).alert, 'not_checked');
  M.registerLocalEngine(engine('dictalm-q4', async () => ({ alert: 'none' })));
  assert.equal((await M.route(REQ, { lhgCheckMode: 'local-hebrew' }, s.fn)).alert, 'none');
  assert.throws(() => M.registerLocalEngine({ id: 'x' }));
});

// --- background.js wiring ------------------------------------------------------
function worker(prefs, store = {}) {
  let handler;
  const sent = [];
  const c = vm.createContext({
    crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, AbortController,
    chrome: { storage: { local: {
      get: async (key) => (Array.isArray(key) ? { accessKey: 'synthetic-key', ...prefs } : { [key]: store[key] }),
      set: async (value) => Object.assign(store, value),
      remove: async () => {},
    } }, runtime: { onMessage: { addListener: (fn) => { handler = fn; } } } },
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ alert: 'none' }) };
    },
  });
  c.globalThis = c;
  vm.runInContext(src('check-mode.js'), c);
  vm.runInContext(src('background.js'), c);
  const ask = (extra) => new Promise((resolve) => handler({
    type: 'lhg-check', platform: 'gmail', direction: 'outgoing', text: 'synthetic message',
    cacheIdentity: { accountId: 'one@example.test', conversationId: 'thread-a' }, ...extra,
  }, {}, resolve));
  return { ask, sent, store, handler: () => handler };
}

test('background: default model sends no `model` field; a chosen model is sent as its id', async () => {
  const d = worker({});
  await d.ask({});
  assert.equal('model' in d.sent[0], false);
  const k = worker({ lhgCloudModel: 'claude-haiku-5.5' });
  await k.ask({});
  assert.equal(k.sent[0].model, 'claude-haiku-5.5');
});

test('background: switching model is a cache miss', async () => {
  const store = {};
  const a = worker({}, store);
  await a.ask({});
  const b = worker({ lhgCloudModel: 'gpt-5.4-mini' }, store);
  await b.ask({});
  assert.equal(b.sent.length, 1);
});

test('background: local mode without model sends nothing and caches nothing; fallback result is not cached', async () => {
  const l = worker({ lhgCheckMode: 'local-fast' });
  const r = await l.ask({});
  assert.equal(r.alert, 'not_checked');
  assert.equal(r.error, 'local_unavailable');
  assert.equal(l.sent.length, 0);
  assert.equal(Object.keys(l.store).length, 0);
  const f = worker({ lhgCheckMode: 'local-fast', lhgCloudFallback: true });
  const rf = await f.ask({});
  assert.equal(rf.checkedBy, 'cloud-fallback');
  assert.equal(f.sent.length, 1);
  assert.equal(Object.keys(f.store).length, 0);
});

test('background: options asks which local modes can run', async () => {
  const w = worker({});
  const r = await new Promise((resolve) => w.handler()({ type: 'lhg-check-mode-status' }, {}, resolve));
  assert.deepEqual(plain(r), { 'local-fast': false, 'local-hebrew': false, 'local-union': false });
});

// --- texts ---------------------------------------------------------------------
test('i18n: every check-mode string exists in English and Hebrew', () => {
  const c = vm.createContext({});
  c.globalThis = c;
  vm.runInContext(src('i18n.js'), c);
  const I = c.LHG_I18N;
  const keys = new Set(['notChecked.local', 'mode.useCloud']);
  for (const f of ['options.html', 'popup.html']) {
    for (const m of src(f).matchAll(/data-i18n="(mode\.[^"]+)"/g)) keys.add(m[1]);
  }
  for (const m of src('options.js').matchAll(/'(mode\.[A-Za-z-]+)'/g)) keys.add(m[1]);
  const M = modeModule();
  for (const mode of M.MODES) keys.add('mode.' + mode);
  assert.ok(keys.size >= 15, [...keys].join(','));
  for (const lang of ['en', 'he']) {
    I.setLang(lang, { persist: false });
    for (const k of keys) assert.notEqual(I.t(k, { m: 'X' }), k, lang + ':' + k);
  }
  I.setLang('he', { persist: false });
  assert.match(I.t('mode.notInstalled'), /לא מותקן/);
});
