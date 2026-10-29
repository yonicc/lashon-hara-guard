import type { ExtractorProvider, ExtractorRequest } from '../../engine/src/extractor/types.js';
import { buildUserContent, EXTRACTION_SYSTEM_INSTRUCTION } from '../../engine/src/extractor/brainSend.js';

export const PUBLIC_MODEL = 'meta-models/muse-spark-open-1026';
export const BASETEN_URL = 'https://inference.baseten.co/v1/chat/completions';

/** Fixed destination and model. No browser-supplied URL, credentials or model. */
export class BasetenExtractorProvider implements ExtractorProvider {
  id = 'baseten-direct-extractor';
  modelVersion = PUBLIC_MODEL;
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async extract(req: ExtractorRequest): Promise<unknown> {
    const response = await this.fetchImpl(BASETEN_URL, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.key },
      body: JSON.stringify({
        model: PUBLIC_MODEL, stream: false, max_tokens: 4096, reasoning_effort: 'minimal',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_INSTRUCTION },
          { role: 'user', content: buildUserContent(req) },
        ],
      }),
    });
    if (!response.ok || response.status >= 300) throw new Error('baseten_http_' + response.status);
    const data = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new Error('baseten_incomplete');
    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('baseten_empty');
    return JSON.parse(content) as unknown;
  }
}
