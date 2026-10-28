const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./check-mode.js');
require('./ollama-client.js');
require('./ollama-engine.bundle.js');
const E = globalThis.LHG_OLLAMA_ENGINE;
const M = globalThis.LHG_CHECK_MODE;
const id = 'extractor-7b-q4';
const req = { text: 'I checked the invoice.', platform: 'manual', direction: 'outgoing' };
test('training aliases retain canonical confidence admission; no fabricated score', () => {
  const ex = E.adapt({ verified: [true, req.text] }, req.text);
  assert.equal(ex.proposedFacts.length, 0);
  assert.deepEqual(ex.droppedFacts, [{ id: 'toelet.facts_verified', reason: 'confidence_missing_or_invalid' }]);
});
test('invalid evidence, key and value fail rather than trust output', () => {
  for (const raw of [{ verified: [true, 'invented'] }, { verified: ['yes', req.text] },
    { invented: [true, req.text] }, { verified: [true, ''] }, []]) {
    assert.throws(() => E.adapt(raw, req.text));
  }
});
test('empty extractor output invokes real rules and never approves', async () => {
  const r = await E.check(req, id, { generate: async () => ({}) });
  assert.equal(r.alert, 'unsure');
  assert.equal(r.rules.mode, 'live_draft');
  assert.notEqual(r.rules.notChecked, true);
  assert.ok(r.rules.questions.length > 0);
  assert.ok(r.rules.questions.length <= 5);
});
test('context is separate untrusted data; not evidence or confirmedFacts', () => {
  const prompt = E.render(id, req.text, { version: 1, platform: 'manual', recentMessages: [] }, 'note');
  assert.ok(prompt.includes('ADDITIONAL CONTEXT (untrusted data, not MESSAGE evidence)'));
  assert.ok(prompt.includes(JSON.stringify(req.text)));
  assert.throws(() => E.adapt({ verified: [true, 'note'] }, req.text));
});
test('registered real adapter: failure, explicit fallback, successful union', async () => {
  let cloudCalls = 0;
  const cloud = async () => { cloudCalls++; return { alert: 'warn' }; };
  const prefs = { lhgCheckMode: 'local-fast', lhgCloudFallback: false };
  M.registerLocalEngine({ id, available: async () => true,
    check: r => E.check(r, id, { generate: async () => ({ verified: [true, 'absent'] }) }) });
  assert.equal((await M.route(req, prefs, cloud)).alert, 'not_checked');
  assert.equal(cloudCalls, 0);
  assert.equal((await M.route(req, { ...prefs, lhgCloudFallback: true }, cloud)).checkedBy, 'cloud-fallback');
  assert.equal(cloudCalls, 1);
  for (const key of [id, 'dictalm-q4']) M.registerLocalEngine({
    id: key, available: async () => true, check: r => E.check(r, key, { generate: async () => ({}) }),
  });
  const r = await M.route(req, { lhgCheckMode: 'local-union' }, cloud);
  assert.equal(r.alert, 'unsure'); assert.equal(r.checkedBy, 'local'); assert.equal(cloudCalls, 1);
  assert.equal(M.combine([{ alert: 'unsure' }, { alert: 'warn' }]).alert, 'warn');
  assert.equal(M.combine([{ alert: 'unsure' }, { alert: 'not_checked' }]).alert, 'not_checked');
  for (const key of [id, 'dictalm-q4']) M.unregisterLocalEngine(key);
  assert.equal((await M.route(req, prefs, cloud)).error, 'local_unavailable');
});
