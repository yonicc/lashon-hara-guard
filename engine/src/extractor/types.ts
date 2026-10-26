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
  /**
   * Optional ContextPacket v1 from the extension (backward compatible:
   * absent = today's single-message behavior). Untrusted data — the prompt
   * renderer (brainSend.ts) copies only allowlisted fields, never raw keys.
   */
  context?: ExtractorContextPacket;
}

/**
 * ContextPacket v1 — structural local type.
 *
 * Defined HERE (not imported from a shared context module) because the
 * extension-side context producer does not exist in this branch yet; when it
 * lands, this shape must stay wire-compatible with it. The prompt renderer
 * MUST treat every value as untrusted data and copy only the allowlisted
 * fields (conversationKind, participantCount, participant refs+roles,
 * relationships, facts with status, recentMessages capped, event scalars).
 * Free-form keys that a malicious or buggy client may attach (display names,
 * phone numbers, emails, addresses, tokens, …) are never read and never
 * reach the prompt — allowlist, not blocklist.
 */
export interface ContextPacketParticipant {
  ref: string;
  isSelf?: boolean;
  roles?: string[];
}

export interface ContextPacketRecentMessage {
  authorRef: string;
  direction: string;
  text: string;
  ageMinutes?: number;
}

export interface ContextPacketFact {
  id: string;
  value: FactValue;
  status: string;
  provenance: string;
  scope?: string;
}

export interface ContextPacketRelationship {
  subjectRef: string;
  relation: string;
  objectRef: string;
  status: string;
  provenance: string;
}

export interface ExtractorContextPacket {
  version: 1;
  platform?: string;
  direction?: string;
  conversationRef?: string;
  conversationKind?: string;
  participantCount?: number;
  participants?: ContextPacketParticipant[];
  currentAuthorRef?: string;
  replyToAuthorRef?: string;
  forwarded?: boolean;
  recentMessages?: ContextPacketRecentMessage[];
  facts?: ContextPacketFact[];
  relationships?: ContextPacketRelationship[];
  /** Rendered allowlisted only (see brainSend.ts renderContextEvent). */
  event?: unknown;
  contextVersion?: string;
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
