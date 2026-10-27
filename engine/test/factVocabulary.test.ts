import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACT_CATALOG, FactStore, evalExpr, factStoreFromExtraction, type FactCatalogEntry } from '../src/index.js';
import { validateExtraction } from '../src/extractor/validate.js';
import { buildUserContent } from '../src/extractor/brainSend.js';
import type { ExtractorRequest, ValidatedExtraction } from '../src/extractor/types.js';

const repo = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, repo), 'utf8'));
const vocabulary = json('rules/chafetz-chaim/facts.json').facts as (FactCatalogEntry & { sourceRefs?: string[] })[];
const byId = new Map(FACT_CATALOG.map((f) => [f.id, f]));
const classification = 'speaker.checked_halachic_classification';
const proposal = (id: string, value: boolean) => ({ id, value, confidence: 1, evidenceExcerpt: 'בדיקה סינתטית', provenance: 'model_extraction' as const });
const extraction = (proposedFacts: ValidatedExtraction['proposedFacts']): ValidatedExtraction => ({
  proposedFacts, directAssessment: null, droppedFacts: [], warnings: [],
});
const tri = (store: FactStore, id: string) => evalExpr({ eq: [id, false] }, store.snapshot());

test('FACT-VOCAB-01 every vocabulary question and all safety metadata have one canonical definition', () => {
  assert.equal(new Set(vocabulary.map((f) => f.id)).size, vocabulary.length);
  assert.equal(byId.size, FACT_CATALOG.length);
  assert.equal(vocabulary.length, 72);
  for (const f of vocabulary) {
    const { sourceRefs, ...entry } = f;
    assert.deepEqual(byId.get(f.id), entry, f.id);
  }
  for (const id of ['lesson.teacher_id', 'relationships.teacher_is_parent', 'message.purpose',
    'toelet.knows_subject_will_not_accept_rebuke', 'audience.can_help_or_influence']) assert.ok(byId.has(id), id);
});

test('FACT-VOCAB-02 new distinctions have exact primary-source sections in the 177-section manifest', () => {
  const manifest = json('sources/chafetz-chaim/manifest.json');
  assert.equal(manifest.principles.reduce((n: number, p: { seifim: unknown[] }) => n + p.seifim.length, 0), 177);
  const all = new Set<string>();
  for (const p of manifest.principles) for (const s of p.seifim) all.add(p.key + ':' + s.n);
  const linked = vocabulary.filter((f) => f.sourceRefs);
  assert.equal(linked.length, 11);
  for (const f of linked) for (const ref of f.sourceRefs!) assert.ok(all.has(ref), ref);
  assert.deepEqual(vocabulary.find((f) => f.id === classification)?.sourceRefs, ['p1_prin10:2']);
  const text = readFileSync(new URL('sources/chafetz-chaim/text/p1_prin10.txt', repo), 'utf8')
    .normalize('NFD').replace(/[\u0591-\u05C7]/g, '');
  assert.match(text, /יתבונן היטב את עצם הענין/);
});

test('FACT-VOCAB-03 legal conclusions and sensitive conduct cannot become model-confirmed facts', () => {
  const guarded = [classification, 'speaker.is_sinner_like_subject', 'toelet.no_excess_harm',
    'subject.is_fellow', 'subject.is_established_wicked'];
  const validated = validateExtraction({ proposedFacts: guarded.flatMap((id) => [proposal(id, true), proposal(id, false)]) },
    FACT_CATALOG, 'בדיקה סינתטית');
  assert.deepEqual(validated.proposedFacts, []);
  assert.equal(validated.droppedFacts.length, guarded.length * 2);
  for (const id of guarded) {
    assert.equal(byId.get(id)?.confirmedByUserOnly, true, id);
    const direct = factStoreFromExtraction(extraction([proposal(id, true)]), FACT_CATALOG);
    assert.equal(direct.facts.has(id), false);
    assert.equal(tri(direct, id), 'unknown');
  }
});

test('FACT-VOCAB-04 explicit user yes/no/unknown never establishes any other predicate', () => {
  for (const value of [true, false, null]) {
    const store = factStoreFromExtraction(undefined, FACT_CATALOG, { confirmed: { [classification]: value } });
    assert.equal(store.facts.get(classification)?.status, value === null ? 'unknown' : 'known');
    assert.equal(tri(store, classification), value === null ? 'unknown' : value === false);
    for (const id of ['toelet.facts_verified', 'toelet.no_excess_harm', 'toelet.purpose_is_constructive'])
      assert.equal(tri(store, id), 'unknown', id);
  }
});

test('FACT-VOCAB-05 conflicting proposals stay disputed through repetitions; only user resolves them', () => {
  const id = 'toelet.future_benefit_expected';
  const store = factStoreFromExtraction(extraction([proposal(id, true), proposal(id, false), proposal(id, false)]), FACT_CATALOG);
  assert.equal(store.facts.get(id)?.status, 'disputed');
  assert.equal(tri(store, id), 'unknown');
  factStoreFromExtraction(extraction([proposal(id, true)]), FACT_CATALOG, { store });
  assert.equal(store.facts.get(id)?.status, 'disputed');
  factStoreFromExtraction(undefined, FACT_CATALOG, { store, confirmed: { [id]: null } });
  assert.equal(tri(store, id), 'unknown');
  factStoreFromExtraction(undefined, FACT_CATALOG, { store, confirmed: { [id]: false } });
  assert.equal(tri(store, id), true);
});

test('FACT-VOCAB-06 meanings and intentions do not substitute for the distinct benefit predicates', () => {
  const raw = { proposedFacts: [proposal('toelet.purpose_is_constructive', true), proposal('audience.can_help_or_influence', true)] };
  const validated = validateExtraction(raw, FACT_CATALOG, 'בדיקה סינתטית');
  const store = factStoreFromExtraction(validated, FACT_CATALOG);
  for (const id of ['toelet.future_benefit_expected', 'audience.can_help_victim', 'audience.can_influence_subject',
    'matter.known_to_victim', 'context.asked_to_identify_sinner']) assert.equal(tri(store, id), 'unknown', id);
});

test('FACT-VOCAB-07 extractor sees canonical questions and excludes user-only predicates', () => {
  const request: ExtractorRequest = { messageId: 'synthetic', platform: 'test', direction: 'outgoing',
    text: 'בדיקה סינתטית', normalizedText: 'בדיקה סינתטית', gateCues: [],
    catalogFactIds: FACT_CATALOG.map((f) => f.id) };
  const prompt = buildUserContent(request);
  for (const f of FACT_CATALOG) {
    if (f.confirmedByUserOnly) assert.ok(!prompt.includes('- ' + f.id), f.id);
    else assert.ok(prompt.includes('- ' + f.id + ': ' + f.questionHe), f.id);
  }
});

test('FACT-VOCAB-08 merge map preserves distinct ids and marks inverse polarity explicitly', () => {
  const map = json('rules/chafetz-chaim/fact-merge-map.json');
  for (const f of vocabulary.filter((f) => f.sourceRefs)) assert.equal(map[f.id].target, f.id);
  assert.equal(map['toelet.subject_has_not_repent'].target, 'subject.has_repented_or_reformed');
  assert.equal(map['toelet.subject_has_not_repent'].negate, true);
  for (const d of Object.values(map) as { action: string; target?: string }[])
    if (d.action !== 'reject') assert.ok(byId.has(d.target!), d.target);
});

test('FACT-VOCAB-09 unknown ids and malformed user answers do not enter the live store', () => {
  const store = factStoreFromExtraction(extraction([proposal('invented.fact', false)]), FACT_CATALOG, {
    confirmed: { 'invented.fact': true, [classification]: 'false' } as unknown as Record<string, boolean>,
  });
  assert.equal(store.facts.size, 0);
});
