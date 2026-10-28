// Unit tests for the local-router getters contract (docs/34 §4, docs/35). Synthetic fixtures only.
// Run from engine/ (tsx resolves the canonical TS sources):
//   cd engine; node --import tsx --test ../research/local-router/getters.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeContextPacket } from '../../engine/src/contextPacket.ts';
import { FACT_CATALOG } from '../../engine/src/lessonScenario.ts';
import { BUDGET, MAX_SNIPPET, createGetters, planFromLabels, runPlan } from './getters.mjs';

const SECRET_NAME = 'Zevulun-Fixture-Name';
const LONG = 'א'.repeat(900);
const MSG = 'אבי שוב עשה את זה, כמו שכולם כבר יודעים';

const rawPacket = {
  version: 1, platform: 'whatsapp', direction: 'outgoing', conversationRef: 'c-synthetic-1',
  conversationKind: 'group', participants: [{ ref: 'self', isSelf: true }, { ref: 'p1' }, { ref: 'p2' }],
  currentAuthorRef: 'self',
  recentMessages: [
    { authorRef: 'p1', direction: 'incoming', text: 'מה עם הדוח של ' + SECRET_NAME + '?', ageMinutes: 3 },
    { authorRef: 'p2', direction: 'incoming', text: LONG, ageMinutes: 1 },
  ],
  facts: [], relationships: [], event: { kind: 'lesson', teacherRef: 'p2' },
};
const packet = () => sanitizeContextPacket(structuredClone(rawPacket));

// Same shape as research/local-memory/memory.mjs LocalMemory.tools(scope) (scope bound by the app).
function fakeMemory({ delayMs = 0, rows = null, fail = false } = {}) {
  const data = rows ?? [
    { ref: 'wa:msg:SECRET-SOURCE-ID-1', text: 'כבר דיברנו על זה בחודש שעבר ' + LONG, direction: 'incoming', observedAt: Date.now() - 120000 },
    { ref: 'wa:msg:SECRET-SOURCE-ID-2', text: 'סיכום הישיבה', direction: 'outgoing', observedAt: Date.now() - 60000 },
  ];
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  const calls = [];
  return {
    calls,
    async get_recent({ k }) { calls.push(['get_recent', k]); await wait(); if (fail) throw Error('boom'); return data.slice(0, k); },
    async search_history({ query, top_k }) {
      calls.push(['search_history', query.length, top_k]); await wait(); if (fail) throw Error('boom');
      return data.slice(0, top_k).map((r, i) => ({ ...r, score: 0.9 - i / 10 }));
    },
  };
}
// ask_user -> one catalog fact; which one is the engine's question planner's choice, not the router's.
const QF = { ask_user: 'relationships.teacher_is_parent' };

test('fixtures use only canonical catalog facts and a sanitized packet', () => {
  const ids = new Set(FACT_CATALOG.map((f) => f.id));
  assert.ok(ids.has(QF.ask_user), 'question fact must exist in FACT_CATALOG');
  assert.ok(packet(), 'fixture packet must pass sanitizeContextPacket');
});

test('unknown, never false: every missing fact is status unknown', async () => {
  const g = createGetters({ packet: sanitizeContextPacket({ ...structuredClone(rawPacket), recentMessages: [],
    participants: [], conversationKind: 'unknown', event: undefined }) });
  for (const [name, args] of [['get_recent', {}], ['get_participants'], ['get_thread'], ['get_event'],
    ['search_history', { query: 'x' }], ['propose_question', { label: 'ask_user' }]]) {
    const r = await g[name](args);
    assert.equal(r.status, 'unknown', name);
    assert.equal(r.value, undefined, name + ' must not carry a value (no false/empty answer)');
  }
});

test('participant count is unknown unless independently known', async () => {
  const g = createGetters({ packet: packet() });
  const r = await g.get_participants();
  assert.equal(r.value.count, 'unknown');
  assert.deepEqual(r.value.refs, ['self', 'p1', 'p2']);
});

test('snippets are clipped to 300 and memory sourceIds never leave the getter', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory() });
  const rec = await g.get_recent({ k: 2 });
  const hist = await g.search_history({ query: MSG });
  for (const x of [...rec.value, ...hist.value]) {
    assert.ok((x.text ?? x.snippet).length <= MAX_SNIPPET);
    assert.match(x.ref, /^m\d+$/);
    assert.equal(x.status, 'candidate', 'observed context is a candidate, never a confirmed fact');
  }
  assert.ok(!JSON.stringify([rec, hist]).includes('SECRET-SOURCE-ID'));
});

test('budgets: k<=5, top_k<=3, query<=300 enforced before the memory is called', async () => {
  const mem = fakeMemory();
  const g = createGetters({ packet: packet(), memory: mem });
  assert.equal((await g.get_recent({ k: 6 })).status, 'unknown');
  assert.equal((await g.search_history({ query: 'x', top_k: 4 })).status, 'unknown');
  await g.search_history({ query: LONG });
  assert.deepEqual(mem.calls, [['search_history', MAX_SNIPPET, 3]]);
});

test('plan: 3 heads map to ordered getters; packet reads first, question last; nothing fires -> no plan', () => {
  const p = planFromLabels(['ask_user', 'mem_search', 'mem_recent']).map((s) => s.name);
  assert.deepEqual(p, ['get_thread', 'get_participants', 'get_event', 'get_recent', 'search_history', 'propose_question']);
  assert.deepEqual(planFromLabels(['ask_user']).map((s) => s.name), ['get_participants', 'get_event', 'propose_question']);
  assert.deepEqual(planFromLabels([]), []);
  assert.deepEqual(planFromLabels(['not_a_label']), []);
});

test('runPlan respects maxCalls (memory/question calls only) and marks the rest unknown(budget)', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory(), questionFacts: QF });
  const r = await runPlan({ getters: g, messageText: MSG, budget: { ...BUDGET, maxCalls: 1 },
    labels: ['mem_recent', 'mem_search'] });
  assert.equal(r.trace.filter((e) => ['get_recent', 'search_history', 'propose_question'].includes(e.getter)).length, 1);
  assert.equal(r.stopped, 'max-calls');
  assert.equal(r.results.search_history.reason, 'budget');
});

test('per-call timeout -> unknown(timeout); total stays within the 400ms budget', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory({ delayMs: 500 }) });
  const t0 = performance.now();
  const r = await runPlan({ getters: g, labels: ['mem_recent', 'mem_search'], messageText: MSG });
  const ms = performance.now() - t0;
  assert.equal(r.results.get_recent.status, 'unknown');
  assert.equal(r.results.get_recent.reason, 'timeout');
  assert.ok(ms < BUDGET.totalMs, `took ${ms}ms`);
});

test('total budget cuts later getters even when each call is under its own limit', async () => {
  let t = 0;
  const clock = () => t;
  const slow = { get_thread: async () => { t += 390; return { status: 'ok', value: { threadIdKnown: true } }; },
    get_participants: async () => { t += 20; return { status: 'ok', value: {} }; },
    get_event: async () => ({ status: 'ok', value: {} }), get_recent: async () => ({ status: 'ok', value: [] }) };
  const r = await runPlan({ getters: slow, labels: ['mem_recent'], clock });
  assert.equal(r.results.get_recent.reason, 'budget');
  assert.equal(r.stopped, 'total-budget');
});

test('memory failure never throws: unknown(error), expansion simply absent', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory({ fail: true }) });
  const r = await runPlan({ getters: g, labels: ['mem_search'], messageText: MSG });
  assert.equal(r.results.search_history.status, 'unknown');
  assert.equal(r.results.search_history.reason, 'error');
});

test('no thread identity -> no stored lookup at all', async () => {
  const mem = fakeMemory();
  const g = createGetters({ packet: sanitizeContextPacket({ ...structuredClone(rawPacket), conversationKind: 'unknown' }),
    memory: mem });
  const r = await runPlan({ getters: g, labels: ['mem_recent', 'mem_search'], messageText: MSG });
  assert.equal(r.results.get_recent.reason, 'no-thread-identity');
  assert.equal(r.results.search_history.reason, 'no-thread-identity');
  assert.equal(mem.calls.length, 0);
});

test('questions: propose_question queues up to MAX_QUESTIONS distinct facts, ends expansion, never answers', async () => {
  const g = createGetters({ packet: packet(), questionFacts: QF });
  const r = await runPlan({ getters: g, labels: ['ask_user'] });
  assert.equal(r.stopped, 'question-queued');
  assert.deepEqual(r.results.propose_question.value, { queued: true, factId: QF.ask_user, queuedCount: 1 });
  assert.ok(!('answer' in r.results.propose_question.value));
  // The same fact is never queued twice.
  const dup = await g.propose_question({ label: 'ask_user' });
  assert.equal(dup.value.queued, false);
  assert.equal(dup.value.reason, 'question-already-queued');
});

test('questions: the queue is capped at 5 distinct catalog facts', async () => {
  // Six distinct ask_user-style labels, each mapped to its own catalog fact.
  const QF6 = { a1: 'relationships.teacher_is_parent', a2: 'subject.identifiable',
    a3: 'message.content_is_disparaging', a4: 'message.may_be_understood_as_disparagement',
    a5: 'message.purpose', a6: 'toelet.rebuke_attempted' };
  const g = createGetters({ packet: packet(), questionFacts: QF6 });
  const queued = [];
  for (const l of Object.keys(QF6)) {
    const r = await g.propose_question({ label: l });
    if (r.value?.queued) queued.push(r.value.factId);
  }
  assert.equal(queued.length, 5, 'never more than 5 queued questions');
  assert.equal(new Set(queued).size, 5, 'all queued facts are distinct');
  const seventh = await g.propose_question({ label: 'a1' });
  assert.equal(seventh.value.queued, false);
});

test('trace carries no text, names, refs or query', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory(), questionFacts: QF });
  const r = await runPlan({ getters: g, messageText: MSG + ' ' + SECRET_NAME,
    labels: ['mem_recent', 'mem_search', 'ask_user'] });
  const s = JSON.stringify(r.trace);
  for (const needle of [SECRET_NAME, 'אבי', 'SECRET-SOURCE-ID', 'p1', 'p2', 'c-synthetic-1', 'דיברנו', 'm1'])
    assert.ok(!s.includes(needle), 'trace leaked ' + needle);
  for (const e of r.trace) assert.deepEqual(Object.keys(e).sort(), ['getter', 'ms', 'reason', 'status']);
});

test('the router never emits a verdict: results have no allow/permitted field', async () => {
  const g = createGetters({ packet: packet(), memory: fakeMemory(), questionFacts: QF });
  const r = await runPlan({ getters: g, labels: ['mem_recent', 'mem_search', 'ask_user'], messageText: MSG });
  assert.ok(!/permit|allowed|mutar|verdict/i.test(JSON.stringify(Object.keys(r).concat(Object.keys(r.results)))));
});
