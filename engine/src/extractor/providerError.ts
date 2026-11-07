/** Public diagnostics are bounded data, never a raw exception or provider response. */
export interface CheckError {
  code: string;
  provider: string;
  message: string;
  status?: number;
}

export function sanitizeProviderMessage(value: string, secrets: string[] = [], limit = 200): string {
  let text = value;
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/(["']?(?:api[-_]?key|authorization|token|password|secret|credentials)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/\b(?:sk[-_]|brk_|lap_|gh[pousr]_)[a-z0-9_-]+/gi, '[redacted]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

export class ProviderRequestError extends Error {
  constructor(readonly detail: CheckError) {
    super(detail.code);
    this.name = 'ProviderRequestError';
  }
}

export function providerFailure(error: unknown, provider: string): CheckError {
  if (error instanceof ProviderRequestError) return error.detail;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const code = /timeout/i.test(name + message) || name === 'AbortError' ? 'timeout'
    : /request_failed|fetch failed|network/i.test(message) ? 'network' : 'provider_error';
  return { code, provider, message: '' };
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  try {
    while (body.length < 16000) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally { void reader.cancel().catch(() => {}); }
  return body.slice(0, 16000);
}

function errorMessage(body: string): string {
  try {
    const data = JSON.parse(body);
    const candidate = data?.error?.message ?? data?.error?.detail ?? data?.message ?? data?.detail ?? data?.error;
    if (typeof candidate === 'string') return candidate;
  } catch { /* plain-text response */ }
  return body;
}

/** Log the provider body with secrets/URLs removed; expose only 200 characters. */
export async function providerHttpError(response: Response, provider: string, secrets: string[] = []): Promise<ProviderRequestError> {
  let body = '';
  try { body = await boundedBody(response); } catch { /* retain HTTP status even if body fails */ }
  const code = provider === 'baseten' ? 'baseten_http_' + response.status : 'completions_http_' + response.status;
  console.warn('lhg-provider-error', JSON.stringify({
    provider, code, status: response.status, body: sanitizeProviderMessage(body, secrets, 4000),
  }));
  return new ProviderRequestError({
    code, provider, status: response.status,
    message: sanitizeProviderMessage(errorMessage(body), secrets),
  });
}
