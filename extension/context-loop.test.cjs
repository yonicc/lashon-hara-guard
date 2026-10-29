const test = require('node:test'), assert = require('node:assert/strict');
const { run } = require('./context-loop.js');
require('./ollama-engine.bundle.js');
const schema = globalThis.LHG_NEEDS;
const pending = { alert: 'none', needs: { requests: [{ id: 'r', kind: 'get_recent', args: { n: 5 } }],
  questions: ['speaker.knows_first_hand'] } };
const request = { text: 'Synthetic primary text', context: { version: 1, recentMessages: [] },
  confirmedFacts: { 'toelet.facts_verified': null } };
const packet = text => ({ version: 1, platform: 'gmail', direction: 'outgoing', conversationRef: 'synthetic',
  currentAuthorRef: 'self', recentMessages: [{ text, authorRef: 'unknown', direction: 'incoming' }] });
function fixture(extra = {}) {
  const calls = [];
  return { calls, options: { request, schema, check: async req => { calls.push(req); return calls.length === 1 ? pending : { alert: 'none' }; },
    retrieve: async r => [{ text: 'synthetic history' }], exchange: async rows => packet(rows[0].text), ...extra } };
}
test('one executor runs round 2 with sanitized untrusted context; no confirmed fact promotion', async () => {
  assert.ok(schema, 'canonical schema bundled');
  const { calls, options } = fixture();
  const result = await run(options);
  assert.equal(result.alert, 'none'); assert.equal(calls.length, 2);
  assert.equal(calls[1].round, 2); assert.equal(calls[1].text, request.text);
  assert.deepEqual(calls[1].confirmedFacts, request.confirmedFacts);
  assert.equal(calls[1].context.recentMessages[0].text, 'synthetic history');
});
test('max 3 rounds and no approval while requests pending', async () => {
  let n = 0;
  const { calls, options } = fixture({ check: async req => { calls.push(req); return pending; },
    exchange: async () => packet('history ' + (++n)) });
  const result = await run(options);
  assert.equal(calls.length, 3); assert.equal(result.alert, 'unsure'); assert.equal(result.loopStopped, 'max_rounds');
  assert.equal(result.rules.questions.length, 1);
});
test('duplicate/no information stops without extra billed call', async () => {
  const { calls, options } = fixture({ check: async req => { calls.push(req); return pending; } });
  const result = await run(options);
  assert.equal(calls.length, 2); assert.equal(result.loopStopped, 'no_new_information'); assert.equal(result.alert, 'unsure');
});
test('memory disabled exposes catalog questions immediately, no follow-up', async () => {
  const { calls, options } = fixture({ retrieve: async () => { throw Error('disabled'); } });
  const result = await run(options);
  assert.equal(calls.length, 1); assert.equal(result.loopStopped, 'memory_disabled');
  assert.equal(result.alert, 'unsure'); assert.equal(result.rules.questions[0].factId, 'speaker.knows_first_hand');
});
test('error preserves last questions and warning; never approves', async () => {
  const { options } = fixture({ check: async req => req.round === 1 ? { ...pending, alert: 'warn' } : { alert: 'not_checked', error: 'network' } });
  const r = await run(options); assert.equal(r.alert, 'warn'); assert.equal(r.loopStopped, 'error'); assert.equal(r.rules.questions.length, 1);
});
test('edited/superseded message abandons before retrieval or next charge', async () => {
  let active = true, checks = 0, reads = 0;
  const { options } = fixture({ current: async () => active, check: async () => { checks++; active = false; return pending; },
    retrieve: async () => { reads++; return []; } });
  const r = await run(options);
  assert.equal(checks, 1); assert.equal(reads, 0); assert.notEqual(r.alert, 'none'); assert.equal(r.loopStopped, 'superseded');
});
test('unknown kinds and unrecognized args never reach executor', async () => {
  let reads = 0;
  const { options } = fixture({ check: async () => ({ alert: 'unsure', needs: { requests: [{ id: 'x', kind: 'write_memory', args: {} }] } }),
    retrieve: async () => { reads++; } });
  await run(options); assert.equal(reads, 0);
});
test('editing during the final response cannot return a stale approval', async () => {
  let active = true;
  const { options } = fixture({ current: async () => active, check: async req => {
    if (req.round === 1) return pending;
    active = false; return { alert: 'none' };
  } });
  const r = await run(options);
  assert.equal(r.alert, 'unsure'); assert.equal(r.loopStopped, 'superseded');
});
test('local heads and deterministic unanswered facts use same canonical protocol', () => {
  const n = schema.localNeeds(['mem_recent','mem_search','ask_user'], request.text,
    ['speaker.knows_first_hand'], 1);
  assert.deepEqual(n.requests.map(r => r.kind), ['search_history','get_recent']);
  assert.equal(n.requests[0].args.query, request.text);
  assert.equal(n.questions.length, 1);
  assert.equal(schema.localNeeds([], request.text, n.questions).questions.length, 1);
});
test('stalled memory stops at a bounded timeout with last questions', async () => {
  const { calls, options } = fixture({ timeoutMs: 10, retrieve: () => new Promise(() => {}) });
  const r = await run(options);
  assert.equal(calls.length, 1); assert.equal(r.alert, 'unsure'); assert.equal(r.loopStopped, 'error');
});
test('real Ollama adapter produces local needs from router heads, never from extractor output', async () => {
  const r = await globalThis.LHG_OLLAMA_ENGINE.check({ ...request, platform:'gmail', direction:'outgoing',
    routerHeads:['mem_recent','mem_search','ask_user'], round:2 }, 'extractor-7b-q4',
    { generate:async () => ({ output:{}, scores:{} }) });
  assert.equal(r.needs.round, 2);
  assert.deepEqual(r.needs.requests.map(r => r.kind), ['search_history','get_recent']);
  assert.ok(r.needs.questions.length > 0); assert.equal(r.alert, 'unsure');
});
