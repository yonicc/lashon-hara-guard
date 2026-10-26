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
