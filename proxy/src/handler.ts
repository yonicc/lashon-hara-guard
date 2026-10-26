import { personalCheck } from './accountAccess.js';
import {
  BrainSendExtractorProvider,
  brainSendOptionsFromEnv,
  FACT_CATALOG,
  runExtraction,
  sanitizeContextPacket,
  type ExtractionAnalysis,
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
  LHG_ACCOUNT_BASE?: string;
  LHG_ACCOUNT_KEY?: string;
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
  /** Optional fast classifier, Modal copy (classifier/serve_modal.py). Fallback when Oracle is set. */
  LHG_GATE_URL?: string;
  LHG_GATE_KEY?: string;
  /** Primary gate on the Oracle host (classifier/oracle, docs/16). Unset = Modal only. */
  LHG_GATE_ORACLE_URL?: string;
  LHG_GATE_ORACLE_KEY?: string;
  /** Oracle budget before falling back to Modal. Default 800. */
  LHG_GATE_ORACLE_TIMEOUT_MS?: string;
  /** p(concern) below this skips the model call. Default 0.2. */
  LHG_GATE_THRESHOLD?: string;
  /** Modal gate budget; on timeout the message goes to the model. Default 1500. */
  LHG_GATE_TIMEOUT_MS?: string;
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export async function handle(
  request: Request, env: Env,
  makeProvider: (env: Env) => ExtractorProvider | null = providerFromEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return personalCheck(request, env, (req, settings) => handleAuthorized(req, settings, makeProvider, fetchImpl), fetchImpl);
}

export { MAX_TEXT_CHARS } from './limits.js';
import { MAX_TEXT_CHARS } from './limits.js';

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
  /** Gate probability when the gate answered, else null. */
  gate: number | null;
  /** Which gate answered ('oracle' | 'modal'), null when none did. */
  gateBy: GateName | null;
  /** Who/about whom/why — explanation only; never changes `alert`. Refs, not names. */
  analysis?: ExtractionAnalysis;
  /** How many earlier conversation messages the check considered (0 = single message). */
  contextMessages?: number;
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
  return sanitizeContextPacket(raw) ?? undefined;
}

export function providerFromEnv(env: Env): ExtractorProvider | null {
  const opts = brainSendOptionsFromEnv(env as unknown as NodeJS.ProcessEnv);
  return opts ? new BrainSendExtractorProvider(opts) : null;
}

export type GateName = 'oracle' | 'modal';
interface GateEndpoint { name: GateName; url: string; key: string; timeoutMs: number }

/** The gate copies in the order they are asked: Oracle (primary) first, then Modal. */
export function gateEndpoints(env: Env): GateEndpoint[] {
  const out: GateEndpoint[] = [];
  if (env.LHG_GATE_ORACLE_URL && env.LHG_GATE_ORACLE_KEY) {
    out.push({ name: 'oracle', url: env.LHG_GATE_ORACLE_URL, key: env.LHG_GATE_ORACLE_KEY,
      timeoutMs: Number(env.LHG_GATE_ORACLE_TIMEOUT_MS) || 800 });
  }
  if (env.LHG_GATE_URL && env.LHG_GATE_KEY) {
    out.push({ name: 'modal', url: env.LHG_GATE_URL, key: env.LHG_GATE_KEY,
      timeoutMs: Number(env.LHG_GATE_TIMEOUT_MS) || 1500 });
  }
  return out;
}

/** One gate copy: p in [0,1], or null on any failure, timeout, redirect or bad body. */
async function askGate(
  ep: GateEndpoint, text: string, fetchImpl: typeof fetch, timeoutMs: number,
): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gate-key': ep.key },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
      redirect: 'manual', // never follow a redirect with the gate key (Workers lack 'error')
    });
    if (!r.ok) return null; // 3xx included
    const p = ((await r.json()) as { p?: unknown }).p;
    return typeof p === 'number' && p >= 0 && p <= 1 ? p : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the fast classifier for p(concern): Oracle first, Modal when Oracle fails
 * or exceeds its budget. Returns null when no copy answered, so the caller
 * escalates to the model: the gate can only save a model call, never hide a message.
 * `timeoutMs` overrides every copy's budget (used by /warm).
 */
export async function gateScore(
  env: Env, text: string, fetchImpl: typeof fetch = fetch, timeoutMs?: number,
  only?: (ep: GateEndpoint) => boolean,
): Promise<{ p: number; by: GateName } | null> {
  for (const ep of gateEndpoints(env)) {
    if (only && !only(ep)) continue;
    const p = await askGate(ep, text, fetchImpl, timeoutMs ?? ep.timeoutMs);
    if (p !== null) return { p, by: ep.name };
  }
  return null;
}

async function handleAuthorized(
  request: Request,
  env: Env,
  makeProvider: (env: Env) => ExtractorProvider | null = providerFromEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/health') return json({ ok: true });
  if (url.pathname !== '/check' && url.pathname !== '/warm') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = request.headers.get('x-lhg-key') ?? '';
  if (!sameKey(key, env.LHG_ACCESS_KEY ?? '')) return json({ error: 'unauthorized' }, 401);

  if (url.pathname === '/warm') {
    // Oracle is always up; only when it does not answer, wake the Modal copy
    // (cold start ~12s) so the fallback is warm. A healthy Oracle keeps Modal asleep.
    const oracle = gateEndpoints(env).some((ep) => ep.name === 'oracle')
      ? await gateScore(env, 'warm', fetchImpl, undefined, (ep) => ep.name === 'oracle') : null;
    const g = oracle ?? await gateScore(env, 'warm', fetchImpl, 30000, (ep) => ep.name === 'modal');
    return json({ warm: g !== null, by: g?.by ?? null });
  }

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

  const started = Date.now();
  const g = await gateScore(env, text, fetchImpl);
  const gate = g?.p ?? null;
  const gateBy = g?.by ?? null;
  const threshold = Number(env.LHG_GATE_THRESHOLD) || 0.2;
  if (gate !== null && gate < threshold) {
    const res: CheckResponse = {
      alert: 'none', status: 'skipped_local_gate', mechanism: null, evidence: null,
      limitationsHe: ['המסווג המהיר לא מצא סימנים; זה אינו קובע שאין חשש.'],
      ms: Date.now() - started, gate, gateBy,
    };
    return json(res);
  }

  const message: MessageEnvelope = {
    id: 'ext-' + Date.now().toString(36), revision: 1, direction, authorRef: 'user',
    platform, conversationId: 'ext', audienceSnapshot: {}, text,
  } as MessageEnvelope;

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
    gate,
    gateBy,
    ...(outcome.extraction?.analysis ? { analysis: outcome.extraction.analysis } : {}),
    contextMessages: Array.isArray(context?.recentMessages) ? context.recentMessages.length : 0,
  };
  return json(res);
}
