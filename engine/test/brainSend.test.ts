import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_CATALOG,
  BrainSendExtractorProvider,
  brainSendOptionsFromEnv,
  runExtraction,
  validateExtraction,
  type ExtractorRequest,
  type MessageEnvelope,
} from '../src/index.js';

function msg(text: string): MessageEnvelope {
  return {
    id: 'b1', revision: 1, direction: 'outgoing', authorRef: 'user',
    platform: 'whatsapp-web', conversationId: 'c1',
    audienceSnapshot: { participantCount: 5 }, text,
  };
}

function req(text = 'הוא טיפש'): ExtractorRequest {
  return {
    messageId: 'b1', platform: 'whatsapp-web', direction: 'outgoing',
    text, normalizedText: text, gateCues: ['cue:third_person'],
    catalogFactIds: FACT_CATALOG.map((c) => c.id),
  };
}

type RouteHandler = (url: string, init: RequestInit) => Response;

/** Minimal fetch mock routing on URL path. */
function mockFetch(routes: Record<string, RouteHandler>): typeof fetch {
  return (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    for (const [path, handler] of Object.entries(routes)) {
      if (u.endsWith(path)) return handler(u, init ?? {});
    }
    throw new Error(`unexpected_url:${u}`);
  }) as typeof fetch;
}

function jsonRes(body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': contentType } });
}

const VALID_MODEL_JSON = {
  proposedFacts: [
    {
      id: 'message.criticizes_lesson_content',
      value: true,
      confidence: 0.8,
      evidenceExcerpt: 'מבזבז',
      provenance: 'model_extraction',
    },
  ],
  directAssessment: 'concern',
};

function sseRes(fullText: string): Response {
  const body = `data: {"delta": ${JSON.stringify(fullText.slice(0, 20))}}\n\ndata: {"delta": ${JSON.stringify(fullText.slice(20))}}\n\ndata: {"type": "done"}\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function successRoutes(modelJson: unknown = VALID_MODEL_JSON): Record<string, RouteHandler> {
  const text = JSON.stringify(modelJson);
  return {
    '/api/chat/chats/new': () => jsonRes({ chat_id: 'abc123def456' }),
    '/api/chat/model': () => jsonRes({ ok: true }),
    '/api/chat/send': () => sseRes(text),
  };
}

test('brainSend: env builder returns null without base/token, parses full env otherwise', () => {
  assert.equal(brainSendOptionsFromEnv({}), null);
  assert.equal(brainSendOptionsFromEnv({ LHG_BRAIN_BASE_URL: 'http://x' }), null);
  const opts = brainSendOptionsFromEnv({
    LHG_BRAIN_BASE_URL: 'http://brain:1/',
    LHG_BRAIN_TOKEN: 't',
    LHG_BRAIN_MODEL: 'm',
    LHG_BRAIN_ACCOUNT: 'yoni',
    LHG_BRAIN_TIMEOUT_MS: '5000',
  });
  assert.ok(opts);
  assert.equal(opts?.baseUrl, 'http://brain:1'); // trailing slash trimmed
  assert.equal(opts?.model, 'm');
  assert.equal(opts?.account, 'yoni');
  assert.equal(opts?.timeoutMs, 5000);
});

test('brainSend: success path returns raw JSON that passes validateExtraction', async () => {
  const calls: string[] = [];
  const routes = successRoutes();
  const wrapped: Record<string, RouteHandler> = {};
  for (const [k, h] of Object.entries(routes)) {
    wrapped[k] = (u, init) => { calls.push(u); return h(u, init); };
  }
  wrapped['/api/chat/chats/abc123def456'] = (u, init) => { calls.push(u); return jsonRes({ ok: true }); };
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok',
    fetchImpl: mockFetch(wrapped),
  });
  const raw = await p.extract(req('השיעור מבזבז זמן'));
  const v = validateExtraction(raw, FACT_CATALOG, 'השיעור מבזבז זמן');
  assert.equal(v.proposedFacts.length, 1);
  assert.equal(v.directAssessment, 'concern');
  assert.ok(calls.some((u) => u.endsWith('/api/chat/chats/abc123def456'))); // cleanup DELETE issued
});

test('brainSend: model pins agent_kind muse on the dedicated chat', async () => {
  let modelBody: unknown = null;
  const routes = successRoutes();
  routes['/api/chat/model'] = (_u, init) => {
    modelBody = JSON.parse(String(init.body));
    return jsonRes({ ok: true });
  };
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', model: 'muse-spark-1.2-contributor',
    account: 'yoni', fetchImpl: mockFetch(routes),
  });
  await p.extract(req());
  const body = modelBody as Record<string, unknown>;
  assert.equal(body['agent_kind'], 'muse');
  assert.equal(body['model'], 'muse-spark-1.2-contributor');
  assert.equal(body['account'], 'yoni');
  assert.equal(body['chat_id'], 'abc123def456');
});

test('brainSend: non-JSON model output throws (pipeline would map to not_checked)', async () => {
  const routes = successRoutes();
  routes['/api/chat/send'] = () => sseRes('זו סתם תשובה בעברית בלי JSON');
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', fetchImpl: mockFetch(routes),
  });
  await assert.rejects(() => p.extract(req()), /model_output_not_json/);
});

test('brainSend: HTTP failure on send throws (never resolves to clean)', async () => {
  const routes = successRoutes();
  routes['/api/chat/send'] = () => new Response('boom', { status: 500 });
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', fetchImpl: mockFetch(routes),
  });
  await assert.rejects(() => p.extract(req()), /send_http_500/);
});

test('brainSend: network failure throws BrainSendError', async () => {
  const failing = (async () => { throw new Error('socket hang up'); }) as typeof fetch;
  const p = new BrainSendExtractorProvider({ baseUrl: 'http://brain:1', token: 'tok', fetchImpl: failing });
  await assert.rejects(() => p.extract(req()), /brain_request_failed/);
});

test('brainSend: runExtraction maps a throwing provider to not_checked end-to-end', async () => {
  const failing = (async () => { throw new Error('down'); }) as typeof fetch;
  const p = new BrainSendExtractorProvider({ baseUrl: 'http://brain:1', token: 'tok', fetchImpl: failing });
  const out = await runExtraction(msg('הוא טיפש'), { provider: p, catalog: FACT_CATALOG });
  assert.equal(out.status, 'not_checked');
  assert.ok(out.limitationsHe.some((s) => s.includes('לא נבדק')));
});

test('brainSend: constructor rejects missing base/token', () => {
  assert.throws(() => new BrainSendExtractorProvider({ baseUrl: '', token: 't' }), /missing_base_url/);
  assert.throws(() => new BrainSendExtractorProvider({ baseUrl: 'http://x', token: '' }), /missing_token/);
});
