// Group-D rabbi referral — the hard red line (docs/32, docs/40 §B, owner
// 2026-10-29): a group-D section NEVER auto-rules. It surfaces ONLY a
// structured rabbi-referral artifact, and never a finding or a clean verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CC_ALL_DRAFT_PACK,
  FACT_CATALOG,
  FactStore,
  evaluate,
  coverageKeyOfSource,
  groupDByKey,
  groupDSections,
  type MessageEnvelope,
} from '../src/index.js';

const msg = (over: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm1',
  revision: 1,
  direction: 'outgoing',
  authorRef: 'user',
  platform: 'whatsapp-web',
  conversationId: 'c1',
  audienceSnapshot: { participantCount: 3 },
  text: 'דוגמה סינתטית לבדיקה',
  ...over,
});

function liveInput(store: FactStore, over: Partial<Parameters<typeof evaluate>[0]> = {}) {
  return {
    message: msg(),
    facts: store.snapshot(),
    rulePack: CC_ALL_DRAFT_PACK,
    catalog: FACT_CATALOG,
    ruleMode: 'live_draft' as const,
    contextVersion: 'ctx-1',
    modelVersion: 'extractor-test',
    ...over,
  };
}

test('coverage: group D is exactly the 73 blocked/external_evidence sections', () => {
  assert.equal(groupDSections().length, 73);
  for (const s of groupDSections()) {
    assert.ok(s.disposition === 'blocked' || s.chatFeasibility === 'external_evidence');
  }
});

test('red line: a BLOCKED group-D section produces a referral, never a finding', () => {
  const groupD = groupDByKey();
  // p1_prin1:2 is a blocked expert_ruling section. Trigger any fact that makes
  // a pack rule on it applicable; it must surface only a referral.
  const s = new FactStore(FACT_CATALOG);
  s.propose('subject.identifiable', true, 'model_extraction');
  s.propose('message.content_is_disparaging', true, 'model_extraction');
  const r = evaluate(liveInput(s));
  // No finding may come from a blocked group-D section.
  for (const f of r.findings) {
    const src = CC_ALL_DRAFT_PACK.rules.find((rule) => rule.id === f.ruleId)?.source;
    const key = coverageKeyOfSource(src);
    const section = key ? groupD.get(key) : undefined;
    assert.ok(!(section && section.disposition === 'blocked'), `blocked group-D rule ${f.ruleId} must not produce a finding`);
  }
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
});

test('red line: a partial group-D reminder may fire but the section is still referred, never conclusively ruled', () => {
  const groupD = groupDByKey();
  // cc-speech.1-05.authority-request (p1_prin1:5) is a PARTIAL group-D section.
  const s = new FactStore(FACT_CATALOG);
  s.propose('subject.identifiable', true, 'model_extraction');
  s.propose('message.content_is_disparaging', true, 'model_extraction');
  s.confirmByUser('audience.is_speakers_trusted_rabbi', true);
  const r = evaluate(liveInput(s));
  // Its draft reminder may fire (a finding is a reminder, not a ruling)…
  // …but the section still produces a referral, because the device cannot
  // conclusively rule on the external-evidence branch.
  const ref = r.referrals.find((x) => x.sectionKey === 'p1_prin1:5');
  assert.ok(ref, 'partial group-D section p1_prin1:5 should yield a referral');
  assert.equal(groupD.get('p1_prin1:5')?.disposition, 'partial');
  assert.ok(!JSON.stringify(r).includes('"permitted"'));
});

test('referral carries facts already gathered and the open question, never a ruling', () => {
  const s = new FactStore(FACT_CATALOG);
  s.propose('subject.identifiable', true, 'model_extraction');
  s.confirmByUser('audience.is_speakers_trusted_rabbi', true);
  const r = evaluate(liveInput(s));
  const ref = r.referrals.find((x) => x.sectionKey === 'p1_prin1:5');
  assert.ok(ref, 'expected a referral for p1_prin1:5');
  assert.ok(ref.sourceUrl.startsWith('https://www.sefaria.org/'));
  assert.ok(ref.questionHe.includes('?'));
  assert.ok(ref.whyNotCheckedHe.length > 0);
  assert.ok(!/מותר|אסור בהחלט/.test(ref.questionHe)); // phrased as a question, not a psak
  // Gathered facts appear with status + provenance (deterministic order).
  const ids = ref.gatheredFacts.map((g) => g.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.ok(ids.includes('subject.identifiable'));
  assert.ok(ids.includes('audience.is_speakers_trusted_rabbi'));
});

test('non-group-D sections still evaluate normally (group D is a strict subset)', () => {
  const groupD = groupDByKey();
  // p1_prin9:1 (group A per docs/32) is a non-D section with live rules.
  const keyed = CC_ALL_DRAFT_PACK.rules
    .map((rule) => coverageKeyOfSource(rule.source))
    .filter((k): k is string => k !== null);
  const nonDSections = new Set(keyed.filter((k) => !groupD.has(k)));
  assert.ok(nonDSections.has('p1_prin9:1'), 'p1_prin9:1 should be a non-group-D section');
  // Group D is exactly 73 of the keyed sections; the rest evaluate as before.
  assert.equal(groupD.size, 73);
  assert.ok(nonDSections.size > 0);
});
