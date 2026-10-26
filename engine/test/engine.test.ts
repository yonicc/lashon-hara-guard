import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_CATALOG,
  FactStore,
  LESSON_ROUTING_PACK,
  evaluate,
  validateRulePack,
  type MessageEnvelope,
  type RulePack,
} from '../src/index.js';

const msg = (over: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm1',
  revision: 1,
  direction: 'outgoing',
  authorRef: 'user',
  platform: 'whatsapp-web',
  conversationId: 'lesson-group',
  audienceSnapshot: { participantCount: 5 },
  text: 'השיעור הזה מבזבז לנו את הזמן',
  ...over,
});

function baseInput(store: FactStore, over: Partial<Parameters<typeof evaluate>[0]> = {}) {
  return {
    message: msg(),
    facts: store.snapshot(),
    rulePack: LESSON_ROUTING_PACK,
    catalog: FACT_CATALOG,
    contextVersion: 'ctx-1',
    modelVersion: 'extractor-test',
    ...over,
  };
}

test('CTX-01: unknown teacher -> clarification, one question, no finding, no permit-by-count', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'model_extraction');
  const r = evaluate(baseInput(s));
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.findings.length, 0);
  assert.ok(r.missingFactIds.includes('lesson.teacher_id'));
  assert.equal(r.questions.length, 1); // budget: max 1 question
  assert.equal(r.questions[0]?.factId, 'lesson.teacher_id');
  // 5 participants must never become a permit / approved finding
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
});

test('CTX-04/CTX-07: parent fact only via user; then routing observation stays draft-only', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'model_extraction');
  const cand = s.propose('relationships.teacher_is_parent', true, 'model_extraction');
  assert.equal(cand.status, 'candidate'); // sensitive fact not known from extraction
  let r = evaluate(baseInput(s));
  assert.equal(r.findings.length, 0);
  assert.ok(r.missingFactIds.includes('relationships.teacher_is_parent'));

  s.confirmByUser('lesson.teacher_id', 'person-a', 'event');
  s.confirmByUser('relationships.teacher_is_parent', true);
  r = evaluate(baseInput(s));
  assert.equal(r.findings.length, 0); // draft rules never emit findings
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'route.lesson.family-review'));
});

test('CTX-06: user declines -> fact stays unknown, clarification incomplete', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'user');
  s.markUnknown('lesson.teacher_id');
  const r = evaluate(baseInput(s));
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.findings.length, 0);
});

test('CTX-08: conflicting teacher identity -> disputed blocks reliance', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'user');
  s.confirmByUser('lesson.teacher_id', 'person-a', 'event');
  const d = s.propose('lesson.teacher_id', 'person-b', 'site_metadata');
  assert.equal(d.status, 'disputed');
  const r = evaluate(baseInput(s));
  assert.ok(r.missingFactIds.includes('lesson.teacher_id'));
  assert.equal(r.findings.length, 0);
});

test('CTX-10 + RULE-01: declared purpose never approves; draft pack yields no user finding', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'user');
  s.confirmByUser('lesson.teacher_id', 'person-a', 'event');
  s.confirmByUser('lesson.teacher_in_audience', true);
  s.propose('message.purpose', 'warning', 'user');
  const r = evaluate(baseInput(s));
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.length >= 1);
});

test('MSG-01/MSG-02: cache key depends on text revision/audience/pack, not text alone', () => {
  const s = new FactStore(FACT_CATALOG);
  const a = evaluate(baseInput(s));
  const b = evaluate(baseInput(s, { message: msg({ audienceSnapshot: { participantCount: 2 } }) }));
  const c = evaluate(baseInput(s, { message: msg({ revision: 2, text: 'נוסח אחר' }) }));
  assert.notEqual(a.cacheKey, b.cacheKey);
  assert.notEqual(a.cacheKey, c.cacheKey);
});

test('approved gate: approved rule without verified source fails pack validation', () => {
  const pack: RulePack = {
    id: 'bad',
    version: '1',
    rules: [
      {
        id: 'x',
        version: '1',
        domain: 'halacha',
        titleHe: 'טיוטה מסוכנת',
        reviewStatus: 'approved',
        applicability: { eq: ['message.criticizes_lesson_content', true] },
        conditions: { eq: ['message.criticizes_lesson_content', true] },
        outcome: { severity: 'high', code: 'X', messageHe: 'אסור' },
      },
    ],
  };
  const v = validateRulePack(pack);
  assert.equal(v.valid, false);
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', true, 'user');
  const r = evaluate({ ...baseInput(s), rulePack: pack });
  assert.equal(r.status, 'not_checked');
  assert.equal(r.findings.length, 0);
});

test('double-check: extractor concern vs clean engine -> disagreement downgrade', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('message.criticizes_lesson_content', false, 'user');
  const r = evaluate(baseInput(s, { directAssessment: 'concern' }));
  assert.equal(r.disagreement, true);
  assert.equal(r.status, 'needs_clarification');
});
