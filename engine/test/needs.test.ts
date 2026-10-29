import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNeeds, localNeeds, validRound, MAX_ROUNDS } from '../src/needs.js';
import { validateExtraction } from '../src/extractor/validate.js';
import { FACT_CATALOG } from '../src/lessonScenario.js';

test('needs allowlist, bounded arguments, canonical questions and no scope leakage', () => {
  const n = validateNeeds({ round: 999, maxRounds: 999, requests: [
    { id: 'evil', kind: 'delete', args: {} },
    { id: 'r', kind: 'get_recent', args: { n: 999, accountId: 'other', url: 'evil' } },
    { id: 's', kind: 'search_history', args: { query: 'x'.repeat(500), top_k: 999, scope: 'other' } },
  ], questions: [{ factId: 'speaker.knows_first_hand', textHe: 'injected' },
    'speaker.knows_first_hand', 'not_a_fact'] }, 2);
  assert.equal(n.round, 2); assert.equal(n.maxRounds, MAX_ROUNDS);
  assert.deepEqual(n.requests[0], { id: 'r', kind: 'get_recent', args: { n: 20 } });
  assert.equal(n.requests[1]!.kind, 'search_history');
  assert.equal((n.requests[1]!.args as any).query.length, 300);
  assert.equal((n.requests[1]!.args as any).top_k, 5);
  assert.equal(n.questions.length, 1);
  assert.notEqual(n.questions[0]!.textHe, 'injected');
  assert.deepEqual(n.questions[0]!.answers.map(a => a.value), [true, false, null]);
});
test('round admission, malformed args, dedup, answered unknown is never reasked', () => {
  for (const x of [0, 4, 1.5, '2', null, Infinity]) assert.equal(validRound(x), null);
  assert.equal(validRound(undefined), 1);
  const needs = validateNeeds({ requests: [
    { id: 'r', kind: 'get_recent', args: { n: -1 } },
    { id: 'r', kind: 'search_history', args: { query: '', top_k: 1 } },
    { id: 'r', kind: 'get_recent', args: { n: 2 } },
    { id: 'r', kind: 'get_recent', args: { n: 4 } },
  ], questions: FACT_CATALOG.map(f => f.id) }, 3, [], { 'speaker.knows_first_hand': null });
  assert.equal(needs.requests.length, 1); assert.equal(needs.questions.length, 5);
  assert.ok(!needs.questions.some(q => q.factId === 'speaker.knows_first_hand'));
});
test('local router produces needs; extractor never formulates requests', () => {
  const n = localNeeds(['mem_recent', 'mem_search', 'ask_user'], 'synthetic query',
    [{ factId: 'speaker.knows_first_hand' }], 2);
  assert.deepEqual(n.requests.map(r => r.kind), ['search_history', 'get_recent']);
  assert.equal((n.requests[0]!.args as any).query, 'synthetic query');
  assert.equal(n.questions.length, 1);
  assert.equal(localNeeds([], 'text', n.questions).questions.length, 1, 'engine unanswered facts survive empty heads');
});
test('extraction validates needs without accepting context as message evidence', () => {
  const ex = validateExtraction({ directAssessment: 'no_concern',
    needs: { requests: [{ id: 'r', kind: 'get_recent', args: {} }] },
    proposedFacts: [{ id: 'speaker.knows_first_hand', value: true, confidence: 1, evidenceExcerpt: 'history only' }],
  }, FACT_CATALOG, 'synthetic message', { round: 2 });
  assert.equal(ex.needs?.round, 2); assert.equal(ex.needs?.requests.length, 1);
  assert.equal(ex.proposedFacts.length, 0);
});
