const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./check-mode.js');
require('./ollama-client.js');
require('./ollama-setup.js');
const { create } = globalThis.LHG_OLLAMA_CLIENT;
const setup = globalThis.LHG_OLLAMA_SETUP.create;
const mode = globalThis.LHG_CHECK_MODE;
const signal = () => new AbortController().signal;
const response = strings => ({ ok: true, body: new ReadableStream({
  start(c) { strings.forEach(s => c.enqueue(new TextEncoder().encode(s))); c.close(); },
}) });
test('pull uses allow-listed loopback model and parses fragmented NDJSON progress', async () => {
  const updates = [];
  const client = create({ fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/pull');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.deepEqual(JSON.parse(init.body), { model: globalThis.LHG_OLLAMA_CLIENT.MODELS['dictalm-q4'], stream: true });
    return response(['{"total":100,"com', 'pleted":42}\n{"status":"success"}']);
  } });
  await client.pull('dictalm-q4', x => updates.push(x), signal());
  assert.equal(updates[0].percent, 42);
  await assert.rejects(client.pull('arbitrary-remote-model', () => {}, signal()), /unknown/);
});
test('pull rejects error, truncated completion, malformed and oversized progress', async () => {
  for (const text of ['{"error":"no disk"}\n', '{"status":"pulling"}\n', 'bad\n', 'x'.repeat(65537)]) {
    const client = create({ fetchImpl: async () => response([text]) });
    await assert.rejects(client.pull('dictalm-q4', () => {}, signal()));
  }
});
test('pull cancellation aborts actual fetch', async () => {
  const abort = new AbortController();
  const client = create({ fetchImpl: (u, init) => new Promise((r, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  const pending = client.pull('dictalm-q4', () => {}, abort.signal);
  abort.abort();
  await assert.rejects(pending, /aborted/);
});
test('setup pulls missing models only, probes each union member and does not change preferences', async () => {
  const events = [], ids = mode.LOCAL_ENGINES['local-union'];
  const service = setup({ mode, client: {
    inspect: async () => ({ [ids[0]]: true }),
    pull: async id => events.push('pull:' + id),
  }, probe: async id => { events.push('probe:' + id); return { alert: 'unsure' }; } });
  const result = await service.install('local-union', () => {}, signal());
  assert.equal(result.ready, true);
  assert.deepEqual(events, ['pull:' + ids[1], ...ids.map(id => 'probe:' + id)]);
});
test('setup fails closed on invalid mode, inference failure, cancellation or concurrent install', async () => {
  const service = setup({ mode, client: { inspect: async () => ({}) , pull: async () => {} },
    probe: async () => ({ alert: 'not_checked' }) });
  await assert.rejects(service.install('cloud', () => {}, signal()));
  await assert.rejects(service.install('local-fast', () => {}, signal()), /probe/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(service.install('local-fast', () => {}, abort.signal), /cancelled/);
  let release;
  const waiting = setup({ mode, client: { inspect: () => new Promise(r => { release = r; }), pull: async () => {} },
    probe: async () => ({ alert: 'unsure' }) });
  const first = waiting.install('local-fast', () => {}, signal());
  await assert.rejects(waiting.install('local-fast', () => {}, signal()), /busy/);
  release({}); await first;
});
test('union setup cannot hide a failed second engine behind a warning from the first', async () => {
  const ids = mode.LOCAL_ENGINES['local-union'];
  for (const bad of [{ alert: 'not_checked' }, {}, { alert: 'warn', rules: { notChecked: true } }]) {
    const service = setup({ mode, client: { inspect: async () => Object.fromEntries(ids.map(id => [id, true])) },
      probe: async id => id === ids[0] ? { alert: 'warn' } : bad });
    await assert.rejects(service.install('local-union', () => {}, signal()), /probe_failed/);
  }
});
test('setup messages are restricted to the exact setup extension page', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  let connect, inspected = 0, listener;
  const ctx = vm.createContext({
    LHG_OLLAMA_CLIENT: { create: () => ({ inspect: () => { inspected++; return Promise.resolve({}); } }) },
    LHG_CHECK_MODE: mode, LHG_OLLAMA_ENGINE: {},
    chrome: { runtime: { getURL: file => 'chrome-extension://test/' + file,
      onConnect: { addListener: fn => { connect = fn; } } } },
  });
  vm.runInContext(fs.readFileSync(__dirname + '/ollama-setup.js', 'utf8'), ctx);
  const port = url => ({ name: 'lhg-ollama-setup', sender: { url },
    onDisconnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, postMessage() {} });
  connect(port('https://mail.google.com/')); assert.equal(listener, undefined);
  connect(port('chrome-extension://test/options.html')); assert.equal(listener, undefined);
  connect(port('chrome-extension://test/ollama-setup.html'));
  assert.equal(typeof listener, 'function'); listener({ action: 'inspect' }); assert.equal(inspected, 1);
});
