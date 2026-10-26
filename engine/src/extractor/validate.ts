import type { FactCatalogEntry } from '../types.js';
import type { RawExtraction, ValidatedExtraction, ProposedFact } from './types.js';
import { normalizeHebrewText } from './normalize.js';

const MECHANISMS = new Set(['irony', 'praise', 'hint', 'mockery', 'omission', 'direct', 'other']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function clampConfidence(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

/**
 * Validate untrusted provider output against the engine catalog.
 * Rules:
 * - Only catalog fact ids survive.
 * - confirmedByUserOnly facts are never accepted from extraction.
 * - evidenceExcerpt must be a verbatim (post-normalization) span of the message.
 * - Confidence must be a finite 0..1 number; missing/invalid confidence drops the fact.
 * Nothing here decides a halachic/legal outcome.
 */
export function validateExtraction(
  raw: unknown,
  catalog: FactCatalogEntry[],
  messageText: string,
): ValidatedExtraction {
  const warnings: string[] = [];
  const droppedFacts: ValidatedExtraction['droppedFacts'] = [];
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const normalizedMessage = normalizeHebrewText(messageText);

  if (!isRecord(raw)) {
    return { proposedFacts: [], directAssessment: null, droppedFacts, warnings: ['provider_output_not_object'] };
  }

  const proposedFacts: ProposedFact[] = [];
  const rawFacts = Array.isArray(raw.proposedFacts) ? raw.proposedFacts : [];
  for (const item of rawFacts) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const entry = catalogById.get(item.id);
    if (!entry) { droppedFacts.push({ id: item.id, reason: 'fact_not_in_catalog' }); continue; }
    if (entry.confirmedByUserOnly) { droppedFacts.push({ id: item.id, reason: 'confirmed_by_user_only' }); continue; }
    const confidence = clampConfidence(item.confidence);
    if (confidence === null) { droppedFacts.push({ id: item.id, reason: 'confidence_missing_or_invalid' }); continue; }
    if (typeof item.evidenceExcerpt !== 'string' || !item.evidenceExcerpt.trim()) {
      droppedFacts.push({ id: item.id, reason: 'evidence_missing' }); continue;
    }
    if (!normalizedMessage.includes(normalizeHebrewText(item.evidenceExcerpt))) {
      droppedFacts.push({ id: item.id, reason: 'evidence_not_in_message' }); continue;
    }
    if (typeof item.value !== 'string' && typeof item.value !== 'number' && typeof item.value !== 'boolean') {
      droppedFacts.push({ id: item.id, reason: 'value_type_invalid' }); continue;
    }
    proposedFacts.push({
      id: item.id,
      value: item.value,
      confidence,
      evidenceExcerpt: item.evidenceExcerpt.trim(),
      provenance: 'model_extraction',
    });
  }

  let meaning: ValidatedExtraction['meaning'];
  if (isRecord(raw.meaning)) {
    const m = raw.meaning;
    const mechanism = typeof m.mechanism === 'string' && MECHANISMS.has(m.mechanism)
      ? (m.mechanism as NonNullable<ValidatedExtraction['meaning']>['mechanism'])
      : undefined;
    const conf = clampConfidence(m.extractorConfidence ?? m.confidence);
    meaning = {
      ...(typeof m.mayBeUnderstoodAsDisparagement === 'boolean' ? { mayBeUnderstoodAsDisparagement: m.mayBeUnderstoodAsDisparagement } : {}),
      ...(typeof m.interpretationUncertain === 'boolean' ? { interpretationUncertain: m.interpretationUncertain } : {}),
      ...(mechanism ? { mechanism } : {}),
      ...(typeof m.evidenceExcerpt === 'string' && m.evidenceExcerpt.trim() &&
        normalizedMessage.includes(normalizeHebrewText(m.evidenceExcerpt))
        ? { evidenceExcerpt: m.evidenceExcerpt.trim() } : {}),
      ...(m.identifiable === true || m.identifiable === false || m.identifiable === 'unknown' ? { identifiable: m.identifiable } : {}),
      ...(conf !== null ? { extractorConfidence: conf } : {}),
    };
    if (m.evidenceExcerpt && !meaning.evidenceExcerpt) warnings.push('meaning_evidence_not_in_message_dropped');
    if (m.mechanism && !mechanism) warnings.push('meaning_mechanism_unknown_dropped');
  }

  const directAssessment =
    raw.directAssessment === 'concern' || raw.directAssessment === 'no_concern' || raw.directAssessment === 'unsure'
      ? raw.directAssessment
      : null;
  if (raw.directAssessment !== undefined && raw.directAssessment !== null && !directAssessment) {
    warnings.push('direct_assessment_invalid_dropped');
  }

  return { proposedFacts, ...(meaning ? { meaning } : {}), directAssessment, droppedFacts, warnings };
}
