import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/handler.js';
import type { ExtractorRequest } from '../../engine/src/index.js';
const env: Env = { LHG_BRAIN_BASE_URL: 'https://brain.test', LHG_BRAIN_TOKEN: 'unused',
  LHG_ACCESS_KEY: 'legacy', LHG_ACCOUNT_BASE: 'https://center.test', LHG_ACCOUNT_KEY: 'partner-secret', LHG_CC_RULES: 'off' };
const post = (body: unknown, key = 'legacy') => new Request('https://proxy.test/check', {
  method: 'POST', headers: { 'x-lhg-key': key }, body: JSON.stringify(body) });
const raw = { proposedFacts: [], directAssessment: 'no_concern',
  needs: { requests: [{ id: 'recent', kind: 'get_recent', args: { n: 5 } }],
    questions: ['speaker.knows_first_hand'] } };
test('cloud needs survive provider validation; pending no_concern never becomes none, even at round 3', async () => {
  const seen: ExtractorRequest[] = [];
  const provider = () => ({ id: 'mock', modelVersion: 'synthetic', async extract(req: ExtractorRequest) { seen.push(req); return raw; } });
  for (const round of [1, 2, 3]) {
    const r = await handle(post({ text: 'Synthetic wording for a context check.', round }), env, provider);
    const b = await r.json() as any;
    assert.equal(b.alert, 'unsure'); assert.equal(b.needs.round, round);
    assert.equal(b.needs.maxRounds, 3); assert.equal(b.needs.requests.length, 1);
    assert.equal(b.needs.questions[0].factId, 'speaker.knows_first_hand');
  }
  assert.deepEqual(seen.map(r => r.round), [1, 2, 3]);
  for (const round of [0, 4, '2']) assert.equal((await handle(post({ text: 'Synthetic', round }), env, provider)).status, 400);
});
test('each follow-up reserves and settles separately; account service never gets message/context', async () => {
  const calls: any[] = [];
  const fetcher = (async (url: any, opts: any) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true, userId: 'same-account' }));
  }) as typeof fetch;
  const provider = () => ({ id: 'mock', modelVersion: 'synthetic', async extract(req: ExtractorRequest) {
    return req.round === 1 ? raw : { directAssessment: 'no_concern', proposedFacts: [] };
  } });
  for (const round of [1, 2]) {
    const b = await (await handle(post({ text: 'Synthetic-private-message', round,
      context: { version: 1, recentMessages: [{ text: 'Synthetic-private-excerpt', authorRef: 'p1', direction: 'incoming' }] } }, 'lap_synthetic'),
      env, provider, fetcher)).json() as any;
    assert.equal(b.alert, round === 1 ? 'unsure' : 'none');
  }
  assert.equal(calls.length, 6);
  assert.equal(calls.filter(c => c.path.endsWith('/begin')).length, 2);
  assert.equal(calls.filter(c => c.path.endsWith('/finish') && c.body.success === true).length, 2);
  assert.ok(!JSON.stringify(calls).includes('Synthetic-private'));
});
test('follow-up bypasses fast gate; it cannot erase an unresolved first round', async () => {
  let count = 0;
  const provider = () => ({ id: 'mock', modelVersion: 'synthetic', async extract() { count++; return raw; } });
  const r = await handle(post({ text: 'Synthetic context', round: 2 }),
    { ...env, LHG_GATE_URL: 'https://gate.test', LHG_GATE_KEY: 'synthetic' }, provider,
    (async () => new Response('{"p":0.01}')) as typeof fetch);
  assert.equal((await r.json() as any).alert, 'unsure'); assert.equal(count, 1);
});
