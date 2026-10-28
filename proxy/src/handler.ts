import { personalCheck } from './accountAccess.js';
import { throttle } from './throttle.js';
import { pickCloudModel, type CloudModel } from './cloudModels.js';
import {
  DRAFT_RULES_LIMITATION_HE, notCheckedRules, pickConfirmedFacts, rulesModeFromEnv, runLiveRules,
  type RulesResult,
} from './rules.js';
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
  /** Exact deployed repository commit, supplied by the release command. */
  LHG_BUILD_SHA?: string;
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
  /** Chafetz Chaim draft rules in /check: 'live' (default) | 'off' (docs/18, owner 2026-10-27). */
  LHG_CC_RULES?: string;
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  EDGE_LIMITER?: Env['LIMITER'];
}

/** Builds the extraction provider; `choice` = allow-listed cloud model, null = env default. */
export type ProviderFactory = (env: Env, choice?: CloudModel | null) => ExtractorProvider | null;

export async function handle(
  request: Request, env: Env,
  makeProvider: ProviderFactory = providerFromEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && (path === '/check' || path === '/warm')) {
    // Cloudflare overwrites this header: never trust x-forwarded-for.
    const blocked = await throttle(env.EDGE_LIMITER, 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown'));
    if (blocked) return blocked;
  }
  return personalCheck(request, env, (req, settings) => handleAuthorized(req, settings, makeProvider, fetchImpl), fetchImpl);
}

export { MAX_TEXT_CHARS } from './limits.js';
import { MAX_TEXT_CHARS, MAX_USER_NOTE_CHARS } from './limits.js';

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
  /** Live draft Chafetz Chaim rules (absent when LHG_CC_RULES=off or the gate skipped the model). */
  rules?: RulesResult;
  /** Model that ran; present only when the request carried a `model` field. */
  model?: string;
}

/**
 * The one home of "should the extension show something".
 * Never a ruling: 'warn' means "may be understood as disparaging", and a
 * failed or skipped check is never reported as clean.
 * Draft rule findings can only RAISE the level to 'warn'; they never lower it,
 * and a rules failure (`rules.notChecked`) leaves it as it was.
 */
export function alertFor(outcome: ExtractionOutcome, rules?: RulesResult): AlertLevel {
  if (rules && rules.findings.length > 0) return 'warn';
  const alert = extractionAlert(outcome);
  // A pending rabbi referral is unresolved, never a clean check. Preserve
  // stronger concerns and failures from extraction.
  return alert === 'none' && rules?.referrals?.length ? 'unsure' : alert;
}

function extractionAlert(outcome: ExtractionOutcome): AlertLevel {
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

/**
 * Optional free-text note from the extension user (0.9). Non-string or blank
 * => absent; control characters folded to spaces; clipped (never rejected) to
 * MAX_USER_NOTE_CHARS. It only reaches the prompt as quoted data: it is never
 * a confirmedFact and adds no extra model call (one /check, one charge).
 */
export function pickUserNote(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_USER_NOTE_CHARS);
  return t || undefined;
}

/** UI language of the extension: 'en' or 'he'. Absent/unknown = 'he' (pre-0.9 clients). */
export function pickLang(raw: unknown): 'he' | 'en' {
  return raw === 'en' ? 'en' : 'he';
}

/**
 * The env provider (unchanged default), optionally switched to one
 * allow-listed cloud model. Only backend/model/account change; token, base
 * URL, timeout and reasoning effort stay the Worker's.
 */
export function providerFromEnv(
  env: Env, choice?: CloudModel | null, fetchImpl?: typeof fetch,
): ExtractorProvider | null {
  const opts = brainSendOptionsFromEnv(env as unknown as NodeJS.ProcessEnv, fetchImpl);
  if (!opts) return null;
  if (!choice) return new BrainSendExtractorProvider(opts);
  const { account: envAccount, ...rest } = opts;
  const account = choice.agentKind === 'meta_api' ? envAccount : choice.account;
  return new BrainSendExtractorProvider({
    ...rest, agentKind: choice.agentKind, model: choice.model, ...(account ? { account } : {}),
    ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}),
  });
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
  makeProvider: ProviderFactory = providerFromEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/health') return json({ ok: true });
  if (url.pathname !== '/check' && url.pathname !== '/warm') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = request.headers.get('x-lhg-key') ?? '';
  if (!sameKey(key, env.LHG_ACCESS_KEY ?? '')) return json({ error: 'unauthorized' }, 401);

  const blocked = await throttle(env.LIMITER, 'account:' + key);
  if (blocked) return blocked;

  if (url.pathname === '/warm') {
    // Oracle is always up; only when it does not answer, wake the Modal copy
    // (cold start ~12s) so the fallback is warm. A healthy Oracle keeps Modal asleep.
    const oracle = gateEndpoints(env).some((ep) => ep.name === 'oracle')
      ? await gateScore(env, 'warm', fetchImpl, undefined, (ep) => ep.name === 'oracle') : null;
    const g = oracle ?? await gateScore(env, 'warm', fetchImpl, 30000, (ep) => ep.name === 'modal');
    return json({ warm: g !== null, by: g?.by ?? null });
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
  // Optional explicit answers to rule questions; invalid entries are dropped silently.
  const confirmedFacts = pickConfirmedFacts(body['confirmedFacts']);
  const userNote = pickUserNote(body['userNote']);
  const lang = pickLang(body['lang']);
  // Optional cloud model id (allow-list in cloudModels.ts); anything else = env default.
  const modelRequested = 'model' in body;
  const cloudModel = pickCloudModel(body['model']);

  const provider = makeProvider(env, cloudModel);
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
    ...(userNote ? { userNote } : {}),
    ...(lang === 'en' ? { lang } : {}),
  });
  if (outcome.status === 'not_checked') {
    // Diagnostics for `wrangler tail`: error codes, model and timing only —
    // never message text, context or keys (BrainSendError messages are codes).
    console.log('lhg-check not_checked', JSON.stringify({
      errors: (outcome.errors ?? []).map((e) => String(e).slice(0, 160)),
      model: provider.modelVersion, platform, direction,
      contextMessages: Array.isArray(context?.recentMessages) ? context.recentMessages.length : 0,
      ms: Date.now() - started,
    }));
  }
  let rules: RulesResult | undefined;
  if (rulesModeFromEnv(env) === 'live') {
    rules = outcome.status === 'extracted' && outcome.extraction
      ? runLiveRules(message, outcome.extraction, confirmedFacts, provider.modelVersion)
      : notCheckedRules();
  }
  const meaning = outcome.extraction?.meaning;
  const evidence =
    meaning?.evidenceExcerpt || outcome.extraction?.proposedFacts.find((f) => f.evidenceExcerpt)?.evidenceExcerpt || null;
  const res: CheckResponse = {
    alert: alertFor(outcome, rules),
    status: outcome.status,
    mechanism: meaning?.mechanism ?? null,
    evidence,
    limitationsHe: rules && rules.findings.length > 0
      ? [...outcome.limitationsHe, DRAFT_RULES_LIMITATION_HE]
      : outcome.limitationsHe,
    ms: Date.now() - started,
    gate,
    gateBy,
    ...(outcome.extraction?.analysis ? { analysis: {
      ...outcome.extraction.analysis,
      // One display budget; the catalog-backed rule question(s) take priority.
      questionsHe: rules?.questions?.length ? [] : (outcome.extraction.analysis.questionsHe ?? []).slice(0, 1),
    } } : {}),
    contextMessages: Array.isArray(context?.recentMessages) ? context.recentMessages.length : 0,
    ...(rules ? { rules } : {}),
    ...(modelRequested ? { model: provider.modelVersion } : {}),
  };
  return json(res);
}
