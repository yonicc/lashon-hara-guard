import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, type EvaluationInput, type FactRecord, type RulePack } from '../src/index.js';

const pack: RulePack = {
  id: 'synthetic-exceptions', version: '1', rules: [{
    id: 'synthetic-rule', version: '1', domain: 'halacha_draft', titleHe: 'בדיקה סינתטית',
    reviewStatus: 'draft', applicability: { eq: ['trigger', true] },
    conditions: { eq: ['condition', true] }, exceptions: [{ eq: ['exception', true] }],
    outcome: { severity: 'medium', code: 'SYNTHETIC', messageHe: 'נדרש בירור' },
  }],
};
function run(exception?: { value: boolean; status: FactRecord['status'] }, condition = true, rulePack = pack) {
  const facts = new Map<string, FactRecord>();
  const set = (id: string, value: boolean, status: FactRecord['status'] = 'known') =>
    facts.set(id, { id, value, status, provenance: 'user', scope: 'message', updatedAt: '2026-10-27' });
  set('trigger', true); set('condition', condition);
  if (exception) set('exception', exception.value, exception.status);
  return evaluate({
    message: { id: 'synthetic', revision: 1, direction: 'outgoing', authorRef: 'user',
      platform: 'test', conversationId: 'synthetic', text: 'בדיקה סינתטית', audienceSnapshot: {} },
    facts, rulePack, ruleMode: 'live_draft', maxQuestions: 1,
    catalog: [{ id: 'irrelevant', questionHe: 'האם הענף החלופי מתקיים?', priority: 100,
      sensitivity: 'low', persistent: false },
    { id: 'exception', questionHe: 'האם חל החריג?', priority: 1,
      sensitivity: 'low', persistent: false }],
    contextVersion: 'test', modelVersion: 'test',
  } satisfies EvaluationInput);
}
test('unknown or disputed exception cannot be treated as absent', () => {
  for (const exception of [undefined, { value: false, status: 'unknown' as const },
    { value: false, status: 'disputed' as const }, { value: false, status: 'candidate' as const }]) {
    const result = run(exception);
    assert.equal(result.findings.length, 0);
    assert.deepEqual(result.missingFactIds, ['exception']);
    assert.equal(result.questions[0]?.factId, 'exception');
  }
});
test('known false exception allows a matching finding; known true exception blocks it', () => {
  assert.equal(run({ value: false, status: 'known' }).findings.length, 1);
  const blocked = run({ value: true, status: 'known' });
  assert.equal(blocked.findings.length, 0);
  assert.equal(blocked.questions.length, 0);
});
test('failed condition needs no question about an unknown exception', () => {
  const result = run(undefined, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.questions.length, 0);
});

test('a resolved OR branch cannot displace the unresolved exception question', () => {
  const rule = { ...pack.rules[0]!,
    applicability: { or: [{ eq: ['trigger', true] }, { eq: ['irrelevant', true] }] },
    requiredFacts: ['trigger', 'irrelevant', 'exception'],
  } as RulePack['rules'][number];
  for (const exception of [undefined, { value: false, status: 'disputed' as const }]) {
    const result = run(exception, true, { ...pack, rules: [rule] });
    assert.deepEqual(result.missingFactIds, ['exception']);
    assert.equal(result.questions[0]?.factId, 'exception');
    assert.equal(result.findings.length, 0);
  }
});

test('a false AND branch needs no missing facts from its other branch', () => {
  const rule = { ...pack.rules[0]!,
    conditions: { or: [
      { and: [{ eq: ['trigger', false] }, { eq: ['irrelevant', true] }] },
      { eq: ['condition', true] },
    ] }, requiredFacts: ['irrelevant', 'exception'],
  } as RulePack['rules'][number];
  const result = run(undefined, true, { ...pack, rules: [rule] });
  assert.deepEqual(result.missingFactIds, ['exception']);
  assert.equal(result.questions[0]?.factId, 'exception');
});
