// End-to-end (Node): trained router -> getters -> the REAL extension LocalMemory (via harness.mjs).
// Synthetic data only. Run from engine/ (tsx resolves the canonical TS sources):
//   $env:LHG_ROUTER_DIR='D:\lhg-router-models'; $env:LHG_ROUTER_NAME='r2-xlmr'
//   $env:LHG_ROUTER_SUMMARY='..\classifier\results\router\summary_r2_int8.json'; $env:LHG_ROUTER_TH='r2-xlmr-int8'
//   $env:NODE_PATH='..\research\local-router\node_modules'
//   node --import tsx --test ../research/local-router/integration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeContextPacket } from '../../engine/src/contextPacket.ts';
import { BUDGET, createGetters, runPlan } from './getters.mjs';
import { loadRouter, makeMemory, thresholdsFrom } from './harness.mjs';

const { LHG_ROUTER_DIR: DIR, LHG_ROUTER_NAME: NAME, LHG_ROUTER_SUMMARY: SUMMARY } = process.env;
const TH_RUN = process.env.LHG_ROUTER_TH || NAME;
const SCOPE = { platform: 'whatsapp-web', accountId: 'acct-synthetic', conversationId: 'conv-synthetic-1' };
const OTHER = { ...SCOPE, conversationId: 'conv-synthetic-2' };
const OTHER_SECRET = 'הגזבר חייב כסף לקופה-סוד-של-שיחה-אחרת';
const HOUR = 3600000;

const memory = await makeMemory();
const now = Date.now();
const ev = (scope, id, text, ageH, direction = 'incoming') => memory.ingest({ enabled: true, type: 'message_observed',
  scope, sourceId: id, direction, text, observedAt: now - ageH * HOUR });
await ev(SCOPE, 'm-1', 'בחודש שעבר דיברנו על זה שהוועד לא מפרסם את הדוחות הכספיים', 72);
await ev(SCOPE, 'm-2', 'מי מגיע לאסיפה ביום שלישי?', 30);
await ev(SCOPE, 'm-3', 'אני אביא כיסאות', 29, 'outgoing');
await ev(SCOPE, 'm-4', 'הוועד שוב לא ענה למיילים של הדיירים', 2);
await ev(OTHER, 'x-1', OTHER_SECRET, 1);
const route = await loadRouter(DIR, NAME, thresholdsFrom(SUMMARY, TH_RUN));
const packet = sanitizeContextPacket({ version: 1, platform: 'whatsapp', direction: 'outgoing',
  conversationRef: 'c1', conversationKind: 'group', participants: [{ ref: 'self', isSelf: true }, { ref: 'p1' }, { ref: 'p2' }],
  currentAuthorRef: 'self', recentMessages: [], facts: [], relationships: [] });

test('prior-knowledge message: router asks for stored context; getters return in-scope snippets only, in budget', async () => {
  const text = 'כמו שכבר דיברנו, ההתנהלות של הוועד בעייתית';
  const r = await route(text);
  console.log('router', JSON.stringify(r));
  assert.ok(r.ms < 150, `router decision ${r.ms}ms > 150ms`);
  assert.ok(r.labels.includes('mem_search') || r.labels.includes('mem_recent'), 'router must ask for stored context');
  const out = await runPlan({ getters: createGetters({ packet, memory: memory.tools(SCOPE) }), labels: r.labels, messageText: text });
  console.log('plan', JSON.stringify(out.trace), out.totalMs + 'ms');
  assert.ok(out.totalMs <= BUDGET.totalMs);
  const got = JSON.stringify(out.results);
  assert.ok(got.includes('הוועד'), 'expected an in-scope memory snippet');
  assert.ok(!got.includes(OTHER_SECRET), 'cross-conversation leak');
  assert.ok(!/"m-\d"/.test(got), 'memory sourceIds must not leave the getters');
  assert.ok(!JSON.stringify(out.trace).includes('הוועד'), 'trace must hold no text');
});

test('self-contained harmless message: no stored lookup', async () => {
  const r = await route('תודה רבה לכולם על העזרה, נתראה מחר בשמונה');
  console.log('router', JSON.stringify(r));
  assert.ok(!r.labels.includes('mem_search'), JSON.stringify(r.labels));
});

test('search_history path: real e5 retrieval finds the older in-scope message within budget', async () => {
  const text = 'הוועד עדיין מסתיר את המאזן של הבניין';
  const out = await runPlan({ getters: createGetters({ packet, memory: memory.tools(SCOPE) }), labels: ['mem_search'], messageText: text });
  console.log('search plan', JSON.stringify(out.trace), out.totalMs + 'ms');
  const hits = out.results.search_history;
  assert.equal(hits.status, 'ok', JSON.stringify(hits));
  assert.ok(hits.value.some((h) => h.snippet.includes('הדוחות הכספיים')), JSON.stringify(hits.value.map((h) => h.score)));
  assert.ok(!JSON.stringify(hits).includes(OTHER_SECRET), 'cross-conversation leak');
  assert.ok(out.totalMs <= BUDGET.totalMs);
});

test('memory unavailable: same plan degrades to unknown, never throws', async () => {
  const broken = { get_recent: async () => { throw Error('memory-unavailable'); },
    search_history: async () => { throw Error('memory-unavailable'); } };
  const out = await runPlan({ getters: createGetters({ packet, memory: broken }), labels: ['mem_recent', 'mem_search'], messageText: 'x' });
  assert.equal(out.results.search_history.status, 'unknown');
  assert.equal(out.results.get_recent.status, 'unknown');
});
