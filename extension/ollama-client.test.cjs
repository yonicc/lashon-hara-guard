const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./ollama-client.js');
const { create, parse, MODELS } = globalThis.LHG_OLLAMA_CLIENT;
const id = 'extractor-7b-q4';
const reply = data => ({ ok: true, text: async () => JSON.stringify(data) });
test('loopback-only raw request with no credentials or redirects', async () => {
  const client = create({ fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, MODELS[id]); assert.equal(body.raw, true);
    return reply({ done: true, response: '{"verified":[true,"checked"]}' });
  } });
  assert.deepEqual(await client.generate(id, 'prompt'), { verified: [true, 'checked'] });
});
test('availability requires installed exact model', async () => {
  assert.equal(await create({ fetchImpl: async () => reply({ models: [] }) }).available(id), false);
  assert.equal(await create({ fetchImpl: async () => reply({ models: [{ name: MODELS[id] }] }) }).available(id), true);
});
test('invalid and incomplete output fail closed', async () => {
  for (const s of ['null', '[]', 'not JSON']) assert.throws(() => parse(s));
  await assert.rejects(create({ fetchImpl: async () => reply({ done: false, response: '{}' }) }).generate(id, 'p'));
  await assert.rejects(create({ fetchImpl: async () => ({ ok: false, status: 500 }) }).generate(id, 'p'));
});
test('timeout aborts stalled request', async () => {
  const client = create({ timeoutMs: 10, fetchImpl: (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  await assert.rejects(client.generate(id, 'p'), /aborted/);
});
