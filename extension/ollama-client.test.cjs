const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./ollama-client.js');
const { create, parse, scoreKeys, MODELS } = globalThis.LHG_OLLAMA_CLIENT;
const id = 'extractor-7b-q4';
const reply = data => ({ ok: true, text: async () => JSON.stringify(data) });
test('loopback-only raw request with no credentials or redirects', async () => {
  const client = create({ fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, MODELS[id]); assert.equal(body.raw, true);
    assert.equal(body.logprobs, true);
    return reply({ done: true, response: '{"verified":[true,"checked"]}' });
  } });
  assert.deepEqual(await client.generate(id, 'prompt'), { output: { verified: [true, 'checked'] }, scores: {} });
});
const toks = (parts) => parts.map(([token, p]) => ({ token, logprob: Math.log(p),
  bytes: Array.from(new TextEncoder().encode(token)) }));
test('scores come from the model token probabilities of key and value', () => {
  const lp = toks([['{"', 1], ['verified', 0.9], ['":[', 1], ['true', 0.8], [',"', 1], ['בדקתי', 1], ['"]', 1],
    [',"', 1], ['rumor', 0.4], ['":[', 1], ['false', 0.99], [',"x"]}', 1]]);
  const response = lp.map(t => t.token).join('');
  const s = scoreKeys(response, lp);
  assert.ok(Math.abs(s.verified - 0.8) < 1e-9);
  assert.ok(Math.abs(s.rumor - 0.4) < 1e-9);
});
test('scores fail closed when logprobs are missing or misaligned', () => {
  assert.deepEqual(scoreKeys('{"a":[true,"x"]}', undefined), {});
  const lp = toks([['{"', 1], ['a', 0.9], ['":[', 1], ['true', 0.9], [',"x"]}', 1]]);
  assert.deepEqual(scoreKeys('{"a":[false,"x"]}', lp), {});
  assert.deepEqual(scoreKeys('{"a":[true,"x"]} ', lp), {});
  const dup = toks([['{"a":[', 0.9], ['true', 0.9], [',"x"],"a":[', 1], ['true', 0.9], [',"x"]}', 1]]);
  assert.deepEqual(scoreKeys(dup.map(t => t.token).join(''), dup), {});
});
test('a generation cut by the token limit is rejected', async () => {
  await assert.rejects(create({ fetchImpl: async () => reply({ done: true, done_reason: 'length', response: '{}' }) })
    .generate(id, 'p'), /ollama_token_limit/);
});
test('availability requires installed exact model', async () => {
  assert.equal(await create({ fetchImpl: async () => reply({ models: [] }) }).available(id), false);
  assert.equal(await create({ fetchImpl: async () => reply({ models: [{ name: MODELS[id] }] }) }).available(id), true);
});
test('an installed e8 model cannot satisfy the v2 engine or setup inspection', async () => {
  const client = create({ fetchImpl: async () => reply({ models: [
    { name: 'hf.co/yonicc/lhg-extractor-qwen7b-gguf:Q4_K_M' },
  ] }) });
  assert.equal(await client.available(id), false);
  assert.equal((await client.inspect())[id], false);
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
