import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_CATALOG,
  FactStore,
  MEANING_ROUTING_PACK,
  buildMeaningFacts,
  evaluate,
  type MessageEnvelope,
} from '../src/index.js';

const msg = (over: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'mm1',
  revision: 1,
  direction: 'outgoing',
  authorRef: 'user',
  platform: 'whatsapp-web',
  conversationId: 'meaning-group',
  audienceSnapshot: { participantCount: 5 },
  text: 'הוא באמת יודע להסביר...',
  ...over,
});

function seed(store: FactStore, built: ReturnType<typeof buildMeaningFacts>) {
  for (const f of built.facts) store.propose(f.id, f.value, f.provenance);
}

function run(store: FactStore) {
  return evaluate({
    message: msg(),
    facts: store.snapshot(),
    rulePack: MEANING_ROUTING_PACK,
    catalog: FACT_CATALOG,
    contextVersion: 'ctx-meaning-1',
    modelVersion: 'extractor-test',
  });
}

test('MEANING-01: implicit disparagement without explicit insult routes to clarification, never a finding', () => {
  const built = buildMeaningFacts({
    mayBeUnderstoodAsDisparagement: true,
    mechanism: 'irony',
    evidenceExcerpt: 'באמת יודע להסביר',
    extractorConfidence: 0.9,
  });
  assert.ok(built.riskSignals.includes('implicit_disparagement_possible'));
  assert.equal(built.routeEligible, true);

  const s = new FactStore(FACT_CATALOG);
  seed(s, built);
  const r = run(s);
  assert.equal(r.findings.length, 0); // draft routing only
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'route.meaning.perceived-disparagement'));
  // identifiability still unknown -> the engine must ask, not conclude
  assert.ok(r.missingFactIds.includes('subject.identifiable'));
  assert.equal(r.questions[0]?.factId, 'subject.identifiable');
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
});

test('MEANING-02: lack of an explicit insult word does not cancel perceived meaning', () => {
  const built = buildMeaningFacts({
    mayBeUnderstoodAsDisparagement: true,
    mechanism: 'praise',
    evidenceExcerpt: 'איזה יופי שהוא שוב איחר',
    extractorConfidence: 0.85,
  });
  assert.ok(built.facts.some((f) => f.id === 'message.may_be_understood_as_disparagement' && f.value === true));
  const s = new FactStore(FACT_CATALOG);
  seed(s, built);
  const r = run(s);
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.length >= 1);
});

test('MEANING-03: no structured meaning assessment -> interpretation stays uncertain, not clean', () => {
  const built = buildMeaningFacts({});
  assert.ok(built.riskSignals.includes('interpretation_uncertain'));
  const s = new FactStore(FACT_CATALOG);
  seed(s, built);
  const r = run(s);
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.findings.length, 0);
});

test('MEANING-04: implicit cue without evidence or confidence does not activate a warning', () => {
  const built = buildMeaningFacts({
    mayBeUnderstoodAsDisparagement: true,
    mechanism: 'hint',
    extractorConfidence: 0.4,
  });
  assert.equal(built.routeEligible, true); // still routes via uncertainty, not via the cue
  assert.ok(!built.facts.some((f) => f.id === 'message.may_be_understood_as_disparagement'));
  assert.ok(built.riskSignals.includes('interpretation_uncertain'));
  assert.ok(!built.riskSignals.includes('implicit_disparagement_possible'));
});

test('MEANING-05: explicit no-risk assessment with evidence stays quiet (false-positive guard)', () => {
  const built = buildMeaningFacts({
    mayBeUnderstoodAsDisparagement: false,
    interpretationUncertain: false,
    evidenceExcerpt: 'נתראה בשמונה',
    extractorConfidence: 0.95,
    identifiable: false,
  });
  assert.deepEqual(built.riskSignals, ['none_detected']);
  const s = new FactStore(FACT_CATALOG);
  seed(s, built);
  const r = run(s);
  assert.equal(r.draftObservations.length, 0);
  assert.equal(r.findings.length, 0);
});

test('MEANING-06: identifiability by hint/context still routes, without asserting a verdict', () => {
  const built = buildMeaningFacts({
    mayBeUnderstoodAsDisparagement: true,
    mechanism: 'hint',
    evidenceExcerpt: 'ההוא מהשיעור של אתמול',
    extractorConfidence: 0.9,
    identifiable: true,
  });
  const s = new FactStore(FACT_CATALOG);
  seed(s, built);
  const r = run(s);
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'route.meaning.perceived-disparagement'));
  assert.ok(!r.missingFactIds.includes('subject.identifiable'));
});
