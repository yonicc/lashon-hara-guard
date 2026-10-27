// Coverage evidence is a review snapshot; CC_ALL_DRAFT_PACK remains the runtime source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { CC_ALL_DRAFT_PACK } from '../src/chafetzChaim/allPacks.js';
import { FACT_CATALOG } from '../src/index.js';
import { exprFactIds } from '../src/evalExpr.js';
import type { Expr, Rule } from '../src/types.js';

const repo = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, repo), 'utf8'));
type Binding = Pick<Rule, 'id' | 'source' | 'titleHe' | 'applicability' | 'conditions' | 'reviewStatus'> & {
  exceptions: Expr[]; requiredFacts: string[]; referencedFactIds: string[];
};
interface Section {
  key: string; ref: string; url: string; textSha256: string; cardId: string;
  status: 'partial_semantic' | 'documentary';
  semanticBranchesHe: string; implementedScopeHe: string; unimplementedHe: string;
  chatFeasibility: string; ruleIds: string[]; runtimeBindings: Binding[];
  cardDraftInputs: { reviewStatus: string; conditionsHe: string[]; exceptionsHe: string[];
    reviewIssues: string[]; uncertainHe: string[] };
}
interface Card {
  id: string; ref: string; url: string; textSha256: string; reviewStatus: string;
  conditionsHe: string[]; exceptionsHe: string[]; reviewIssues?: string[]; uncertainHe?: string[];
}
const coverage = json('engine/src/chafetzChaim/sourceCoverage.json') as {
  schemaVersion: number; status: string;
  snapshot: { ruleCount: number; vocabularyFactCount: number; catalogCount: number;
    principleCount: number; sectionCount: number };
  sections: Section[];
};
const manifest = json('sources/chafetz-chaim/manifest.json') as {
  principles: { key: string; seifim: { n: number; ref: string; url: string; sha256: string }[] }[];
};
const cards = new Map<string, Card>();
for (const file of readdirSync(new URL('rules/chafetz-chaim/cards/', repo))) {
  if (!file.endsWith('.json')) continue;
  for (const c of json('rules/chafetz-chaim/cards/' + file) as Card[]) {
    assert.ok(!cards.has(c.id), 'duplicate card ' + c.id);
    cards.set(c.id, c);
  }
}
const byKey = new Map(coverage.sections.map(s => [s.key, s]));
const factIds = new Set(FACT_CATALOG.map(f => f.id));
function binding(rule: Rule): Binding {
  return { id: rule.id, source: rule.source, titleHe: rule.titleHe,
    applicability: rule.applicability, conditions: rule.conditions,
    exceptions: rule.exceptions ?? [], requiredFacts: rule.requiredFacts ?? [],
    reviewStatus: rule.reviewStatus,
    referencedFactIds: [...new Set([
      ...exprFactIds(rule.applicability), ...exprFactIds(rule.conditions),
      ...(rule.exceptions ?? []).flatMap(e => [...exprFactIds(e)]),
      ...(rule.requiredFacts ?? []),
    ])].sort() };
}

test('COV-01 exactly all 177 source sections, with no duplicate or orphan', () => {
  const expected = manifest.principles.flatMap(p => p.seifim.map(s => p.key + ':' + s.n));
  assert.equal(expected.length, 177);
  assert.equal(coverage.schemaVersion, 2);
  assert.equal(coverage.status, 'draft_coverage_not_approval');
  assert.equal(byKey.size, coverage.sections.length, 'duplicate coverage key');
  assert.deepEqual([...byKey.keys()].sort(), expected.sort());
  assert.deepEqual(coverage.snapshot, {
    ...coverage.snapshot,
    ruleCount: CC_ALL_DRAFT_PACK.rules.length,
    vocabularyFactCount: json('rules/chafetz-chaim/facts.json').facts.length,
    catalogCount: FACT_CATALOG.length,
    principleCount: manifest.principles.length, sectionCount: expected.length,
  });
});

test('COV-02 source text -> manifest -> draft card -> coverage identity and hash', () => {
  for (const p of manifest.principles) {
    const texts = new Map<number, string>();
    for (const line of readFileSync(new URL('sources/chafetz-chaim/text/' + p.key + '.txt', repo), 'utf8').split(/\r?\n/)) {
      const m = /^\[(\d+)\] (.*)$/.exec(line);
      if (m) texts.set(Number(m[1]), m[2]!);
    }
    for (const source of p.seifim) {
      const key = p.key + ':' + source.n;
      const s = byKey.get(key)!;
      const text = texts.get(source.n);
      assert.ok(text, key + ': actual source missing');
      assert.equal(createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
        source.sha256, key + ': actual source hash');
      assert.equal(s.cardId, 'cc.' + p.key + '.' + source.n, key);
      const c = cards.get(s.cardId);
      assert.ok(c, key + ': card missing');
      for (const evidence of [c, s]) {
        assert.equal(evidence.ref, source.ref, key);
        assert.equal(evidence.url, source.url, key);
        assert.equal(evidence.textSha256, source.sha256, key);
      }
      assert.equal(c.reviewStatus, 'draft', key);
      assert.deepEqual(s.cardDraftInputs, {
        reviewStatus: c.reviewStatus, conditionsHe: c.conditionsHe, exceptionsHe: c.exceptionsHe,
        reviewIssues: c.reviewIssues ?? [], uncertainHe: c.uncertainHe ?? [],
      }, key + ': preserve card conditions/exceptions as draft inputs');
    }
  }
});

test('COV-03 every real rule is linked once by its primary source URL and exact predicates', () => {
  const mapped: string[] = [];
  const urls = new Set(coverage.sections.map(s => s.url));
  for (const r of CC_ALL_DRAFT_PACK.rules) assert.ok(r.source?.url && urls.has(r.source.url), r.id + ': source absent');
  for (const s of coverage.sections) {
    const actual = CC_ALL_DRAFT_PACK.rules.filter(r => r.source?.url === s.url);
    assert.deepEqual(s.ruleIds, actual.map(r => r.id), s.key + ': stale or invented primary link');
    assert.deepEqual(s.runtimeBindings, actual.map(binding), s.key + ': runtime drift');
    assert.equal(s.status, actual.length ? 'partial_semantic' : 'documentary', s.key);
    for (const r of s.runtimeBindings) {
      assert.equal(r.reviewStatus, 'draft', r.id);
      for (const id of r.referencedFactIds) assert.ok(factIds.has(id), r.id + ': unknown fact ' + id);
    }
    mapped.push(...s.ruleIds);
  }
  assert.equal(new Set(mapped).size, mapped.length, 'rule counted under multiple sources');
  assert.deepEqual(mapped.sort(), CC_ALL_DRAFT_PACK.rules.map(r => r.id).sort());
});

test('COV-04 each source retains a distinct limitation instead of chapter boilerplate or full coverage', () => {
  const allowed = new Set(['external_evidence', 'not_implemented', 'not_message_decision']);
  for (const s of coverage.sections) {
    assert.ok(s.semanticBranchesHe.trim(), s.key + ': missing semantic branches');
    assert.ok(s.implementedScopeHe.trim(), s.key + ': missing implementation scope');
    assert.ok(s.unimplementedHe.trim(), s.key + ': missing limitation');
    assert.ok(allowed.has(s.chatFeasibility), s.key + ': unsupported feasibility claim');
    assert.ok(['partial_semantic', 'documentary'].includes(s.status), s.key + ': full coverage claim');
  }
  // This catches the prior repeated chapter-level explanation; it cannot prove exegesis.
  assert.equal(new Set(coverage.sections.map(s => s.unimplementedHe)).size, 177,
    'source-specific limitations must not collapse to repeated chapter boilerplate');
});

test('COV-05 publicity exceptions and new pressure reminders are primary links, not inferred coverage', () => {
  for (const [key, id] of [
    ['p1_prin1:5', 'cc-speech.1-05.authority-request'],
    ['p1_prin1:6', 'cc-speech.1-06.livelihood-pressure'],
    ['p1_prin1:7', 'cc-speech.1-07.social-pressure'],
    ['p1_prin1:9', 'cc-speech.1-09.self-disparagement'],
    ['p2_prin1:5', 'cc-rechilut.1-05.authority-request'],
    ['p2_prin1:6', 'cc-rechilut.1-06.livelihood-pressure'],
    ['p2_prin1:7', 'cc-rechilut.1-07.social-pressure'],
    ['p1_prin10:7', 'cc-context.10-07.public-rebuke-exception'],
    ['p1_prin10:8', 'cc-context.10-08.retaliation-review'],
    ['p1_prin10:9', 'cc-context.10-09.established-speaker'],
  ] as const) {
    assert.ok(byKey.get(key)!.ruleIds.includes(id), key + ': source-specific rule missing');
    assert.equal(byKey.get(key)!.status, 'partial_semantic');
  }
  const publicity = byKey.get('p1_prin10:7')!.runtimeBindings[0]!;
  assert.ok(publicity.referencedFactIds.includes('speaker.fears_retaliation_from_subject'));
  for (const id of ['speaker.publicly_known_impartial', 'speaker.publicly_known_says_in_presence',
    'speaker.publicly_known_fearless', 'speaker.publicly_known_truthful']) {
    assert.ok(publicity.referencedFactIds.includes(id), id);
  }
  assert.deepEqual(byKey.get('p2_prin8:5')!.ruleIds, ['cc-rechilut.8-05.secret']);
});
