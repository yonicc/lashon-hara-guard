import type { ExtractorProvider, ExtractorRequest } from './types.js';

/**
 * Brain-backed extractor provider (prototype).
 *
 * Talks to the user's Brain (brain-mcp) dashboard over HTTP using the
 * per-chat SEND flow, because /api/v1/chat/completions has no muse branch
 * (verified from brain-mcp source: v1_chat.py routes only openrouter/codex,
 * everything else falls through to the Claude SDK path).
 *
 * Flow per extract() call (dedicated chat => effectively stateless):
 *   1. POST {base}/api/chat/chats/new            -> { chat_id }
 *   2. POST {base}/api/chat/model {agent_kind:'muse', model, account, chat_id}
 *   3. POST {base}/api/chat/send  {message, chat_id} -> SSE stream, collect text
 *   4. DELETE {base}/api/chat/chats/{chat_id}     -> cleanup (best effort)
 *
 * The model is asked for a single JSON object matching RawExtraction
 * (proposedFacts / meaning / directAssessment). The raw value is returned
 * untrusted; runExtraction() in index.ts feeds it through validateExtraction,
 * so malformed JSON or invalid content becomes a validation outcome, and any
 * transport failure throws => pipeline maps it to not_checked (never "clean").
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
  fetchImpl?: typeof fetch;
}

export const BRAIN_SEND_ENV = {
  baseUrl: 'LHG_BRAIN_BASE_URL',
  token: 'LHG_BRAIN_TOKEN',
  model: 'LHG_BRAIN_MODEL',
  account: 'LHG_BRAIN_ACCOUNT',
  timeoutMs: 'LHG_BRAIN_TIMEOUT_MS',
} as const;

export const DEFAULT_BRAIN_MODEL = 'muse-spark-1.2-contributor';
export const DEFAULT_BRAIN_TIMEOUT_MS = 30000;

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
  const timeoutRaw = Number(env[BRAIN_SEND_ENV.timeoutMs]);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : DEFAULT_BRAIN_TIMEOUT_MS;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    model,
    ...(account ? { account } : {}),
    timeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

const EXTRACTION_SYSTEM_INSTRUCTION = [
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

function buildPrompt(req: ExtractorRequest): string {
  const catalog = req.catalogFactIds.map((id) => `- ${id}`).join('\n');
  return [
    EXTRACTION_SYSTEM_INSTRUCTION,
    '',
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

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    throw new BrainSendError(`${what}_bad_json`);
  }
  if (typeof data !== 'object' || data === null) throw new BrainSendError(`${what}_bad_json`);
  return data as Record<string, unknown>;
}

/** Collect an SSE /api/chat/send body into plain text. */
async function collectSendText(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    // Non-streaming short response: { text } / { reply } / { message }.
    const data = await readJson(res, 'send');
    for (const key of ['text', 'reply', 'message', 'content']) {
      if (typeof data[key] === 'string' && (data[key] as string).trim()) {
        return data[key] as string;
      }
    }
    throw new BrainSendError('send_empty_response');
  }
  const body = await res.text();
  const parts: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload) as Record<string, unknown>;
      if (typeof evt['delta'] === 'string') parts.push(evt['delta'] as string);
      else if (typeof evt['text'] === 'string') parts.push(evt['text'] as string);
      else if (
        evt['type'] === 'done' &&
        typeof evt['text'] === 'string' &&
        (evt['text'] as string).trim()
      ) {
        parts.push(evt['text'] as string);
      } else if (evt['type'] === 'error') {
        throw new BrainSendError(`send_stream_error:${String(evt['message'] ?? 'unknown')}`);
      }
    } catch (e) {
      if (e instanceof BrainSendError) throw e;
      // A non-JSON data line: treat as literal text rather than failing.
      parts.push(payload);
    }
  }
  const text = parts.join('').trim();
  if (!text) throw new BrainSendError('send_empty_stream');
  return text;
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
  id = 'brain-send-extractor';
  modelVersion: string;
  private readonly opts: Required<Omit<BrainSendExtractorOptions, 'fetchImpl' | 'account'>> &
    Pick<BrainSendExtractorOptions, 'fetchImpl' | 'account'>;

  constructor(opts: BrainSendExtractorOptions) {
    if (!opts.baseUrl?.trim()) throw new BrainSendError('missing_base_url');
    if (!opts.token?.trim()) throw new BrainSendError('missing_token');
    this.opts = {
      baseUrl: opts.baseUrl.replace(/\/+$/, ''),
      token: opts.token,
      model: opts.model?.trim() || DEFAULT_BRAIN_MODEL,
      timeoutMs: opts.timeoutMs && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : DEFAULT_BRAIN_TIMEOUT_MS,
      ...(opts.account?.trim() ? { account: opts.account.trim() } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    };
    this.modelVersion = this.opts.model;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(`${this.opts.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.token}`,
          ...(init.headers ?? {}),
        },
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new BrainSendError('brain_request_timeout');
      throw new BrainSendError(`brain_request_failed:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async extract(req: ExtractorRequest): Promise<unknown> {
    const timeoutMs = this.opts.timeoutMs;
    let chatId = '';
    try {
      // 1. Dedicated chat.
      const newRes = await this.request('/api/chat/chats/new', { method: 'POST', body: '{}' }, timeoutMs);
      if (!newRes.ok) throw new BrainSendError(`chats_new_http_${newRes.status}`);
      const newBody = await readJson(newRes, 'chats_new');
      if (typeof newBody['chat_id'] !== 'string' || !(newBody['chat_id'] as string)) {
        throw new BrainSendError('chats_new_missing_chat_id');
      }
      chatId = newBody['chat_id'] as string;

      // 2. Pin model + account to this chat.
      const modelRes = await this.request(
        '/api/chat/model',
        {
          method: 'POST',
          body: JSON.stringify({
            agent_kind: 'muse',
            model: this.opts.model,
            ...(this.opts.account ? { account: this.opts.account } : {}),
            chat_id: chatId,
          }),
        },
        timeoutMs,
      );
      if (!modelRes.ok) throw new BrainSendError(`model_http_${modelRes.status}`);

      // 3. Single stateless turn.
      const sendRes = await this.request(
        '/api/chat/send',
        { method: 'POST', body: JSON.stringify({ message: buildPrompt(req), chat_id: chatId }) },
        timeoutMs,
      );
      if (!sendRes.ok) throw new BrainSendError(`send_http_${sendRes.status}`);
      const text = await collectSendText(sendRes);

      // 4. Parse the model's JSON (throws BrainSendError when not JSON).
      return JSON.parse(extractJsonCandidate(text)) as unknown;
    } catch (e) {
      if (e instanceof SyntaxError) throw new BrainSendError('model_output_not_json');
      throw e;
    } finally {
      if (chatId) {
        try {
          await this.request(`/api/chat/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }, 5000);
        } catch {
          // Best-effort cleanup only; the turn result stands on its own.
        }
      }
    }
  }
}
