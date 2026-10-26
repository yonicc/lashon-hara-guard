import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, MAX_CONTEXT_JSON_CHARS, MAX_TEXT_CHARS, type Env } from '../src/handler.js';
import type { ExtractorProvider, ExtractorRequest } from '../../engine/src/index.js';

const ENV: Env = {
  LHG_BRAIN_BASE_URL: 'http://brain:1', LHG_BRAIN_TOKEN: 'brain-tok', LHG_ACCESS_KEY: 'k'.repeat(32),
};

function provider(raw: unknown | Error, seen: string[] = []): () => ExtractorProvider {
  return () => ({
    id: 'mock', modelVersion: 'm',
    async extract(req) {
      seen.push(req.text);
      if (raw instanceof Error) throw raw;
      return raw;
    },
  });
}

/** Captures the full ExtractorRequest the proxy built (for context assertions). */
function capturingProvider(raw: unknown, seenReqs: ExtractorRequest[]): () => ExtractorProvider {
  return () => ({
    id: 'mock', modelVersion: 'm',
    async extract(req: ExtractorRequest) {
      seenReqs.push(req);
      return raw;
    },
  });
}

function post(body: unknown, key = ENV.LHG_ACCESS_KEY, path = '/check'): Request {
  return new Request('https://proxy.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lhg-key': key },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const IRONY = 'וואו, איזה גאון, שוב הגיע באיחור';
const CONCERN = {
  proposedFacts: [],
  meaning: { mayBeUnderstoodAsDisparagement: true, mechanism: 'irony', evidenceExcerpt: 'איזה גאון', identifiable: true, extractorConfidence: 0.8 },
  directAssessment: 'concern',
};

test('proxy: wrong or missing key is 401 and never reaches the model', async () => {
  const seen: string[] = [];
  for (const key of ['', 'wrong', 'k'.repeat(31)]) {
    const r = await handle(post({ text: IRONY }, key), ENV, provider(CONCERN, seen));
    assert.equal(r.status, 401);
  }
  assert.equal(seen.length, 0);
});

test('proxy: concern/meaning becomes alert=warn with mechanism and evidence', async () => {
  const r = await handle(post({ text: IRONY, platform: 'whatsapp-web' }), ENV, provider(CONCERN));
  assert.equal(r.status, 200);
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'warn');
  assert.equal(b['mechanism'], 'irony');
  assert.equal(b['evidence'], 'איזה גאון');
});

test('proxy: no_concern -> none, unsure -> unsure', async () => {
  const none = await handle(post({ text: 'תודה רבה לדוד' }), ENV,
    provider({ proposedFacts: [], directAssessment: 'no_concern' }));
  assert.equal(((await none.json()) as Record<string, unknown>)['alert'], 'none');
  const unsure = await handle(post({ text: 'כולם יודעים למה הוא עזב' }), ENV,
    provider({ proposedFacts: [], directAssessment: 'unsure' }));
  assert.equal(((await unsure.json()) as Record<string, unknown>)['alert'], 'unsure');
});

test('proxy: provider failure is not_checked, never none', async () => {
  const r = await handle(post({ text: IRONY }), ENV, provider(new Error('down')));
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'not_checked');
  assert.equal(b['status'], 'not_checked');
});

test('proxy: MVP calls the model even without local cues (LHG_ALWAYS_EXTRACT default)', async () => {
  const seen: string[] = [];
  await handle(post({ text: 'יוסי שוב שכח לשלם, כרגיל אצלו' }), ENV, provider(CONCERN, seen));
  assert.equal(seen.length, 1);
  const off = await handle(post({ text: 'הפגישה נדחתה למחר' }), { ...ENV, LHG_ALWAYS_EXTRACT: '0' },
    provider(CONCERN, seen));
  assert.equal(((await off.json()) as Record<string, unknown>)['alert'], 'none');
  assert.equal(seen.length, 1); // gate skipped, no model call
});

test('proxy: input limits and routing', async () => {
  assert.equal((await handle(post({ text: '' }), ENV, provider(CONCERN))).status, 400);
  assert.equal((await handle(post('{bad'), ENV, provider(CONCERN))).status, 400);
  assert.equal((await handle(post({ text: 'א'.repeat(MAX_TEXT_CHARS + 1) }), ENV, provider(CONCERN))).status, 413);
  assert.equal((await handle(post({ text: IRONY }, ENV.LHG_ACCESS_KEY, '/other'), ENV, provider(CONCERN))).status, 404);
  const opt = await handle(new Request('https://proxy.test/check', { method: 'OPTIONS' }), ENV, provider(CONCERN));
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-headers'), 'content-type, x-lhg-key');
});

test('proxy: rate limiter refusal is 429', async () => {
  const env: Env = { ...ENV, LIMITER: { limit: async () => ({ success: false }) } };
  const r = await handle(post({ text: IRONY }), env, provider(CONCERN));
  assert.equal(r.status, 429);
});

test('proxy: missing Brain config is 503', async () => {
  const r = await handle(post({ text: IRONY }), { ...ENV, LHG_BRAIN_TOKEN: '' });
  assert.equal(r.status, 503);
});

const GATED: Env = { ...ENV, LHG_GATE_URL: 'https://gate.test', LHG_GATE_KEY: 'g' };

function gateFetch(answer: number | Error | 'slow', calls: string[] = []): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal((init?.headers as Record<string, string>)['x-gate-key'], 'g');
    if (answer instanceof Error) throw answer;
    if (answer === 'slow') {
      return new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    }
    return new Response(JSON.stringify({ p: answer }), { status: 200 });
  }) as typeof fetch;
}

test('proxy gate: low p skips the model and reports none', async () => {
  const seen: string[] = [];
  const r = await handle(post({ text: 'הפגישה נדחתה למחר' }), GATED, provider(CONCERN, seen), gateFetch(0.01));
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'none');
  assert.equal(b['gate'], 0.01);
  assert.equal(seen.length, 0);
});

test('proxy gate: high p escalates to the model', async () => {
  const seen: string[] = [];
  const r = await handle(post({ text: IRONY }), GATED, provider(CONCERN, seen), gateFetch(0.9));
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'warn');
  assert.equal(b['gate'], 0.9);
  assert.equal(seen.length, 1);
});

test('proxy gate: failure or timeout escalates to the model (never hides a message)', async () => {
  for (const answer of [new Error('down'), 'slow' as const]) {
    const seen: string[] = [];
    const env: Env = { ...GATED, LHG_GATE_TIMEOUT_MS: '20' };
    const r = await handle(post({ text: IRONY }), env, provider(CONCERN, seen), gateFetch(answer));
    const b = (await r.json()) as Record<string, unknown>;
    assert.equal(b['alert'], 'warn');
    assert.equal(b['gate'], null);
    assert.equal(seen.length, 1);
  }
});

test('proxy gate: disabled when LHG_GATE_URL is unset', async () => {
  const calls: string[] = [];
  await handle(post({ text: IRONY }), ENV, provider(CONCERN), gateFetch(0.01, calls));
  assert.equal(calls.length, 0);
});

test('proxy /warm needs the key and pings the gate', async () => {
  assert.equal((await handle(post({}, 'bad', '/warm'), GATED, provider(CONCERN))).status, 401);
  const calls: string[] = [];
  const r = await handle(post({}, ENV.LHG_ACCESS_KEY, '/warm'), GATED, provider(CONCERN), gateFetch(0.5, calls));
  assert.deepEqual(await r.json(), { warm: true, by: 'modal' });
  assert.equal(calls.length, 1);
});

// Oracle primary + Modal fallback (docs/16). Each copy has its own URL and key.
const DUAL: Env = {
  ...GATED, LHG_GATE_ORACLE_URL: 'https://oracle.test/lhg-gate/check', LHG_GATE_ORACLE_KEY: 'o',
  LHG_GATE_ORACLE_TIMEOUT_MS: '20', LHG_GATE_TIMEOUT_MS: '20',
};
type GateAnswer = number | Error | 'slow' | 500 | 302;

function dualFetch(oracle: GateAnswer, modal: GateAnswer, calls: string[] = []): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const isOracle = String(url).startsWith('https://oracle.test');
    calls.push(isOracle ? 'oracle' : 'modal');
    assert.equal((init?.headers as Record<string, string>)['x-gate-key'], isOracle ? 'o' : 'g');
    assert.equal(init?.redirect, 'manual');
    const answer = isOracle ? oracle : modal;
    if (answer instanceof Error) throw answer;
    if (answer === 'slow') {
      return new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    }
    if (answer === 500) return new Response('boom', { status: 500 });
    if (answer === 302) return new Response(null, { status: 302, headers: { location: 'https://evil.test' } });
    return new Response(JSON.stringify({ p: answer }), { status: 200 });
  }) as typeof fetch;
}

async function check(env: Env, f: typeof fetch, seen: string[]) {
  const r = await handle(post({ text: IRONY }), env, provider(CONCERN, seen), f);
  return (await r.json()) as Record<string, unknown>;
}

test('proxy gate dual: Oracle answers -> Modal is never asked', async () => {
  for (const [p, alert, modelCalls] of [[0.01, 'none', 0], [0.9, 'warn', 1]] as const) {
    const calls: string[] = []; const seen: string[] = [];
    const b = await check(DUAL, dualFetch(p, 0.5, calls), seen);
    assert.deepEqual(calls, ['oracle']);
    assert.equal(b['alert'], alert);
    assert.equal(b['gate'], p);
    assert.equal(b['gateBy'], 'oracle');
    assert.equal(seen.length, modelCalls);
  }
});

test('proxy gate dual: Oracle failure/timeout/redirect falls back to Modal', async () => {
  for (const bad of [new Error('down'), 'slow' as const, 500 as const, 302 as const]) {
    const calls: string[] = []; const seen: string[] = [];
    const b = await check(DUAL, dualFetch(bad, 0.01, calls), seen);
    assert.deepEqual(calls, ['oracle', 'modal']);
    assert.equal(b['alert'], 'none');
    assert.equal(b['gateBy'], 'modal');
    assert.equal(seen.length, 0);
  }
});

test('proxy gate dual: both copies down -> the model decides (never hidden)', async () => {
  const calls: string[] = []; const seen: string[] = [];
  const b = await check(DUAL, dualFetch('slow', new Error('down'), calls), seen);
  assert.deepEqual(calls, ['oracle', 'modal']);
  assert.equal(b['alert'], 'warn');
  assert.equal(b['gate'], null);
  assert.equal(b['gateBy'], null);
  assert.equal(seen.length, 1);
});

test('proxy gate dual: Oracle-only config works without Modal', async () => {
  const env: Env = { ...ENV, LHG_GATE_ORACLE_URL: DUAL.LHG_GATE_ORACLE_URL, LHG_GATE_ORACLE_KEY: 'o' };
  const calls: string[] = []; const seen: string[] = [];
  const b = await check(env, dualFetch(0.01, 0.01, calls), seen);
  assert.deepEqual(calls, ['oracle']);
  assert.equal(b['gateBy'], 'oracle');
  const down = await check({ ...env, LHG_GATE_ORACLE_TIMEOUT_MS: '20' }, dualFetch('slow', 0.01, calls), seen);
  assert.equal(down['alert'], 'warn');
  assert.equal(seen.length, 1);
});

test('proxy /warm dual: healthy Oracle keeps Modal asleep; Oracle down wakes Modal', async () => {
  let calls: string[] = [];
  let r = await handle(post({}, ENV.LHG_ACCESS_KEY, '/warm'), DUAL, provider(CONCERN), dualFetch(0.5, 0.5, calls));
  assert.deepEqual(await r.json(), { warm: true, by: 'oracle' });
  assert.deepEqual(calls, ['oracle']);
  calls = [];
  r = await handle(post({}, ENV.LHG_ACCESS_KEY, '/warm'), DUAL, provider(CONCERN), dualFetch(500, 0.5, calls));
  assert.deepEqual(await r.json(), { warm: true, by: 'modal' });
  assert.deepEqual(calls, ['oracle', 'modal']);
});

test('proxy: no context -> identical shape (no req.context), same alert mapping', async () => {
  const seenReqs: ExtractorRequest[] = [];
  const r = await handle(post({ text: IRONY, platform: 'whatsapp-web' }), ENV, capturingProvider(CONCERN, seenReqs));
  assert.equal(r.status, 200);
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'warn');
  assert.equal(b['mechanism'], 'irony');
  assert.equal(seenReqs.length, 1);
  assert.equal(seenReqs[0]!.context, undefined);
  assert.equal(seenReqs[0]!.platform, 'whatsapp-web');
  assert.equal(seenReqs[0]!.direction, 'outgoing');
});

test('proxy: valid context object is forwarded to runExtraction', async () => {
  const seenReqs: ExtractorRequest[] = [];
  const ctx = { version: 1, platform: 'whatsapp-web', direction: 'outgoing',
    conversationRef: 'c1', currentAuthorRef: 'self', conversationKind: 'group', participantCount: 5,
    participants: [], recentMessages: [], facts: [], relationships: [], contextVersion: '1' };
  const r = await handle(post({ text: IRONY, context: ctx }), ENV, capturingProvider(CONCERN, seenReqs));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as Record<string, unknown>)['alert'], 'warn');
  assert.deepEqual(seenReqs[0]!.context, ctx);
});

test('proxy: non-object context is ignored, never breaks a valid check', async () => {
  for (const bad of ['oops', 42, true, ['array'], null, { version: 1 }, { version: 2 }]) {
    const seenReqs: ExtractorRequest[] = [];
    const r = await handle(post({ text: IRONY, context: bad }), ENV, capturingProvider(CONCERN, seenReqs));
    assert.equal(r.status, 200, `context=${JSON.stringify(bad)}`);
    assert.equal(((await r.json()) as Record<string, unknown>)['alert'], 'warn');
    assert.equal(seenReqs[0]!.context, undefined);
  }
});

test('proxy: oversized context is ignored (cap documented in handler)', async () => {
  const big = { version: 1, filler: 'x'.repeat(MAX_CONTEXT_JSON_CHARS + 100) };
  assert.ok(JSON.stringify(big)!.length > MAX_CONTEXT_JSON_CHARS);
  const seenReqs: ExtractorRequest[] = [];
  const r = await handle(post({ text: IRONY, context: big }), ENV, capturingProvider(CONCERN, seenReqs));
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as Record<string, unknown>)['alert'], 'warn');
  assert.equal(seenReqs[0]!.context, undefined);
});
