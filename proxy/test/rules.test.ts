import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFor, handle, type Env } from '../src/handler.js';
import {
  DRAFT_RULES_LIMITATION_HE, MAX_CONFIRMED_FACTS, pickConfirmedFacts, runLiveRules,
} from '../src/rules.js';
import {
  CC_TOELET_DRAFT_PACK, FACT_BY_ID, toeletPackFactIds, evaluate,
  type ExtractionOutcome, type ExtractorProvider, type MessageEnvelope,
} from '../../engine/src/index.js';

// Synthetic data only.
const ENV: Env = {
  LHG_BRAIN_BASE_URL: 'http://brain:1', LHG_BRAIN_TOKEN: 'brain-tok', LHG_ACCESS_KEY: 'k'.repeat(32),
};
const TEXT = 'רציתי להזהיר אתכם מהספק פלוני, הוא לא החזיר לי מקדמה. לא דיברתי איתו על זה.';

function provider(raw: unknown | Error): () => ExtractorProvider {
  return () => ({
    id: 'mock', modelVersion: 'm',
    async extract() {
      if (raw instanceof Error) throw raw;
      return raw;
    },
  });
}

function fact(id: string, value: boolean, evidenceExcerpt: string) {
  return { id, value, confidence: 0.9, evidenceExcerpt };
}

/** The model itself sees no concern; only the facts point at an unmet condition. */
const NO_CONCERN_WITH_FACTS = {
  directAssessment: 'no_concern',
  proposedFacts: [
    fact('subject.identifiable', true, 'הספק פלוני'),
    fact('message.content_is_disparaging', true, 'לא החזיר לי מקדמה'),
    fact('toelet.rebuke_attempted', false, 'לא דיברתי איתו על זה'),
  ],
};

function post(body: unknown, env: Env = ENV): Request {
  return new Request('https://proxy.test/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lhg-key': env.LHG_ACCESS_KEY },
    body: JSON.stringify(body),
  });
}

type Body = Record<string, unknown> & {
  alert: string; limitationsHe: string[];
  rules?: { mode: string; notChecked?: boolean; findings: Array<Record<string, string>>;
    referrals?: Array<{sectionKey:string; gatheredFacts: Array<{id:string;valueHe:string}>}>;
    question?: { factId: string; textHe: string; answers: Array<{ value: boolean | null; labelHe: string }> } };
};

const BANNED = /(^|[^א-ת])(מותר|אסור)([^א-ת]|$)/;

test('rules: group-D to-elet becomes a referral and keeps the check unresolved', async () => {
  const r = await handle(post({ text: TEXT, confirmedFacts: {
    'toelet.purpose_is_constructive': true,
    'toelet.knows_subject_will_not_accept_rebuke': false,
  } }), ENV, provider(NO_CONCERN_WITH_FACTS));
  const b = (await r.json()) as Body;
  assert.equal(b.alert, 'unsure');
  assert.equal(b.rules?.mode, 'live_draft');
  assert.equal(b.rules?.notChecked, undefined);
  const ids = b.rules!.findings.map((f) => f['ruleId']);
  assert.ok(!ids.includes('cc-toelet.10-02c.rebuke-first'), ids.join(','));
  assert.ok(b.rules?.referrals?.some(r=>r.sectionKey==='p1_prin10:2'));
  for (const f of b.rules!.findings) {
    assert.deepEqual(Object.keys(f).sort(), ['code', 'messageHe', 'ruleId', 'sourceRef', 'sourceUrl']);
    assert.match(f['sourceUrl']!, /^https:\/\/www\.sefaria\.org\/Chafetz_Chaim/);
    assert.ok(!BANNED.test(f['messageHe']!), f['messageHe']);
  }
  assert.ok(!b.limitationsHe.includes(DRAFT_RULES_LIMITATION_HE));
});

test('rules: an unknown rebuke exception is not an absent exception in the real handler', async () => {
  const response = await handle(post({ text: TEXT, confirmedFacts: {
    'toelet.purpose_is_constructive': true,
    'toelet.rebuke_attempted': false,
    'toelet.knows_subject_will_not_accept_rebuke': null,
  } }), ENV, provider(NO_CONCERN_WITH_FACTS));
  const body = await response.json() as Body;
  assert.equal(response.status, 200);
  assert.ok(!body.rules?.findings.some((finding) => finding['ruleId'] === 'cc-toelet.10-02c.rebuke-first'));
  assert.notEqual(body.rules?.question?.factId, 'toelet.knows_subject_will_not_accept_rebuke',
    'a user answer of unknown must not be asked again');
});

test('rules: the live adapter refers the missing rebuke exception to a rabbi', () => {
  const message = { id: 'synthetic', revision: 1, direction: 'outgoing', authorRef: 'user',
    platform: 'test', conversationId: 'synthetic', audienceSnapshot: {}, text: TEXT } as MessageEnvelope;
  const result = runLiveRules(message, undefined, {
    'subject.identifiable': true,
    'message.content_is_disparaging': true,
    'toelet.purpose_is_constructive': true,
    'toelet.rebuke_attempted': false,
  }, 'test', (input) => evaluate({ ...input, rulePack: {
    ...CC_TOELET_DRAFT_PACK,
    rules: CC_TOELET_DRAFT_PACK.rules.filter((rule) => rule.id === 'cc-toelet.10-02c.rebuke-first'),
  } }));
  assert.equal(result.notChecked, undefined);
  assert.equal(result.findings.length, 0);
  assert.equal(result.question, undefined);
  assert.ok(result.referrals?.some(r=>r.sectionKey==='p1_prin10:2'));
});

test('rules: findings never lower an alert; no finding leaves the extraction alert as is', () => {
  const warnOutcome = {
    status: 'extracted', providerCalled: true, normalizedText: '', gate: {} as never, errors: [], limitationsHe: [],
    extraction: { proposedFacts: [], directAssessment: 'concern', droppedFacts: [], warnings: [] },
  } as unknown as ExtractionOutcome;
  const empty = { mode: 'live_draft' as const, findings: [] };
  assert.equal(alertFor(warnOutcome, empty), 'warn');
  assert.equal(alertFor(warnOutcome, { ...empty, notChecked: true }), 'warn');
  for (const da of ['unsure', 'no_concern', null] as const) {
    const o = { ...warnOutcome, extraction: { ...warnOutcome.extraction!, directAssessment: da } } as ExtractionOutcome;
    const before = alertFor(o);
    assert.equal(alertFor(o, empty), before, 'no finding => unchanged');
    assert.equal(alertFor(o, { ...empty, notChecked: true }), before, 'notChecked => unchanged');
    const withFinding = alertFor(o, { ...empty, findings: [{ ruleId: 'x', code: 'X', messageHe: '', sourceRef: '', sourceUrl: '' }] });
    assert.equal(withFinding, 'warn');
    assert.notEqual(withFinding, 'none');
  }
  const failed = { ...warnOutcome, status: 'not_checked', extraction: undefined } as ExtractionOutcome;
  assert.equal(alertFor(failed, { ...empty, notChecked: true }), 'not_checked');
});

test('rules: a concern message without rule facts stays warn and asks one yes/no/unknown question', async () => {
  const raw = {
    directAssessment: 'concern',
    analysis: { questionsHe: ['Synthetic question one?', 'Synthetic question two?', 'Synthetic question three?'] },
    proposedFacts: [
      fact('subject.identifiable', true, 'הספק פלוני'),
      fact('message.content_is_disparaging', true, 'לא החזיר לי מקדמה'),
    ],
  };
  const b = (await (await handle(post({ text: TEXT }), ENV, provider(raw))).json()) as Body;
  assert.equal(b.alert, 'warn');
  const q = b.rules?.question;
  assert.ok(q, 'expected a clarification question');
  assert.deepEqual((b['analysis'] as { questionsHe?: string[] }).questionsHe, [], 'catalog question consumes the display budget');
  assert.ok(FACT_BY_ID.has(q.factId));
  assert.equal(q.textHe, FACT_BY_ID.get(q.factId)!.questionHe);
  assert.deepEqual(q.answers.map((a) => a.value), [true, false, null]);
  assert.deepEqual(q.answers.map((a) => a.labelHe), ['כן', 'לא', 'לא יודע']);
});

test('display: without a catalog question only one analysis question survives', async () => {
  const raw = { directAssessment: 'unsure', proposedFacts: [],
    analysis: { questionsHe: ['First?', 'Second?', 'Third?'] } };
  const response = await handle(post({ text: TEXT }), { ...ENV, LHG_CC_RULES: 'off' }, provider(raw));
  const body = await response.json() as { analysis: { questionsHe: string[] } };
  assert.deepEqual(body.analysis.questionsHe, ['First?']);
});

test('rules: confirmedFacts — invalid ids/values dropped silently, max 20, null = unknown', async () => {
  const picked = pickConfirmedFacts(JSON.parse(
    '{"toelet.rebuke_attempted":false,"not.a.fact":true,"toelet.no_other_way":"yes",' +
    '"toelet.facts_verified":1,"toelet.no_excess_harm":null,"__proto__":true,"constructor":true}'));
  assert.deepEqual({ ...picked }, { 'toelet.rebuke_attempted': false, 'toelet.no_excess_harm': null });
  for (const bad of [null, [], 'x', 3, [['toelet.rebuke_attempted', false]]]) {
    assert.deepEqual({ ...pickConfirmedFacts(bad) }, {});
  }
  const many: Record<string, boolean> = {};
  for (const e of [...FACT_BY_ID.keys()]) many[e] = true;
  assert.ok(Object.keys(many).length > MAX_CONFIRMED_FACTS);
  assert.equal(Object.keys(pickConfirmedFacts(many)).length, MAX_CONFIRMED_FACTS);

  // End to end: a bogus confirmedFacts field never breaks the check.
  const r = await handle(post({ text: TEXT, confirmedFacts: { 'x.y': true, 'toelet.rebuke_attempted': 'no' } }),
    ENV, provider({ directAssessment: 'no_concern', proposedFacts: [] }));
  assert.equal(r.status, 200);
  const b = (await r.json()) as Body;
  assert.equal(b.alert, 'none');
  assert.deepEqual(b.rules?.findings, []);
});

test('rules: a user answer makes a rule fire and is never re-asked; "don\'t know" is not false', async () => {
  const raw = {
    directAssessment: 'unsure',
    proposedFacts: [
      fact('subject.identifiable', true, 'הספק פלוני'),
      fact('message.content_is_disparaging', true, 'לא החזיר לי מקדמה'),
    ],
  };
  const yes = (await (await handle(post({ text: TEXT, confirmedFacts: {
    'toelet.rebuke_attempted': false,
    'toelet.purpose_is_constructive': true,
    'toelet.knows_subject_will_not_accept_rebuke': false,
  } }),
    ENV, provider(raw))).json()) as Body;
  assert.equal(yes.alert, 'unsure');
  assert.ok(!yes.rules!.findings.some((f) => f['ruleId'] === 'cc-toelet.10-02c.rebuke-first'));
  assert.ok(yes.rules?.referrals?.some(r=>r.sectionKey==='p1_prin10:2'));
  assert.notEqual(yes.rules!.question?.factId, 'toelet.rebuke_attempted');

  const dunno = (await (await handle(post({ text: TEXT, confirmedFacts: {
    'toelet.rebuke_attempted': null,
    'toelet.purpose_is_constructive': true,
    'toelet.knows_subject_will_not_accept_rebuke': false,
  } }),
    ENV, provider(raw))).json()) as Body;
  assert.ok(!dunno.rules!.findings.some((f) => f['ruleId'] === 'cc-toelet.10-02c.rebuke-first'),
    'null must stay unknown, never act as false');
  assert.notEqual(dunno.rules!.question?.factId, 'toelet.rebuke_attempted');
  assert.equal(dunno.alert, 'unsure');
});

test('rules: an evaluate failure is rules.notChecked and leaves the alert unchanged', async () => {
  const msg = { id: 'm', revision: 1, direction: 'outgoing', authorRef: 'user', platform: 't',
    conversationId: 'c', audienceSnapshot: {}, text: TEXT } as MessageEnvelope;
  const res = runLiveRules(msg, undefined, {}, 'm', () => { throw new Error('boom'); });
  assert.deepEqual(res, { mode: 'live_draft', notChecked: true, findings: [] });

  const failedExtraction = await handle(post({ text: TEXT }), ENV, provider(new Error('down')));
  const b = (await failedExtraction.json()) as Body;
  assert.equal(b.alert, 'not_checked');
  assert.equal(b.rules?.notChecked, true);
  assert.ok(!b.limitationsHe.includes(DRAFT_RULES_LIMITATION_HE));
});

test('rules: LHG_CC_RULES=off removes the field and the draft influence', async () => {
  const r = await handle(post({ text: TEXT }, ENV), { ...ENV, LHG_CC_RULES: 'off' }, provider(NO_CONCERN_WITH_FACTS));
  const b = (await r.json()) as Body;
  assert.equal(b.rules, undefined);
  assert.equal(b.alert, 'none');
});

test('rules: every fact the pack can ask about is a yes/no question', () => {
  for (const id of toeletPackFactIds()) {
    const e = FACT_BY_ID.get(id);
    assert.ok(e, `pack fact ${id} missing from FACT_CATALOG`);
    assert.match(e.questionHe, /^האם /, id);
  }
  assert.ok(CC_TOELET_DRAFT_PACK.rules.every((r) => r.source?.url));
});
