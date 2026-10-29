import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { handle, providerFromEnv, type Env } from '../src/handler.js';
import { CLOUD_MODELS, DEFAULT_CLOUD_MODEL_ID, pickCloudModel } from '../src/cloudModels.js';
import { DEFAULT_BRAIN_MODEL } from '../../engine/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV: Env = {
  LHG_BRAIN_BASE_URL: 'http://brain:1', LHG_BRAIN_TOKEN: 'brain-tok', LHG_ACCESS_KEY: 'k'.repeat(32),
  LHG_BRAIN_ACCOUNT: 'env-acct',
};
const NO_CONCERN = { proposedFacts: [], directAssessment: 'no_concern' };

function post(body: unknown): Request {
  return new Request('https://proxy.test/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lhg-key': ENV.LHG_ACCESS_KEY },
    body: JSON.stringify(body),
  });
}

/** Runs one /check through the REAL provider; returns the Brain request body and the response. */
async function run(body: Record<string, unknown>, env: Env = ENV) {
  const sent: Record<string, unknown>[] = [];
  const brain = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ reply: JSON.stringify(NO_CONCERN) }), { status: 200 });
  }) as typeof fetch;
  const r = await handle(post({ text: 'שלום לכולם', ...body }), env, (e, c) => providerFromEnv(e, c, brain));
  assert.equal(r.status, 200);
  return { brain: sent, res: (await r.json()) as Record<string, unknown> };
}

test('cloudModels: ten unique ids, default first, stateless backends only', () => {
  assert.equal(CLOUD_MODELS.length, 12);
  assert.equal(new Set(CLOUD_MODELS.map((m) => m.id)).size, 12);
  assert.equal(CLOUD_MODELS[0]!.id, DEFAULT_CLOUD_MODEL_ID);
  // Owner 2026-10-29: Baseten Spark is the default.
  assert.deepEqual([CLOUD_MODELS[0]!.agentKind, CLOUD_MODELS[0]!.model], ['baseten', 'meta-models/muse-spark-open-1026']);
  for (const m of CLOUD_MODELS) assert.ok(['meta_api', 'openrouter', 'modal', 'baseten'].includes(m.agentKind), m.id);
  // Baseten: one model only (owner rule 2026-10-28).
  assert.deepEqual(CLOUD_MODELS.filter((m) => m.agentKind === 'baseten').map((m) => m.model),
    ['meta-models/muse-spark-open-1026']);
});

test('cloudModels: the extension picker lists exactly the server allow-list', () => {
  const ctx = vm.createContext({});
  (ctx as Record<string, unknown>)['globalThis'] = ctx;
  vm.runInContext(fs.readFileSync(path.join(HERE, '../../extension/check-mode.js'), 'utf8'), ctx);
  const M = (ctx as Record<string, any>)['LHG_CHECK_MODE'];
  // JSON round-trip: the vm realm has its own Array prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(M.CLOUD_MODELS.map((m: { id: string }) => m.id))),
    CLOUD_MODELS.map((m) => m.id));
  assert.equal(M.DEFAULT_CLOUD_MODEL, DEFAULT_CLOUD_MODEL_ID);
});

test('cloudModels: only exact allow-listed ids are picked; everything else means default', () => {
  for (const raw of [undefined, null, 1, {}, [], '', DEFAULT_CLOUD_MODEL_ID, 'unknown', 'GPT-5.4-MINI', ' gpt-5.4-mini',
    '__proto__', 'constructor', 'toString', 'openai/gpt-5.4-mini']) {
    assert.equal(pickCloudModel(raw).id, DEFAULT_CLOUD_MODEL_ID, String(raw));
  }
  assert.equal(pickCloudModel('gpt-5.4-mini')?.model, 'openai/gpt-5.4-mini');
});

test('/check without model: Baseten Spark (the default), no model echoed', async () => {
  const { brain, res } = await run({});
  assert.equal(brain.length, 1);
  assert.equal(brain[0]!['agent_kind'], 'baseten');
  assert.equal(brain[0]!['model'], 'meta-models/muse-spark-open-1026');
  assert.equal(brain[0]!['account'], 'yoni');
  assert.equal(brain[0]!['reasoning_effort'], 'minimal');
  assert.equal('model' in res, false);
  assert.equal(res['alert'], 'unsure'); // unanswered catalog facts keep the check unresolved
});

test('/check with muse-spark-1.3 (the former default) uses the Worker meta_api account', async () => {
  const { brain, res } = await run({ model: 'muse-spark-1.3' });
  assert.deepEqual([brain[0]!['agent_kind'], brain[0]!['model'], brain[0]!['account']],
    ['meta_api', DEFAULT_BRAIN_MODEL, 'env-acct']);
  assert.equal(res['model'], DEFAULT_BRAIN_MODEL);
});

test('/check with an allow-listed model routes backend, model and account from the server list', async () => {
  const son = await run({ model: 'claude-sonnet-5.5' });
  assert.deepEqual([son.brain[0]!['agent_kind'], son.brain[0]!['model']],
    ['openrouter', 'anthropic/claude-sonnet-5.5']);
  assert.equal(son.res['model'], 'anthropic/claude-sonnet-5.5');

  const gem = await run({ model: 'gemini-3.7-flash' });
  assert.equal(gem.brain[0]!['agent_kind'], 'openrouter');
  assert.equal(gem.brain[0]!['model'], 'google/gemini-3.7-flash');
  assert.equal('account' in gem.brain[0]!, false);

  const muse = await run({ model: 'muse-spark-1.2' });

  // Modal's Kimi: own backend, no account, reasoning effort 'low' (Brain rejects 'minimal' there).
  const kimi = await run({ model: 'kimi-k3-modal' });
  assert.deepEqual([kimi.brain[0]!['agent_kind'], kimi.brain[0]!['model'], kimi.brain[0]!['reasoning_effort']],
    ['modal', 'moonshotai/Kimi-K3', 'low']);
  assert.equal('account' in kimi.brain[0]!, false);
  const open = await run({ model: 'muse-spark-open-1026' });
  assert.deepEqual([open.brain[0]!['agent_kind'], open.brain[0]!['model'], open.brain[0]!['account']],
    ['baseten', 'meta-models/muse-spark-open-1026', 'yoni']);
  assert.equal(son.brain[0]!['reasoning_effort'], 'minimal');
  assert.deepEqual([muse.brain[0]!['agent_kind'], muse.brain[0]!['account']], ['meta_api', 'env-acct']);
  // Token, base URL and system prompt stay the Worker's.
  assert.equal(typeof muse.brain[0]!['system_prompt'], 'string');
});

test('/check with an unknown or default model falls back to Baseten and says which model ran', async () => {
  for (const model of ['evil/model', 42, DEFAULT_CLOUD_MODEL_ID]) {
    const { brain, res } = await run({ model });
    assert.equal(brain[0]!['agent_kind'], 'baseten');
    assert.equal(brain[0]!['model'], 'meta-models/muse-spark-open-1026');
    assert.equal(res['model'], 'meta-models/muse-spark-open-1026');
  }
});

test('/check with a model whose call fails is not_checked, never none', async () => {
  const failing = (async () => new Response('bad', { status: 400 })) as typeof fetch;
  const r = await handle(post({ text: 'שלום', model: 'gpt-5.4-nano' }), ENV, (e, c) => providerFromEnv(e, c, failing));
  const b = (await r.json()) as Record<string, unknown>;
  assert.equal(b['alert'], 'not_checked');
});
