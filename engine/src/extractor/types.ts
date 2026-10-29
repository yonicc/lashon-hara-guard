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
  analysis?: unknown;
}

/**
 * Who / about whom / to whom / what / why — an EXPLANATION for the user,
 * never a ruling and never an input to the alert level (alertFor ignores it).
 * Refs come only from the request's ContextPacket participants (or 'self');
 * a mention is a verbatim span of the message. Names never leave the browser:
 * the extension maps refs back to display names locally.
 */
export interface ExtractionAnalysis {
  speakerRef?: string;
  subjectRef?: string;
  subjectMention?: string;
  subjectDescriptionHe?: string;
  audience?: 'private' | 'group' | 'public' | 'unknown';
  claimHe?: string;
  whyHe?: string;
  questionsHe?: string[];
}

export interface ValidatedExtraction {
  needs?: import('../needs.js').Needs;
  proposedFacts: ProposedFact[];
  meaning?: MeaningAssessmentInput;
  directAssessment: 'concern' | 'no_concern' | 'unsure' | null;
  analysis?: ExtractionAnalysis;
  droppedFacts: Array<{ id: string; reason: string }>;
  warnings: string[];
}

export interface ExtractorRequest {
  round?: number;
  messageId: string;
  platform: string;
  direction: MessageEnvelope['direction'];
  text: string;
  normalizedText: string;
  gateCues: string[];
  catalogFactIds: string[];
  /**
   * Optional ContextPacket v1 from the extension (backward compatible:
   * absent = today's single-message behavior). Untrusted data — the prompt
   * renderer (brainSend.ts) copies only allowlisted fields, never raw keys.
   */
  context?: ExtractorContextPacket;
  /**
   * Optional free-text note the extension user wrote about this message
   * (<= MAX_USER_NOTE_CHARS). Untrusted, quoted data for the explanation:
   * never an instruction, never evidence for a proposed fact (evidence must
   * stay a verbatim span of `text`) and never a confirmed fact.
   */
  userNote?: string;
  /** Language of the user-facing analysis texts. Absent = Hebrew (unchanged). */
  lang?: 'he' | 'en';
}

/** Canonical packet fields; partial input remains compatible with older callers.
 * The proxy sanitizes the untrusted wire object before extraction.
 */
export type {
  ContextParticipant as ContextPacketParticipant,
  ContextRecentMessage as ContextPacketRecentMessage,
  ContextFact as ContextPacketFact,
  ContextRelationship as ContextPacketRelationship,
} from '../contextPacket.js';
export type ExtractorContextPacket = Partial<import('../contextPacket.js').ContextPacket> & { version: 1 };

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
