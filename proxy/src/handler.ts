import {
  BrainSendExtractorProvider,
  brainSendOptionsFromEnv,
  FACT_CATALOG,
  runExtraction,
  type ExtractionOutcome,
  type ExtractorContextPacket,
  type ExtractorProvider,
  type MessageEnvelope,
} from '../../engine/src/index.js';

/**
 * Lashon Hara Guard proxy: the ONLY thing the browser extension talks to.
 *
 * It holds the Brain token as a Worker secret, exposes exactly one action
 * (POST /check), and returns a presentation-ready verdict-free alert level.
 * Prompt, validation and not_checked semantics all live in the engine; this
 * file only adds auth, limits and the alert mapping.
 */
export interface Env {
  LHG_BRAIN_BASE_URL: string;
  LHG_BRAIN_TOKEN: string;
  /** Shared access key the extension sends in `x-lhg-key`. */
  LHG_ACCESS_KEY: string;
  LHG_BRAIN_ACCOUNT?: string;
  LHG_BRAIN_MODEL?: string;
  LHG_BRAIN_REASONING_EFFORT?: string;
  LHG_BRAIN_TIMEOUT_MS?: string;
  /** "1" = call the model even when the cheap local gate finds no cue (MVP default). */
  LHG_ALWAYS_EXTRACT?: string;
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export const MAX_TEXT_CHARS = 2000;

/**
 * Cap on the SERIALIZED `context` field of POST /check (ContextPacket v1).
 *
 * Policy: when the client-supplied context is not a plain object it is
 * IGNORED (single-message path, never a 400 — backward compatible). When it
 * serializes beyond this limit it is IGNORED as well (not truncated in the
 * proxy: silent partial context would look like full context to the model;
 * ignoring is explicit and safe). The renderer in the engine additionally
 * caps messages (5 x 300 chars) and the whole block (4000 chars), so a
 * well-formed packet that passes this gate still cannot blow up the prompt.
 */
export const MAX_CONTEXT_JSON_CHARS = 6000;

export type AlertLevel = 'warn' | 'unsure' | 'none' | 'not_checked';

export interface CheckResponse {
  alert: AlertLevel;
  status: ExtractionOutcome['status'];
  mechanism: string | null;
  evidence: string | null;
  limitationsHe: string[];
  ms: number;
}

/**
 * The one home of "should the extension show something".
 * Never a ruling: 'warn' means "may be understood as disparaging", and a
 * failed or skipped check is never reported as clean.
 */
export function alertFor(outcome: ExtractionOutcome): AlertLevel {
  if (outcome.status === 'not_checked') return 'not_checked';
  if (outcome.status === 'skipped_local_gate') return 'none';
  const ex = outcome.extraction;
  if (!ex) return 'not_checked';
  if (ex.directAssessment === 'concern' || ex.meaning?.mayBeUnderstoodAsDisparagement === true) return 'warn';
  if (ex.directAssessment === 'unsure' || ex.directAssessment === null) return 'unsure';
  return 'none';
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-lhg-key',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function sameKey(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Plain-object guard: arrays, null and primitives are "no context", never an error. */
function pickContext(raw: unknown): ExtractorContextPacket | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  let size: number;
  try {
    size = JSON.stringify(raw)?.length ?? 0;
  } catch {
    return undefined; // unserializable (cyclic/BigInt/…) => ignore, stay a valid check
  }
  if (size > MAX_CONTEXT_JSON_CHARS) return undefined;
  return raw as ExtractorContextPacket;
}

export function providerFromEnv(env: Env): ExtractorProvider | null {
  const opts = brainSendOptionsFromEnv(env as unknown as NodeJS.ProcessEnv);
  return opts ? new BrainSendExtractorProvider(opts) : null;
}

export async function handle(
  request: Request,
  env: Env,
  makeProvider: (env: Env) => ExtractorProvider | null = providerFromEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/health') return json({ ok: true });
  if (url.pathname !== '/check') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = request.headers.get('x-lhg-key') ?? '';
  if (!sameKey(key, env.LHG_ACCESS_KEY ?? '')) return json({ error: 'unauthorized' }, 401);

  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: key.slice(0, 16) });
    if (!success) return json({ error: 'rate_limited' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const text = typeof body['text'] === 'string' ? (body['text'] as string).trim() : '';
  if (!text) return json({ error: 'text_required' }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ error: 'text_too_long', max: MAX_TEXT_CHARS }, 413);
  const direction = body['direction'] === 'incoming' ? 'incoming' : 'outgoing';
  const platform = typeof body['platform'] === 'string' ? (body['platform'] as string).slice(0, 40) : 'unknown';

  // Optional ContextPacket v1: non-object => ignore (backward compatible);
  // over-cap serialized size => ignore (documented above). Either way the
  // request stays a valid single-message check with identical shape.
  const context = pickContext(body['context']);

  const provider = makeProvider(env);
  if (!provider) return json({ error: 'proxy_not_configured' }, 503);

  const message: MessageEnvelope = {
    id: 'ext-' + Date.now().toString(36), revision: 1, direction, authorRef: 'user',
    platform, conversationId: 'ext', audienceSnapshot: {}, text,
  } as MessageEnvelope;

  const started = Date.now();
  const outcome = await runExtraction(message, {
    provider, catalog: FACT_CATALOG, alwaysCallProvider: (env.LHG_ALWAYS_EXTRACT ?? '1') === '1',
    ...(context ? { context } : {}),
  });
  const meaning = outcome.extraction?.meaning;
  const evidence =
    meaning?.evidenceExcerpt || outcome.extraction?.proposedFacts.find((f) => f.evidenceExcerpt)?.evidenceExcerpt || null;
  const res: CheckResponse = {
    alert: alertFor(outcome),
    status: outcome.status,
    mechanism: meaning?.mechanism ?? null,
    evidence,
    limitationsHe: outcome.limitationsHe,
    ms: Date.now() - started,
  };
  return json(res);
}
