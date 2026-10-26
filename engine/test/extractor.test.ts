import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_CATALOG,
  FactStore,
  MEANING_ROUTING_PACK,
  MockExtractorProvider,
  buildMeaningFacts,
  evaluate,
  extractToFactStore,
  localGate,
  normalizeHebrewText,
  runExtraction,
  validateExtraction,
  type MessageEnvelope,
} from '../src/index.js';

const provider = new MockExtractorProvider();

function msg(text: string, over: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    id: 'x1', revision: 1, direction: 'outgoing', authorRef: 'user',
    platform: 'whatsapp-web', conversationId: 'c1',
    audienceSnapshot: { participantCount: 5 }, text, ...over,
  };
}

test('normalize: niqqud, quotes and whitespace unify without changing words', () => {
  assert.equal(normalizeHebrewText('  שָׁלוֹם   ”עולם“  '), 'שלום "עולם"');
  assert.equal(normalizeHebrewText('מגיע ב־8'), 'מגיע ב-8');
});

test('localGate: triage only — benign logistics skipped, disparagement triaged in', () => {
  assert.equal(localGate('מגיע ב־8').shouldExtract, false);
  assert.equal(localGate('נתראה בשמונה, תודה').shouldExtract, false);
  assert.equal(localGate('הוא טיפש').shouldExtract, true);
  assert.equal(localGate('השיעור הזה מבזבז לנו את הזמן').shouldExtract, true);
});

test('extraction: everyday Hebrew lesson criticism yields a catalog fact with evidence', async () => {
  const m = msg('השיעור הזה מבזבז לנו את הזמן');
  const out = await runExtraction(m, { provider, catalog: FACT_CATALOG });
  assert.equal(out.status, 'extracted');
  const f = out.extraction?.proposedFacts.find((x) => x.id === 'message.criticizes_lesson_content');
  assert.ok(f);
  assert.ok(m.text.includes(f!.evidenceExcerpt) || normalizeHebrewText(m.text).includes(f!.evidenceExcerpt));
  assert.equal(out.extraction?.droppedFacts.length, 0);
});

test('extraction: irony / mock praise without an insult word produces a meaning cue', async () => {
  const m = msg('איזה יופי שהוא שוב איחר');
  const { outcome, store } = await extractToFactStore(m, FACT_CATALOG, provider);
  assert.equal(outcome.status, 'extracted');
  assert.equal(outcome.extraction?.meaning?.mayBeUnderstoodAsDisparagement, true);
  assert.equal(outcome.extraction?.meaning?.mechanism, 'irony');
  const r = evaluate({
    message: m, facts: store.snapshot(), rulePack: MEANING_ROUTING_PACK, catalog: FACT_CATALOG,
    contextVersion: 'ctx-ext-1', modelVersion: provider.modelVersion,
    directAssessment: outcome.extraction?.directAssessment ?? null,
  });
  assert.equal(r.findings.length, 0); // draft routing only, never a verdict
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'route.meaning.perceived-disparagement'));
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
});

test('extraction: irony "באמת יודע להסביר..." is flagged despite no disparagement word', async () => {
  const m = msg('הוא באמת יודע להסביר...');
  const out = await runExtraction(m, { provider, catalog: FACT_CATALOG });
  assert.equal(out.extraction?.meaning?.mayBeUnderstoodAsDisparagement, true);
  assert.equal(out.extraction?.meaning?.mechanism, 'irony');
});

test('extraction: hint identifying a person from context enters the check (MEAN-02 path)', async () => {
  const m = msg('ההוא מהשיעור של אתמול, אתם יודעים מי', { direction: 'incoming', platform: 'facebook-messenger' });
  const { outcome, store } = await extractToFactStore(m, FACT_CATALOG, provider);
  assert.equal(outcome.extraction?.meaning?.mechanism, 'hint');
  assert.equal(outcome.extraction?.meaning?.identifiable, true);
  const r = evaluate({
    message: m, facts: store.snapshot(), rulePack: MEANING_ROUTING_PACK, catalog: FACT_CATALOG,
    contextVersion: 'ctx-ext-2', modelVersion: provider.modelVersion,
  });
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.length >= 1);
  assert.ok(!r.missingFactIds.includes('subject.identifiable'));
});

test('false-positive guards: substantive criticism, sincere praise, logistics stay quiet', async () => {
  for (const text of [
    'השיעור היה ארוך והדוגמאות לא היו ברורות, כדאי להוסיף תרגול',
    'שיעור מעולה, תודה רבה',
    'מגיע ב־8',
  ]) {
    const m = msg(text);
    const out = await runExtraction(m, { provider, catalog: FACT_CATALOG });
    if (out.status === 'skipped_local_gate') continue; // quiet is also acceptable for logistics
    assert.notEqual(out.extraction?.meaning?.mayBeUnderstoodAsDisparagement, true, text);
    if (out.extraction?.meaning) {
      const built = buildMeaningFacts(out.extraction.meaning);
      assert.deepEqual(built.riskSignals, ['none_detected'], text);
    }
  }
  // The strictest guard: "מגיע ב־8" must not even call the provider by default.
  const quiet = await runExtraction(msg('מגיע ב־8'), { provider, catalog: FACT_CATALOG });
  assert.equal(quiet.status, 'skipped_local_gate');
  assert.equal(quiet.providerCalled, false);
});

test('validation: fabricated facts, user-only facts and invented evidence are dropped', () => {
  const v = validateExtraction({
    proposedFacts: [
      { id: 'relationships.teacher_is_parent', value: true, confidence: 0.99, evidenceExcerpt: 'הוא אבא שלו' },
      { id: 'message.invented_fact', value: true, confidence: 0.9, evidenceExcerpt: 'הוא טיפש' },
      { id: 'message.criticizes_lesson_content', value: true, confidence: 0.9, evidenceExcerpt: 'קטע שלא קיים בהודעה' },
      { id: 'message.criticizes_lesson_content', value: true, confidence: 'high', evidenceExcerpt: 'הוא טיפש' },
    ],
    meaning: { mayBeUnderstoodAsDisparagement: true, mechanism: 'direct', evidenceExcerpt: 'הוא טיפש', extractorConfidence: 0.9 },
  }, FACT_CATALOG, 'הוא טיפש');
  assert.equal(v.proposedFacts.length, 0);
  assert.ok(v.droppedFacts.some((d) => d.reason === 'confirmed_by_user_only'));
  assert.ok(v.droppedFacts.some((d) => d.reason === 'fact_not_in_catalog'));
  assert.ok(v.droppedFacts.some((d) => d.reason === 'evidence_not_in_message'));
  assert.ok(v.droppedFacts.some((d) => d.reason === 'confidence_missing_or_invalid'));
});

test('privacy boundary: sensitive fact from extraction stays candidate in the store', async () => {
  const store = new FactStore(FACT_CATALOG);
  const rec = store.propose('relationships.teacher_is_parent', true, 'model_extraction');
  assert.equal(rec.status, 'candidate');
  const confirmed = store.confirmByUser('relationships.teacher_is_parent', true);
  assert.equal(confirmed.status, 'known');
});

test('failure is explicit: provider error -> not_checked, never clean', async () => {
  const failing = { id: 'fail', modelVersion: 'fail-1', extract: async () => { throw new Error('network_down'); } };
  const out = await runExtraction(msg('הוא טיפש'), { provider: failing, catalog: FACT_CATALOG });
  assert.equal(out.status, 'not_checked');
  assert.ok(out.limitationsHe.some((s) => s.includes('לא נבדק')));
});
