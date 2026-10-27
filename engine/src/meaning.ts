import type { FactRecord, FactValue, ProvenanceKind } from './types.js';
import { FACT_BY_ID } from './lessonScenario.js';
import { EXTRACTION_CONFIDENCE_MIN, isBoundedConfidence } from './extractor/factPolicy.js';

export const MEANING_FACT_IDS = [
  'message.may_be_understood_as_disparagement',
  'message.interpretation_uncertain',
  'subject.identifiable',
] as const;

export type MeaningRisk =
  | 'none_detected'
  | 'implicit_disparagement_possible'
  | 'interpretation_uncertain'
  | 'unknown';

export interface MeaningAssessmentInput {
  /** Perceived negative meaning, even without an explicit insult in the wording. */
  mayBeUnderstoodAsDisparagement?: boolean;
  /** True when wording, irony, praise, omission or context leave reasonable readings. */
  interpretationUncertain?: boolean;
  /** How negative interpretation could happen; never reduces the cue by itself. */
  mechanism?: 'irony' | 'praise' | 'hint' | 'mockery' | 'omission' | 'direct' | 'other';
  /** Exact synthetic/message span supporting the semantic assessment. */
  evidenceExcerpt?: string;
  /** Identifiability, including by hint or shared conversation context. */
  identifiable?: boolean | 'unknown';
  extractorConfidence?: number;
}

export interface MeaningAssessmentFacts {
  facts: Array<Omit<FactRecord, 'updatedAt'>>;
  riskSignals: MeaningRisk[];
  /** The extractor must provide evidence before an implicit warning can advance. */
  routeEligible: boolean;
  reasonsHe: string[];
}

function confidenceNote(confidence?: number): string | undefined {
  if (confidence === undefined) return 'extractor confidence not provided; cue stays unconfirmed';
  if (isBoundedConfidence(confidence) && confidence >= EXTRACTION_CONFIDENCE_MIN) return undefined;
  return 'extractor confidence below the local routing threshold; cue stays unconfirmed';
}

function baseFact(
  id: string,
  value: FactValue,
  provenance: ProvenanceKind,
  note?: string,
): Omit<FactRecord, 'updatedAt'> {
  const entry = FACT_BY_ID.get(id);
  return {
    id,
    value,
    status: 'known',
    provenance,
    scope: entry?.persistent ? 'relationship' : 'message',
    ...(note ? { note } : {}),
  };
}

/**
 * Convert a structured semantic interpretation into ordinary engine facts.
 *
 * This is deliberately conservative and evidence-bound:
 * - Only message.may_be_understood_as_disparagement carries a perceived-meaning cue;
 *   neither wording absence ("no explicit insult") nor stated intent cancels it.
 * - Irony, praise, hint, mockery, omission, direct wording and other mechanisms are
 *   annotations on the same cue, never permission or a halachic/legal verdict.
 * - No risk is inferred from keywords alone here: a caller without structured evidence
 *   gets interpretation_uncertain, not a clean result.
 * - High-confidence evidence is required before the deterministic router may act;
 *   lower/unprovided confidence remains stored as an unconfirmed cue for review.
 */
export function buildMeaningFacts(
  input: MeaningAssessmentInput,
  provenance: ProvenanceKind = 'model_extraction',
): MeaningAssessmentFacts {
  const reasonsHe: string[] = [];
  const evidenceMissing = !input.evidenceExcerpt?.trim();
  const lowConfidence = confidenceNote(input.extractorConfidence);

  if (evidenceMissing) reasonsHe.push('לא סופק קטע ראיה; לא הופק סימן משמעות פעיל.');
  if (lowConfidence) reasonsHe.push('רמת הביטחון של המחלץ נמוכה מהסף; הסימן נשמר כבלתי מאומת.');

  const facts: Array<Omit<FactRecord, 'updatedAt'>> = [];
  let meaningKnown = false;
  let activeRisk = false;

  if (input.mayBeUnderstoodAsDisparagement === true && !evidenceMissing && !lowConfidence) {
    meaningKnown = true;
    activeRisk = true;
    facts.push(
      baseFact(
        'message.may_be_understood_as_disparagement',
        true,
        provenance,
        `mechanism=${input.mechanism ?? 'unspecified'}; evidence=${input.evidenceExcerpt!.trim()}`,
      ),
    );
  }

  if (meaningKnown) {
    facts.push(baseFact('message.interpretation_uncertain', false, provenance));
    reasonsHe.push('סופק סימן משמעות שלילית אפשרית עם ראיה; נדרש ניתוב לבדיקה או בירור.');
  } else {
    const explicitlyNoRisk =
      input.mayBeUnderstoodAsDisparagement === false &&
      input.interpretationUncertain === false &&
      !evidenceMissing &&
      !lowConfidence;
    if (explicitlyNoRisk) {
      facts.push(baseFact('message.may_be_understood_as_disparagement', false, provenance));
      facts.push(baseFact('message.interpretation_uncertain', false, provenance));
      reasonsHe.push('המחלץ קבע במפורש שאין סימן למשמעות מעליבה ואין אי־ודאות פרשנית.');
    } else {
      facts.push(baseFact('message.interpretation_uncertain', true, provenance));
      if (input.mayBeUnderstoodAsDisparagement === undefined) {
        reasonsHe.push('לא סופקה הערכת משמעות; אי־הוודאות הפרשנית נשארת פתוחה.');
      }
      if (input.mayBeUnderstoodAsDisparagement === true) {
        reasonsHe.push('סימן המשמעות לא הופעל בלי ראיה וביטחון מספיקים.');
      }
      if (input.interpretationUncertain === true) {
        reasonsHe.push('המחלץ סימן אי־ודאות באופן שבו נמענים עלולים להבין את הדברים.');
      }
    }
  }

  if (input.identifiable !== undefined) {
    if (input.identifiable === 'unknown') {
      const uncertain = facts.find((f) => f.id === 'message.interpretation_uncertain');
      facts.push(baseFact('message.interpretation_uncertain', true, provenance));
      if (uncertain) uncertain.value = true;
    } else {
      facts.push(baseFact('subject.identifiable', input.identifiable, provenance));
    }
  }

  const uncertain = facts.some(
    (f) => f.id === 'message.interpretation_uncertain' && f.value === true,
  );
  const riskSignals: MeaningRisk[] = [];
  if (activeRisk) riskSignals.push('implicit_disparagement_possible');
  if (uncertain) riskSignals.push('interpretation_uncertain');
  if (!riskSignals.length) riskSignals.push('none_detected');

  return { facts, riskSignals, routeEligible: activeRisk || uncertain, reasonsHe };
}

