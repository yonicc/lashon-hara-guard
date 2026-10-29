const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./check-mode.js');
require('./ollama-client.js');
require('./ollama-engine.bundle.js');
const E = globalThis.LHG_OLLAMA_ENGINE;
const M = globalThis.LHG_CHECK_MODE;
const id = 'extractor-7b-q4';
const req = { text: 'I checked the invoice.', platform: 'manual', direction: 'outgoing' };
test('all 18 v2 facts reach catalog admission; user-only facts stay guarded; DictaLM stays v1', () => {
  const fs = require('node:fs'), path = require('node:path');
  const contract = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../research/local-extractor/', name)));
  const v2 = contract('contract_v2.json'), v1 = contract('contract.json');
  const raw = Object.fromEntries(v2.facts.map(([a]) => [a, [true, req.text]]));
  const scores = Object.fromEntries(v2.facts.map(([a]) => [a, 0.99]));
  const ex = E.adapt(raw, req.text, scores, id);
  assert.equal(ex.proposedFacts.length, 12);
  assert.equal(ex.droppedFacts.length, 6);
  assert.ok(ex.droppedFacts.every(f => f.reason === 'confirmed_by_user_only'));
  assert.deepEqual([...ex.proposedFacts, ...ex.droppedFacts].map(f => f.id).sort(), v2.facts.map(f => f[1]).sort());
  const dicta = E.adapt(raw, req.text, scores, 'dictalm-q4');
  assert.equal(dicta.proposedFacts.length, 8);
  assert.equal(dicta.invalidPairs.length, 10);
  const v1Instruction = E.render('dictalm-q4', req.text);
  assert.ok(v1Instruction.startsWith('<s>[INST] '));
  assert.ok(v1Instruction.includes('Allowed keys: ' + v1.facts.map(f => f[0]).join(', ') + '.'));
  assert.ok(!v1Instruction.includes('subject_self_disclosed:'));
  assert.ok(E.render(id, req.text).includes('subject_self_disclosed:'));
});
test('v2 scores and invalid pairs retain independent admission; follow-up needs still execute', async () => {
  const raw = { said_in_jest: [true, req.text], is_hint: [true, 'invented'], medium_written: [true, req.text] };
  const ex = E.adapt(raw, req.text, { said_in_jest: 0.99, is_hint: 0.99, medium_written: 0.2 }, id);
  assert.deepEqual(ex.proposedFacts.map(f => f.id), ['message.said_in_jest']);
  assert.equal(ex.invalidPairs[0].alias, 'is_hint');
  assert.equal(ex.droppedFacts[0].reason, 'confidence_below_threshold');
  const r = await E.check({ ...req, round: 2, routerHeads: ['mem_recent', 'mem_search'] }, id,
    { generate: async () => ({ output: raw, scores: { said_in_jest: 0.99 } }) });
  assert.equal(r.needs.round, 2);
  assert.notEqual(r.alert, 'none');
  assert.deepEqual(r.needs.requests.map(x => x.kind).sort(), ['get_recent', 'search_history']);
});
test('training aliases retain canonical confidence admission; no fabricated score', () => {
  const ex = E.adapt({ verified: [true, req.text] }, req.text);
  assert.equal(ex.proposedFacts.length, 0);
  assert.deepEqual(ex.droppedFacts, [{ id: 'toelet.facts_verified', reason: 'confidence_missing_or_invalid' }]);
});
test('model token probability is the score and passes the canonical threshold', () => {
  const ok = E.adapt({ verified: [true, req.text] }, req.text, { verified: 0.93 });
  assert.equal(ok.proposedFacts.length, 1);
  assert.equal(ok.proposedFacts[0].id, 'toelet.facts_verified');
  assert.equal(ok.proposedFacts[0].confidence, 0.93);
  const low = E.adapt({ verified: [true, req.text] }, req.text, { verified: 0.3 });
  assert.deepEqual(low.droppedFacts, [{ id: 'toelet.facts_verified', reason: 'confidence_below_threshold' }]);
  const bad = E.adapt({ verified: [true, req.text] }, req.text, { verified: 1.7 });
  assert.deepEqual(bad.droppedFacts, [{ id: 'toelet.facts_verified', reason: 'confidence_missing_or_invalid' }]);
});
test('an invalid pair is dropped alone; valid neighbours survive; non-objects fail', () => {
  for (const [raw, reason] of [[{ verified: [true, 'invented'] }, 'evidence_not_verbatim'],
    [{ verified: ['yes', req.text] }, 'invalid_pair'], [{ invented: [true, req.text] }, 'unknown_key'],
    [{ verified: [true, ''] }, 'invalid_pair']]) {
    const ex = E.adapt(raw, req.text, { verified: 0.99, invented: 0.99 });
    assert.equal(ex.proposedFacts.length, 0);
    assert.equal(ex.invalidPairs[0].reason, reason);
  }
  const mixed = E.adapt({ verified: [true, req.text], invented: [true, req.text] }, req.text,
    { verified: 0.95, invented: 0.95 });
  assert.equal(mixed.proposedFacts.length, 1);
  assert.deepEqual(mixed.invalidPairs, [{ alias: 'invented', reason: 'unknown_key' }]);
  for (const raw of [[], null, 'x']) assert.throws(() => E.adapt(raw, req.text));
});
test('empty extractor output invokes real rules and never approves', async () => {
  const r = await E.check(req, id, { generate: async () => ({ output: {}, scores: {} }) });
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
  const ex = E.adapt({ verified: [true, 'note'] }, req.text, { verified: 0.99 });
  assert.equal(ex.proposedFacts.length, 0);
  assert.equal(ex.invalidPairs[0].reason, 'evidence_not_verbatim');
});
test('registered real adapter: failure, explicit fallback, successful union', async () => {
  let cloudCalls = 0;
  const cloud = async () => { cloudCalls++; return { alert: 'warn' }; };
  const prefs = { lhgCheckMode: 'local-fast', lhgCloudFallback: false };
  M.registerLocalEngine({ id, available: async () => true,
    check: r => E.check(r, id, { generate: async () => ({ verified: [true, 'absent'] }) }) }); // legacy shape → fails closed
  assert.equal((await M.route(req, prefs, cloud)).alert, 'not_checked');
  assert.equal(cloudCalls, 0);
  assert.equal((await M.route(req, { ...prefs, lhgCloudFallback: true }, cloud)).checkedBy, 'cloud-fallback');
  assert.equal(cloudCalls, 1);
  for (const key of [id, 'dictalm-q4']) M.registerLocalEngine({
    id: key, available: async () => true, check: r => E.check(r, key, { generate: async () => ({ output: {}, scores: {} }) }),
  });
  const r = await M.route(req, { lhgCheckMode: 'local-union' }, cloud);
  assert.equal(r.alert, 'unsure'); assert.equal(r.checkedBy, 'local'); assert.equal(cloudCalls, 1);
  assert.equal(M.combine([{ alert: 'unsure' }, { alert: 'warn' }]).alert, 'warn');
  assert.equal(M.combine([{ alert: 'unsure' }, { alert: 'not_checked' }]).alert, 'not_checked');
  for (const key of [id, 'dictalm-q4']) M.unregisterLocalEngine(key);
  assert.equal((await M.route(req, prefs, cloud)).error, 'local_unavailable');
});
