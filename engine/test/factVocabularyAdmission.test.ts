import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACT_CATALOG, factStoreFromExtraction, type FactCatalogEntry } from '../src/index.js';
import { validateExtraction, validateAnalysis, ANALYSIS_LIMITS } from '../src/extractor/validate.js';
import { EXTRACTION_CONFIDENCE_MIN } from '../src/extractor/factPolicy.js';
import type { ValidatedExtraction, ProposedFact } from '../src/extractor/types.js';

const text = 'synthetic evidence';
const catalog: FactCatalogEntry[] = [...FACT_CATALOG, {
  id: 'test.number', valueType: 'number', questionHe: 'test', priority: 1, sensitivity: 'low', persistent: false,
}];
function check(id: string, value: unknown, confidence: unknown, accepted: boolean) {
  const fact = { id, value, confidence, evidenceExcerpt: text, provenance: 'model_extraction' } as ProposedFact;
  const raw = { proposedFacts: [fact] };
  assert.equal(validateExtraction(raw, catalog, text).proposedFacts.length, accepted ? 1 : 0);
  const direct = { ...raw, directAssessment: null, droppedFacts: [], warnings: [] } as ValidatedExtraction;
  assert.equal(factStoreFromExtraction(direct, catalog).facts.has(id), accepted);
}
test('FACT-ADMISSION confidence is finite, bounded and at least the explicit threshold in both paths', () => {
  for (const c of [0, 0.1, EXTRACTION_CONFIDENCE_MIN - 0.001, -1, 1.1, NaN, Infinity, undefined, '1'])
    check('message.is_praise', true, c, false);
  for (const c of [EXTRACTION_CONFIDENCE_MIN, 1]) check('message.is_praise', false, c, true);
});
test('FACT-ADMISSION catalog types reject cross-type values and non-finite numbers in both paths', () => {
  for (const v of ['false', 0, null, {}, []]) check('message.is_praise', v, 1, false);
  for (const v of [false, 123]) check('lesson.teacher_id', v, 1, false);
  check('lesson.teacher_id', 'synthetic-teacher', 1, true);
  check('message.purpose', 'warning', 1, true);
  check('test.number', 2, 1, true);
  for (const v of ['2', true, NaN, Infinity]) check('test.number', v, 1, false);
});
test('FACT-ADMISSION every user-only catalog entry rejects automatic true and false even at confidence one', () => {
  for (const entry of FACT_CATALOG.filter((e) => e.confirmedByUserOnly))
    for (const v of [true, false]) check(entry.id, v, 1, false);
});
test('FACT-ADMISSION meaning cannot bypass sensitive catalog metadata or confidence threshold', () => {
  const guarded = catalog.map((e) => e.id === 'subject.identifiable' ? { ...e, confirmedByUserOnly: true } : e);
  for (const confidence of [0, 0.1, NaN, 1]) {
    const extraction: ValidatedExtraction = { proposedFacts: [], directAssessment: null, droppedFacts: [], warnings: [],
      meaning: { identifiable: true, extractorConfidence: confidence, evidenceExcerpt: text } };
    assert.equal(factStoreFromExtraction(extraction, guarded).facts.has('subject.identifiable'), false);
    if (confidence !== 1) assert.equal(factStoreFromExtraction(extraction, catalog).facts.size, 0);
  }
});
test('FACT-ADMISSION validateAnalysis allows only one nonempty question', () => {
  assert.equal(ANALYSIS_LIMITS.questions, 1);
  assert.deepEqual(validateAnalysis({ questionsHe: ['', 'first?', 'second?', 'third?'] }, text, new Set())?.questionsHe, ['first?']);
});

test('FACT-ADMISSION invalid meaning confidence is rejected through provider validation and store, never clipped', () => {
  for (const confidence of [-1, 2, NaN, Infinity, -Infinity, undefined, '1', 0, 0.599]) {
    const raw = { meaning: { mayBeUnderstoodAsDisparagement: true, identifiable: true,
      extractorConfidence: confidence, evidenceExcerpt: text }, proposedFacts: [] };
    const validated = validateExtraction(raw, catalog, text);
    const store = factStoreFromExtraction(validated, catalog);
    assert.equal(store.facts.size, 0, String(confidence));
  }
  for (const confidence of [0.6, 1]) {
    const validated = validateExtraction({ meaning: { mayBeUnderstoodAsDisparagement: true,
      identifiable: true, extractorConfidence: confidence, evidenceExcerpt: text } }, catalog, text);
    const store = factStoreFromExtraction(validated, catalog);
    assert.equal(store.facts.get('subject.identifiable')?.value, true);
    assert.equal(store.facts.get('message.may_be_understood_as_disparagement')?.value, true);
  }
});
