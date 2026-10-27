import type { FactCatalogEntry, FactValue } from '../types.js';

/** Local admission threshold, not a probability of a halachic/legal conclusion. */
export const EXTRACTION_CONFIDENCE_MIN = 0.6;

/** Reject malformed scores; clipping would promote invalid provider output to trusted facts. */
export function isBoundedConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function matchesFactType(entry: FactCatalogEntry, value: unknown): value is FactValue {
  const type = entry.valueType ?? 'boolean';
  return typeof value === type && (type !== 'number' || Number.isFinite(value));
}

/** Shared by provider validation and the live-store boundary (including direct callers). */
export function proposalRejection(entry: FactCatalogEntry, value: unknown, confidence: unknown): string | undefined {
  if (entry.confirmedByUserOnly) return 'confirmed_by_user_only';
  if (!matchesFactType(entry, value)) return 'value_type_invalid';
  if (!isBoundedConfidence(confidence))
    return 'confidence_missing_or_invalid';
  if (confidence < EXTRACTION_CONFIDENCE_MIN) return 'confidence_below_threshold';
  return undefined;
}
