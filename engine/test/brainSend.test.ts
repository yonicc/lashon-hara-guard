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

interface Call { url: string; init: RequestInit; body: Record<string, unknown> }

/** fetch mock: records every call and answers with `respond`. */
function mockFetch(respond: () => Response, calls: Call[] = []): typeof fetch {
  return (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const i = init ?? {};
    calls.push({ url: String(url), init: i, body: JSON.parse(String(i.body ?? '{}')) });
    return respond();
  }) as typeof fetch;
}

function replyRes(reply: string, status = 200): Response {
  return new Response(JSON.stringify({ reply, session_id: '', usage: {}, model: 'm' }), {
    status, headers: { 'content-type': 'application/json' },
  });
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

test('brainSend: env builder returns null without base/token, parses full env otherwise', () => {
  assert.equal(brainSendOptionsFromEnv({}), null);
  assert.equal(brainSendOptionsFromEnv({ LHG_BRAIN_BASE_URL: 'http://x' }), null);
  const opts = brainSendOptionsFromEnv({
    LHG_BRAIN_BASE_URL: 'http://brain:1/',
    LHG_BRAIN_TOKEN: 't',
    LHG_BRAIN_MODEL: 'm',
    LHG_BRAIN_ACCOUNT: 'yoni',
    LHG_BRAIN_TIMEOUT_MS: '5000',
    LHG_BRAIN_REASONING_EFFORT: 'minimal',
  });
  assert.ok(opts);
  assert.equal(opts?.baseUrl, 'http://brain:1'); // trailing slash trimmed
  assert.equal(opts?.model, 'm');
  assert.equal(opts?.account, 'yoni');
  assert.equal(opts?.timeoutMs, 5000);
  assert.equal(opts?.reasoningEffort, 'minimal');
  const defaults = brainSendOptionsFromEnv({ LHG_BRAIN_BASE_URL: 'http://x', LHG_BRAIN_TOKEN: 't' });
  assert.equal(defaults?.model, 'muse-spark-1.3');
  assert.equal(defaults?.reasoningEffort, 'minimal');
});

test('brainSend: one stateless v1 call, raw JSON passes validateExtraction', async () => {
  const calls: Call[] = [];
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok',
    fetchImpl: mockFetch(() => replyRes(JSON.stringify(VALID_MODEL_JSON)), calls),
  });
  const raw = await p.extract(req('השיעור מבזבז זמן'));
  const v = validateExtraction(raw, FACT_CATALOG, 'השיעור מבזבז זמן');
  assert.equal(v.proposedFacts.length, 1);
  assert.equal(v.directAssessment, 'concern');
  assert.equal(calls.length, 1); // no chat created, nothing to clean up
  assert.equal(calls[0]!.url, 'http://brain:1/api/v1/chat/completions');
  assert.equal(calls[0]!.init.method, 'POST');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['authorization'], 'Bearer tok');
});

test('brainSend: request pins meta_api, model, account, stream=false', async () => {
  const calls: Call[] = [];
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', model: 'muse-spark-1.3-contributor',
    account: 'yoni', reasoningEffort: 'low',
    fetchImpl: mockFetch(() => replyRes(JSON.stringify(VALID_MODEL_JSON)), calls),
  });
  await p.extract(req('הוא טיפש'));
  const body = calls[0]!.body;
  assert.equal(body['agent_kind'], 'meta_api');
  assert.equal(body['model'], 'muse-spark-1.3-contributor');
  assert.equal(body['account'], 'yoni');
  assert.equal(body['stream'], false);
  assert.equal(body['reasoning_effort'], 'low');
  assert.match(String(body['system_prompt']), /JSON ONLY/);
  const messages = body['messages'] as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.role, 'user');
  assert.ok(messages[0]!.content.includes('הוא טיפש'));
});

test('brainSend: fenced JSON reply is accepted', async () => {
  const fenced = '```json\n' + JSON.stringify(VALID_MODEL_JSON) + '\n```';
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', fetchImpl: mockFetch(() => replyRes(fenced)),
  });
  const raw = (await p.extract(req())) as Record<string, unknown>;
  assert.equal(raw['directAssessment'], 'concern');
});

test('brainSend: non-JSON model output throws (pipeline would map to not_checked)', async () => {
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok',
    fetchImpl: mockFetch(() => replyRes('זו סתם תשובה בעברית בלי JSON')),
  });
  await assert.rejects(() => p.extract(req()), /model_output_not_json/);
});

test('brainSend: empty reply throws', async () => {
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', fetchImpl: mockFetch(() => replyRes('  ')),
  });
  await assert.rejects(() => p.extract(req()), /completions_empty_reply/);
});

test('brainSend: HTTP failure throws (never resolves to clean)', async () => {
  const calls: Call[] = [];
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok',
    fetchImpl: mockFetch(() => new Response('boom', { status: 502 }), calls),
  });
  await assert.rejects(() => p.extract(req()), /completions_http_502/);
  assert.equal(calls.length, 1); // an HTTP error is never retried
});

test('brainSend: a fast network failure (stale socket) is retried exactly once', async () => {
  let n = 0;
  const flaky = (async () => {
    n++;
    if (n === 1) throw new TypeError('fetch failed');
    return replyRes(JSON.stringify(VALID_MODEL_JSON));
  }) as typeof fetch;
  const p = new BrainSendExtractorProvider({ baseUrl: 'http://brain:1', token: 'tok', fetchImpl: flaky });
  const raw = (await p.extract(req())) as Record<string, unknown>;
  assert.equal(raw['directAssessment'], 'concern');
  assert.equal(n, 2);
});

test('brainSend: default request carries reasoning_effort=minimal', async () => {
  const calls: Call[] = [];
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok',
    fetchImpl: mockFetch(() => replyRes(JSON.stringify(VALID_MODEL_JSON)), calls),
  });
  await p.extract(req());
  assert.equal(calls[0]!.body['model'], 'muse-spark-1.3');
  assert.equal(calls[0]!.body['reasoning_effort'], 'minimal');
});

test('brainSend: network failure throws BrainSendError', async () => {
  let n = 0;
  const failing = (async () => { n++; throw new Error('socket hang up'); }) as typeof fetch;
  const p = new BrainSendExtractorProvider({ baseUrl: 'http://brain:1', token: 'tok', fetchImpl: failing });
  await assert.rejects(() => p.extract(req()), /brain_request_failed/);
  assert.equal(n, 2); // one retry, then the failure stands (-> not_checked)
});

test('brainSend: timeout aborts and throws brain_request_timeout', async () => {
  const hanging = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    })) as typeof fetch;
  const p = new BrainSendExtractorProvider({
    baseUrl: 'http://brain:1', token: 'tok', timeoutMs: 20, fetchImpl: hanging,
  });
  await assert.rejects(() => p.extract(req()), /brain_request_timeout/);
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
