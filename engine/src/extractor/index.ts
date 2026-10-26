import type { FactCatalogEntry, MessageEnvelope } from '../types.js';
import { buildMeaningFacts } from '../meaning.js';
import { normalizeHebrewText } from './normalize.js';
import { localGate } from './localGate.js';
import { validateExtraction } from './validate.js';
import type { ExtractorProvider, ExtractionOutcome } from './types.js';

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
    });
  } catch (e) {
    return {
      status: 'not_checked', providerCalled: true, normalizedText, gate,
      errors: [`provider_error:${e instanceof Error ? e.message : String(e)}`],
      limitationsHe: ['החילוץ נכשל; המצב הוא לא נבדק, לא נקי.'],
    };
  }

  const extraction = validateExtraction(raw, opts.catalog, message.text);
  if (extraction.warnings.length) limitationsHe.push(...extraction.warnings);

  const meaningFacts = extraction.meaning ? buildMeaningFacts(extraction.meaning) : undefined;
  if (meaningFacts) limitationsHe.push(...meaningFacts.reasonsHe);

  return {
    status: 'extracted', providerCalled: true, normalizedText, gate,
    extraction, ...(meaningFacts ? { meaningFacts } : {}), errors, limitationsHe,
  };
}
