import type { ExtractorProvider, ExtractorRequest } from './types.js';

/**
 * Brain-backed extractor provider.
 *
 * Talks to the user's Brain (brain-mcp) over its machine API with ONE
 * stateless request per extraction:
 *
 *   POST {base}/api/v1/chat/completions
 *     { agent_kind: 'meta_api', model, account?, stream: false,
 *       system_prompt, messages: [{role:'user', content}], reasoning_effort? }
 *   -> { reply, model, usage }
 *
 * brain-mcp routes agent_kind=meta_api to Meta's HTTP API
 * (api.meta.ai/v1/chat/completions) with the named Muse account's key — no
 * chat is created, no history is kept, no agent tools run. (Added in
 * brain-mcp 491364e; before that v1 had no Meta branch and an earlier version
 * of this provider opened and deleted a whole chat per call.)
 *
 * The model is asked for a single JSON object matching RawExtraction
 * (proposedFacts / meaning / directAssessment). The raw value is returned
 * untrusted; runExtraction() in index.ts feeds it through validateExtraction,
 * so malformed content becomes a validation outcome, and any transport
 * failure throws => pipeline maps it to not_checked (never "clean").
 *
 * Secrets: endpoint + token come ONLY from environment variables.
 * No secret is ever stored in code or git.
 */
export interface BrainSendExtractorOptions {
  baseUrl: string;
  token: string;
  model?: string;
  account?: string;
  timeoutMs?: number;
  /** Meta reasoning_effort: minimal | low | medium | high. Empty = DEFAULT_BRAIN_REASONING_EFFORT. */
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
}

export const BRAIN_SEND_ENV = {
  baseUrl: 'LHG_BRAIN_BASE_URL',
  token: 'LHG_BRAIN_TOKEN',
  model: 'LHG_BRAIN_MODEL',
  account: 'LHG_BRAIN_ACCOUNT',
  timeoutMs: 'LHG_BRAIN_TIMEOUT_MS',
  reasoningEffort: 'LHG_BRAIN_REASONING_EFFORT',
} as const;

export const BRAIN_AGENT_KIND = 'meta_api';
export const BRAIN_COMPLETIONS_PATH = '/api/v1/chat/completions';
// Measured live 2026-10-26 (docs/10 §0): muse-spark-1.3 + minimal reasoning
// answered in ~2.2s median / 2.7s max with 9/10 correct; 1.3-contributor at
// default reasoning took ~13.5s median. Both stay overridable via env.
export const DEFAULT_BRAIN_MODEL = 'muse-spark-1.3';
export const DEFAULT_BRAIN_REASONING_EFFORT = 'minimal';
export const DEFAULT_BRAIN_TIMEOUT_MS = 30000;
/** A network failure faster than this is a dead pooled connection, not an overload: retry once. */
const FAST_NETWORK_FAILURE_MS = 1000;

/** Build options from environment. Returns null when required env is missing. */
export function brainSendOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): BrainSendExtractorOptions | null {
  const baseUrl = (env[BRAIN_SEND_ENV.baseUrl] ?? '').trim();
  const token = (env[BRAIN_SEND_ENV.token] ?? '').trim();
  if (!baseUrl || !token) return null;
  const model = (env[BRAIN_SEND_ENV.model] ?? '').trim() || DEFAULT_BRAIN_MODEL;
  const account = (env[BRAIN_SEND_ENV.account] ?? '').trim();
  const reasoningEffort = (env[BRAIN_SEND_ENV.reasoningEffort] ?? '').trim() || DEFAULT_BRAIN_REASONING_EFFORT;
  const timeoutRaw = Number(env[BRAIN_SEND_ENV.timeoutMs]);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : DEFAULT_BRAIN_TIMEOUT_MS;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    model,
    ...(account ? { account } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    timeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

export const EXTRACTION_SYSTEM_INSTRUCTION = [
  'You are a Hebrew text-analysis helper for a drafting-stage research tool.',
  'You NEVER issue verdicts, rulings, or halachic/legal conclusions.',
  'You only propose facts and a meaning assessment as a single JSON object.',
  'Respond with JSON ONLY, no prose, no markdown fences.',
  'Shape: {"proposedFacts":[{"id":string,"value":string|number|boolean,"confidence":0..1,',
  '"evidenceExcerpt":string (verbatim span of the message),"provenance":"model_extraction"}],',
  '"meaning":{"mayBeUnderstoodAsDisparagement":boolean,"mechanism":one of irony|praise|hint|mockery|omission|direct|other,',
  '"evidenceExcerpt":string,"identifiable":boolean,"extractorConfidence":0..1},',
  '"directAssessment":"concern"|"no_concern"|"unsure"}',
  'Use only fact ids from the provided catalog list. Omit anything uncertain.',
].join(' ');

/** The user turn: catalog, cues and the message. The rules go in system_prompt. */
export function buildUserContent(req: ExtractorRequest): string {
  const catalog = req.catalogFactIds.map((id) => `- ${id}`).join('\n');
  return [
    `Fact catalog ids:\n${catalog}`,
    '',
    `Local gate cues: ${req.gateCues.join(', ') || '(none)'}`,
    '',
    `Message text:\n${req.text}`,
  ].join('\n');
}

class BrainSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainSendError';
  }
}

/** Strip accidental markdown fences; return the JSON candidate substring. */
function extractJsonCandidate(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new BrainSendError('model_output_not_json');
  return t.slice(start, end + 1);
}

export class BrainSendExtractorProvider implements ExtractorProvider {
  id = 'brain-meta-api-extractor';
  modelVersion: string;
  private readonly opts: Required<Omit<BrainSendExtractorOptions, 'fetchImpl' | 'account' | 'reasoningEffort'>> &
    Pick<BrainSendExtractorOptions, 'fetchImpl' | 'account' | 'reasoningEffort'>;

  constructor(opts: BrainSendExtractorOptions) {
    if (!opts.baseUrl?.trim()) throw new BrainSendError('missing_base_url');
    if (!opts.token?.trim()) throw new BrainSendError('missing_token');
    this.opts = {
      baseUrl: opts.baseUrl.replace(/\/+$/, ''),
      token: opts.token,
      model: opts.model?.trim() || DEFAULT_BRAIN_MODEL,
      timeoutMs: opts.timeoutMs && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : DEFAULT_BRAIN_TIMEOUT_MS,
      ...(opts.account?.trim() ? { account: opts.account.trim() } : {}),
      reasoningEffort: opts.reasoningEffort?.trim() || DEFAULT_BRAIN_REASONING_EFFORT,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    };
    this.modelVersion = this.opts.model;
  }

  async extract(req: ExtractorRequest): Promise<unknown> {
    const started = Date.now();
    try {
      return await this.extractOnce(req, this.opts.timeoutMs);
    } catch (e) {
      // Retry ONLY a fast transport failure (stale keep-alive socket closed by
      // the proxy: seen live as "fetch failed" after ~75ms). Timeouts, HTTP
      // errors and bad model output are deterministic or slow: never retried.
      const elapsed = Date.now() - started;
      const transient =
        e instanceof BrainSendError && e.message.startsWith('brain_request_failed:') &&
        elapsed < FAST_NETWORK_FAILURE_MS;
      if (!transient) throw e;
      return await this.extractOnce(req, this.opts.timeoutMs - elapsed);
    }
  }

  private async extractOnce(req: ExtractorRequest, timeoutMs: number): Promise<unknown> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body = {
      agent_kind: BRAIN_AGENT_KIND,
      model: this.opts.model,
      ...(this.opts.account ? { account: this.opts.account } : {}),
      ...(this.opts.reasoningEffort ? { reasoning_effort: this.opts.reasoningEffort } : {}),
      stream: false,
      system_prompt: EXTRACTION_SYSTEM_INSTRUCTION,
      messages: [{ role: 'user', content: buildUserContent(req) }],
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    let data: unknown;
    try {
      res = await fetchImpl(`${this.opts.baseUrl}${BRAIN_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.token}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new BrainSendError(`completions_http_${res.status}`);
      try {
        data = await res.json();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        throw new BrainSendError('completions_bad_json');
      }
    } catch (e) {
      if (e instanceof BrainSendError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw new BrainSendError('brain_request_timeout');
      throw new BrainSendError(`brain_request_failed:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    const reply =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['reply'] : undefined;
    if (typeof reply !== 'string' || !reply.trim()) throw new BrainSendError('completions_empty_reply');
    try {
      return JSON.parse(extractJsonCandidate(reply)) as unknown;
    } catch (e) {
      if (e instanceof SyntaxError) throw new BrainSendError('model_output_not_json');
      throw e;
    }
  }
}
