import type { FactCatalogEntry, FactValue, MessageEnvelope } from '../types.js';
import type { MeaningAssessmentInput } from '../meaning.js';

export type Mechanism = NonNullable<MeaningAssessmentInput['mechanism']>;

export interface ProposedFact {
  id: string;
  value: FactValue;
  confidence: number; // 0..1, never a verdict threshold by itself
  evidenceExcerpt: string; // must be a verbatim span of the message text
  provenance: 'model_extraction';
}

export interface RawExtraction {
  proposedFacts?: ProposedFact[];
  meaning?: MeaningAssessmentInput;
  directAssessment?: 'concern' | 'no_concern' | 'unsure' | null;
}

export interface ValidatedExtraction {
  proposedFacts: ProposedFact[];
  meaning?: MeaningAssessmentInput;
  directAssessment: 'concern' | 'no_concern' | 'unsure' | null;
  droppedFacts: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export interface ExtractorRequest {
  messageId: string;
  platform: string;
  direction: MessageEnvelope['direction'];
  text: string;
  normalizedText: string;
  gateCues: string[];
  catalogFactIds: string[];
}

/** Provider-agnostic LLM contract. Implementations return raw (untrusted) JSON-like data. */
export interface ExtractorProvider {
  id: string;
  modelVersion: string;
  extract(req: ExtractorRequest): Promise<unknown>;
}

export interface ExtractionOutcome {
  status: 'extracted' | 'skipped_local_gate' | 'not_checked';
  providerCalled: boolean;
  normalizedText: string;
  gate: import('./localGate.js').LocalGateResult;
  extraction?: ValidatedExtraction;
  meaningFacts?: ReturnType<typeof import('../meaning.js').buildMeaningFacts>;
  errors: string[];
  limitationsHe: string[];
}

export type { FactCatalogEntry };
