// Guards the draft Chafetz Chaim Principle-10 (to'elet) rule pack.
//
// Iron rules under test (docs/03):
// - the pack is valid, every rule is draft in halacha_draft, and no outcome text
//   ever says "permitted"/"forbidden" (מותר/אסור) as a ruling;
// - every fact id the pack references exists in the vocabulary
//   (rules/chafetz-chaim/facts.json) AND in the engine FACT_CATALOG, and the
//   catalog question for each vocabulary fact is exactly the facts.json text;
// - a constructive purpose is never a permit: even with all seven conditions of
//   se'if 2 satisfied, evaluate() yields only draftObservations, no findings;
// - while a condition is unknown, the engine asks about that condition (the
//   question text comes from the catalog = facts.json, never from rule code);
// - a failed condition surfaces as a draft observation naming the condition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CC_TOELET_DRAFT_PACK,
  FACT_CATALOG,
  FactStore,
  evaluate,
  toeletPackFactIds,
  validateRulePack,
  type MessageEnvelope,
} from '../src/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = join(REPO, 'rules', 'chafetz-chaim');
const vocab = JSON.parse(readFileSync(join(RULES, 'facts.json'), 'utf8')) as {
  facts: { id: string; questionHe: string }[];
};
const vocabById = new Map(vocab.facts.map((f) => [f.id, f]));
const catalogById = new Map(FACT_CATALOG.map((c) => [c.id, c]));

const msg = (over: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm-toelet',
  revision: 1,
  direction: 'outgoing',
  authorRef: 'user',
  platform: 'whatsapp-web',
  conversationId: 'synthetic-toelet',
  audienceSnapshot: {},
  text: 'סיפור סינתטי על עוולה לצורך בדיקת מנוע',
  ...over,
});

function storeWith(entries: [string, boolean][]): FactStore {
  const s = new FactStore(FACT_CATALOG);
  for (const [id, v] of entries) s.propose(id, v, 'user', { userConfirmed: true });
  return s;
}

function run(s: FactStore, maxQuestions = 10) {
  return evaluate({
    message: msg(),
    facts: s.snapshot(),
    rulePack: CC_TOELET_DRAFT_PACK,
    catalog: FACT_CATALOG,
    maxQuestions,
    contextVersion: 'ctx-toelet',
    modelVersion: 'extractor-test',
  });
}

const BASE: [string, boolean][] = [
  ['subject.identifiable', true],
  ['message.content_is_disparaging', true],
];

const ALL_CONDITIONS_MET: [string, boolean][] = [
  ...BASE,
  ['toelet.purpose_is_constructive', true],
  ['speaker.intent_to_disparage', false],
  ['speaker.knows_first_hand', true],
  ['speaker.checked_halachic_classification', true],
  ['speaker.motive_is_revenge_or_hatred', false],
  ['subject.has_repented_or_reformed', false],
  ['toelet.facts_verified', true],
  ['toelet.rebuke_attempted', true],
  ['message.contains_falsehood_or_exaggeration', false],
  ['toelet.no_other_way', true],
  ['toelet.no_excess_harm', true],
  ['audience.listener_will_spread', false],
];

test('TOELET-01 pack validates; every rule is draft halacha_draft with an exact manifest source', () => {
  const v = validateRulePack(CC_TOELET_DRAFT_PACK);
  assert.deepEqual(v.errors, []);
  assert.equal(v.valid, true);
  assert.equal(CC_TOELET_DRAFT_PACK.id, 'cc-toelet-draft');
  assert.ok(CC_TOELET_DRAFT_PACK.rules.length >= 8 && CC_TOELET_DRAFT_PACK.rules.length <= 12);
  const manifest = JSON.parse(
    readFileSync(join(REPO, 'sources', 'chafetz-chaim', 'manifest.json'), 'utf8'),
  ) as { principles: { key: string; seifim: { n: number; ref: string; url: string }[] }[] };
  const prin10 = manifest.principles.find((p) => p.key === 'p1_prin10');
  assert.ok(prin10);
  const urlByN = new Map(prin10.seifim.map((s) => [s.n, s.url]));
  for (const r of CC_TOELET_DRAFT_PACK.rules) {
    assert.equal(r.reviewStatus, 'draft', r.id);
    assert.equal(r.domain, 'halacha_draft', r.id);
    assert.equal(r.source?.work, 'Chafetz Chaim', r.id);
    const n = Number((r.source?.section ?? '').split(':')[1]);
    assert.ok(Number.isInteger(n), `${r.id}: section`);
    assert.equal(r.source?.url, urlByN.get(n), `${r.id}: url must equal manifest`);
    assert.match(r.outcome.messageHe, /^לפי חפץ חיים כלל י׳/, r.id);
  }
});

test('TOELET-02 no rule ever rules permitted/forbidden (docs/03 iron rule)', () => {
  for (const r of CC_TOELET_DRAFT_PACK.rules) {
    assert.ok(!/(^|[^\u05d0-\u05ea])מותר([^\u05d0-\u05ea]|$)/.test(r.outcome.messageHe), r.id);
    assert.ok(!/(^|[^\u05d0-\u05ea])אסור([^\u05d0-\u05ea]|$)/.test(r.outcome.messageHe), r.id);
    assert.ok(!/permitted/i.test(r.outcome.messageHe), r.id);
    assert.ok(!/forbidden/i.test(r.outcome.messageHe), r.id);
  }
});

test('TOELET-03 every fact id used by the pack exists in facts.json and in FACT_CATALOG', () => {
  for (const id of toeletPackFactIds()) {
    assert.ok(vocabById.has(id), `pack fact ${id} missing from facts.json`);
    assert.ok(catalogById.has(id), `pack fact ${id} missing from FACT_CATALOG`);
  }
});

test('TOELET-04 catalog questions for vocabulary facts equal facts.json verbatim (single source)', () => {
  for (const f of vocab.facts) {
    const entry = catalogById.get(f.id);
    assert.ok(entry, `facts.json fact ${f.id} missing from FACT_CATALOG`);
    assert.equal(entry.questionHe, f.questionHe, f.id);
  }
});

test('TOELET-05 all seven conditions met: still no finding and no permit, only draft observations', () => {
  const r = run(storeWith(ALL_CONDITIONS_MET));
  assert.equal(r.findings.length, 0);
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
  for (const rule of CC_TOELET_DRAFT_PACK.rules) {
    assert.ok(!rule.outcome.messageHe.includes('מותר'), rule.id);
  }
  assert.ok(r.draftObservations.length >= 1, 'expected at least one draft observation');
  assert.ok(
    r.draftObservations.some((d) => d.ruleId === 'cc-toelet.10-01.wrongdoing-frame'),
    'aggregate seven-conditions draft rule should match internally',
  );
});

test('TOELET-06 one condition unknown (rebuke): clarification question about that condition', () => {
  const entries = ALL_CONDITIONS_MET.filter(([id]) => id !== 'toelet.rebuke_attempted');
  const r = run(storeWith(entries));
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.findings.length, 0);
  assert.ok(r.missingFactIds.includes('toelet.rebuke_attempted'));
  const q = r.questions.find((x) => x.factId === 'toelet.rebuke_attempted');
  assert.ok(q, 'expected a question about toelet.rebuke_attempted');
  assert.equal(q.questionHe, vocabById.get('toelet.rebuke_attempted')?.questionHe);
  assert.ok(q.unlocksRuleIds.includes('cc-toelet.10-02c.rebuke-first'));
});

test('TOELET-07 exaggeration true: draft observation for condition 4, no finding', () => {
  const entries = ALL_CONDITIONS_MET.map(([id, v]): [string, boolean] =>
    id === 'message.contains_falsehood_or_exaggeration' ? [id, true] : [id, v],
  );
  const r = run(storeWith(entries));
  assert.equal(r.findings.length, 0);
  assert.ok(
    r.draftObservations.some((d) => d.ruleId === 'cc-toelet.10-02d.no-exaggeration'),
    'expected draft observation naming the no-exaggeration condition',
  );
});

test('TOELET-08 hearsay without verification: question about facts_verified, no finding', () => {
  const entries = ALL_CONDITIONS_MET.filter(
    ([id]) => id !== 'speaker.knows_first_hand' && id !== 'toelet.facts_verified',
  );
  entries.push(['speaker.knows_first_hand', false]);
  const r = run(storeWith(entries));
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.findings.length, 0);
  assert.ok(r.missingFactIds.includes('toelet.facts_verified'));
  const q = r.questions.find((x) => x.factId === 'toelet.facts_verified');
  assert.ok(q, 'expected a question about toelet.facts_verified');
  assert.equal(q.questionHe, vocabById.get('toelet.facts_verified')?.questionHe);
});

test('TOELET-09 failed condition (another way exists): draft observation, still no ruling', () => {
  const entries = ALL_CONDITIONS_MET.map(([id, v]): [string, boolean] =>
    id === 'toelet.no_other_way' ? [id, false] : [id, v],
  );
  const r = run(storeWith(entries));
  assert.equal(r.findings.length, 0);
  assert.ok(r.draftObservations.some((d) => d.ruleId === 'cc-toelet.10-02f.no-other-way'));
});
