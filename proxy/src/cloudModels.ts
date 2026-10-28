/**
 * Server-side allow-list for the optional `model` field of POST /check.
 *
 * The extension's picker (extension/check-mode.js CLOUD_MODELS) shows these
 * ids; this file is the real gate: the request carries only an id, and the
 * backend/model/account it maps to is decided here, never by the client.
 * proxy/test/cloudModels.test.ts fails when the two lists differ.
 *
 * Every entry uses a STATELESS HTTP branch of brain-mcp's
 * /api/v1/chat/completions (meta_api, openrouter): no chat, no
 * agent tools, the system prompt is forwarded. The `claude` and `codex`
 * branches run agent CLIs (tools, dropped system prompt) and are excluded.
 * Picked 2026-10-28 from the owner's live Brain model picker (`/api/chat/models`).
 * Baseten is listed there too, but its key answered 403 ("please check the
 * api-key") on 2026-10-28, so it is not used. Every entry passed a live smoke
 * (synthetic irony -> concern, neutral -> no_concern) under the Worker's 20 s
 * timeout on 2026-10-28; deepseek-v4(.1)-flash, kimi-k3, glm-5.3-flash,
 * gpt-oss-120b, qwen3.8-flash and grok-4.7 timed out, gemini-3.5-flash-lite
 * missed the irony.
 *
 * Contract (docs/18, backward compatible):
 *   - `model` absent, not a string, or not an allow-listed id => the default
 *     provider from the Worker env, exactly as before this field existed.
 *   - The default id also maps to the env provider (LHG_BRAIN_MODEL /
 *     LHG_BRAIN_ACCOUNT), so choosing it changes nothing.
 */
export type CloudAgentKind = 'meta_api' | 'openrouter';

export interface CloudModel {
  /** Stable id the extension sends. */
  id: string;
  agentKind: CloudAgentKind;
  /** Provider model id passed to Brain. */
  model: string;
  /**
   * Brain account label. Omitted for meta_api (the Worker's LHG_BRAIN_ACCOUNT
   * applies, as for the default) and for openrouter (one global key).
   */
  account?: string;
}

export const DEFAULT_CLOUD_MODEL_ID = 'muse-spark-1.3';

export const CLOUD_MODELS: readonly CloudModel[] = Object.freeze([
  { id: 'muse-spark-1.3', agentKind: 'meta_api', model: 'muse-spark-1.3' },
  { id: 'muse-spark-1.3-contributor', agentKind: 'meta_api', model: 'muse-spark-1.3-contributor' },
  { id: 'muse-spark-1.2', agentKind: 'meta_api', model: 'muse-spark-1.2' },
  { id: 'claude-sonnet-5.5', agentKind: 'openrouter', model: 'anthropic/claude-sonnet-5.5' },
  { id: 'claude-haiku-5.5', agentKind: 'openrouter', model: 'anthropic/claude-haiku-5.5' },
  { id: 'gpt-5.4-mini', agentKind: 'openrouter', model: 'openai/gpt-5.4-mini' },
  { id: 'gpt-5.4-nano', agentKind: 'openrouter', model: 'openai/gpt-5.4-nano' },
  { id: 'gemini-3.7-flash', agentKind: 'openrouter', model: 'google/gemini-3.7-flash' },
  { id: 'mistral-medium-3.5', agentKind: 'openrouter', model: 'mistralai/mistral-medium-3-5' },
  // mistral-small-2603 failed fast in a repeat smoke (flaky JSON), replaced.
  { id: 'gemini-3.6-flash', agentKind: 'openrouter', model: 'google/gemini-3.6-flash' },
].map((m) => Object.freeze(m as CloudModel)));

/**
 * The allow-listed choice for a raw request value, or null for "use the env
 * default" (absent, malformed, unknown, or the default id itself).
 * Exact match on own entries only: no prototype keys, no trimming, no case folding.
 */
export function pickCloudModel(raw: unknown): CloudModel | null {
  if (typeof raw !== 'string' || raw === DEFAULT_CLOUD_MODEL_ID) return null;
  return CLOUD_MODELS.find((m) => m.id === raw) ?? null;
}
