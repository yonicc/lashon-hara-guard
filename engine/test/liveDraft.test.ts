import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CC_TOELET_DRAFT_PACK, evaluate, FACT_CATALOG, factStoreFromExtraction, FactStore,
  type EvaluationInput, type MessageEnvelope, type ValidatedExtraction,
} from '../src/index.js';

// Synthetic data only.
const MSG: MessageEnvelope = {
  id: 'm1', revision: 1, direction: 'outgoing', authorRef: 'user', platform: 'test',
  conversationId: 'c1', audienceSnapshot: {}, text: 'הודעה סינתטית',
};

function input(store: FactStore, ruleMode?: EvaluationInput['ruleMode']): EvaluationInput {
  return {
    message: MSG, facts: store.snapshot(), rulePack: CC_TOELET_DRAFT_PACK, catalog: FACT_CATALOG,
    maxQuestions: 1, contextVersion: 'v', modelVersion: 'm', ...(ruleMode ? { ruleMode } : {}),
  };
}

function rebukeMissingStore(): FactStore {
  const s = new FactStore(FACT_CATALOG);
  s.propose('subject.identifiable', true, 'model_extraction');
  s.propose('message.content_is_disparaging', true, 'model_extraction');
  s.propose('toelet.rebuke_attempted', false, 'model_extraction');
  s.confirmByUser('toelet.purpose_is_constructive', true);
  s.confirmByUser('toelet.knows_subject_will_not_accept_rebuke', false);
  return s;
}

test('LIVE-01 default mode keeps drafts internal (unchanged contract)', () => {
  const r = evaluate(input(rebukeMissingStore()));
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'cc-toelet.10-02c.rebuke-first'));
});

test('LIVE-02 live_draft turns a matching halacha_draft rule into a draft finding with its source', () => {
  const r = evaluate(input(rebukeMissingStore(), 'live_draft'));
  const f = r.findings.find((x) => x.ruleId === 'cc-toelet.10-02c.rebuke-first');
  assert.ok(f);
  assert.equal(f.draft, true);
  assert.equal(f.reviewStatus, 'draft');
  assert.match(f.source?.url ?? '', /Principle_10:2$/);
  assert.equal(r.draftObservations.length, 0);
  // Never a verdict: no finding text says permitted/forbidden.
  for (const x of r.findings) assert.ok(!/(^|[^א-ת])(מותר|אסור)([^א-ת]|$)/.test(x.messageHe));
});

test('LIVE-03 live_draft never surfaces draft rules of other domains', () => {
  const pack = {
    ...CC_TOELET_DRAFT_PACK,
    rules: CC_TOELET_DRAFT_PACK.rules.map((r) => ({ ...r, domain: 'routing' as const })),
  };
  const r = evaluate({ ...input(rebukeMissingStore(), 'live_draft'), rulePack: pack });
  assert.equal(r.findings.length, 0);
});

test('LIVE-04 factStoreFromExtraction: user answers win; null stays unknown, never false', () => {
  const extraction: ValidatedExtraction = {
    proposedFacts: [{ id: 'toelet.rebuke_attempted', value: true, confidence: 0.9, evidenceExcerpt: 'x', provenance: 'model_extraction' }],
    directAssessment: null, droppedFacts: [], warnings: [],
  };
  const s1 = factStoreFromExtraction(extraction, FACT_CATALOG, { confirmed: { 'toelet.rebuke_attempted': false } });
  assert.equal(s1.facts.get('toelet.rebuke_attempted')?.value, false);
  assert.equal(s1.facts.get('toelet.rebuke_attempted')?.provenance, 'user');
  assert.equal(s1.facts.get('toelet.rebuke_attempted')?.status, 'known');

  const s2 = factStoreFromExtraction(extraction, FACT_CATALOG, { confirmed: { 'toelet.rebuke_attempted': null } });
  assert.equal(s2.facts.get('toelet.rebuke_attempted')?.status, 'unknown');
  assert.notEqual(s2.facts.get('toelet.rebuke_attempted')?.value, false);
});

test('LIVE-05 a declared benefit alone produces no finding and no "clean" status', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('subject.identifiable', true, 'model_extraction');
  s.propose('message.content_is_disparaging', true, 'model_extraction');
  s.propose('toelet.purpose_is_constructive', true, 'model_extraction');
  const r = evaluate(input(s, 'live_draft'));
  assert.equal(r.findings.length, 0);
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.questions.length, 1);
});

test('LIVE-06 10:7 exception: known public ineffective rebuke blocks only the rebuke note; unknown stays unresolved', () => {
  const s = rebukeMissingStore();
  s.confirmByUser('toelet.knows_subject_will_not_accept_rebuke', true);
  s.confirmByUser('audience.size_at_least_three', true);
  const r = evaluate(input(s, 'live_draft'));
  assert.ok(!r.findings.some((f) => f.ruleId === 'cc-toelet.10-02c.rebuke-first'));
  assert.notEqual(r.status, 'evaluated', 'an exception is not a permit: other conditions stay open');
  const missing = rebukeMissingStore();
  missing.markUnknown('toelet.knows_subject_will_not_accept_rebuke');
  const r2 = evaluate(input(missing, 'live_draft'));
  assert.ok(!r2.findings.some((f) => f.ruleId === 'cc-toelet.10-02c.rebuke-first'));
  assert.ok(r2.missingFactIds.includes('toelet.knows_subject_will_not_accept_rebuke'));
  assert.equal(r2.status, 'needs_clarification');
});
