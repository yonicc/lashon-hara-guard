import type { FactCatalogEntry, MessageEnvelope } from '../types.js';
import { buildMeaningFacts } from '../meaning.js';
import { normalizeHebrewText } from './normalize.js';
import { localGate } from './localGate.js';
import { validateExtraction } from './validate.js';
import type { ExtractorProvider, ExtractionOutcome, ExtractorContextPacket } from './types.js';

export * from './types.js';
export * from './normalize.js';
export * from './localGate.js';
export * from './validate.js';
export * from './providers.js';
export * from './brainSend.js';
export * from './pipeline.js';

export interface RunExtractionOptions {
  provider: ExtractorProvider;
  catalog: FactCatalogEntry[];
  /** When false (default), provider is called only if the local gate triages in. */
  alwaysCallProvider?: boolean;
  /**
   * Optional ContextPacket v1. Passed through to provider.extract() as
   * req.context (untrusted data; prompt renderer allowlists its fields).
   * Absent = single-message behavior, unchanged.
   */
  context?: ExtractorContextPacket;
  /** Optional user note (see ExtractorRequest.userNote). Absent = unchanged. */
  userNote?: string;
  /** Analysis language; only 'en' changes the prompt (default Hebrew). */
  lang?: 'he' | 'en';
}

/**
 * Pipeline: normalize -> local gate -> provider -> schema validation -> meaning facts.
 * The extractor only proposes facts; the deterministic engine in ../evaluate decides routing.
 * Failures always return not_checked — never a silent "clean".
 */
export async function runExtraction(
  message: MessageEnvelope,
  opts: RunExtractionOptions,
): Promise<ExtractionOutcome> {
  const normalizedText = normalizeHebrewText(message.text);
  const gate = localGate(message.text);
  const errors: string[] = [];
  const limitationsHe: string[] = [];

  if (!opts.alwaysCallProvider && !gate.shouldExtract) {
    limitationsHe.push('הסינון המקומי לא מצא סימנים המחייבים חילוץ; זה אינו קובע שאין חשש.');
    return { status: 'skipped_local_gate', providerCalled: false, normalizedText, gate, errors, limitationsHe };
  }

  let raw: unknown;
  try {
    raw = await opts.provider.extract({
      messageId: message.id,
      platform: message.platform,
      direction: message.direction,
      text: message.text,
      normalizedText,
      gateCues: gate.cues,
      catalogFactIds: opts.catalog.map((c) => c.id),
      ...(opts.context ? { context: opts.context } : {}),
      ...(opts.userNote ? { userNote: opts.userNote } : {}),
      ...(opts.lang === 'en' ? { lang: 'en' as const } : {}),
    });
  } catch (e) {
    return {
      status: 'not_checked', providerCalled: true, normalizedText, gate,
      errors: [`provider_error:${e instanceof Error ? e.message : String(e)}`],
      limitationsHe: ['החילוץ נכשל; המצב הוא לא נבדק, לא נקי.'],
    };
  }

  const participantRefs = (opts.context?.participants ?? [])
    .map((p) => (p && typeof p.ref === 'string' ? p.ref : ''))
    .filter((r) => r);
  const extraction = validateExtraction(raw, opts.catalog, message.text, { participantRefs });
  if (extraction.warnings.length) limitationsHe.push(...extraction.warnings);

  const meaningFacts = extraction.meaning ? buildMeaningFacts(extraction.meaning) : undefined;
  if (meaningFacts) limitationsHe.push(...meaningFacts.reasonsHe);

  return {
    status: 'extracted', providerCalled: true, normalizedText, gate,
    extraction, ...(meaningFacts ? { meaningFacts } : {}), errors, limitationsHe,
  };
}
