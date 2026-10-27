// Core contracts for the clarification/rule engine.
// Draft routing rules only: no approved halachic/legal rule exists yet.

export type Tri = true | false | 'unknown';

export type FactValue = string | number | boolean;

export type FactStatus = 'known' | 'unknown' | 'candidate' | 'disputed';

export type ProvenanceKind = 'user' | 'site_metadata' | 'model_extraction' | 'system';

export interface FactRecord {
  id: string;
  value: FactValue;
  status: FactStatus;
  provenance: ProvenanceKind;
  scope: 'message' | 'conversation' | 'event' | 'relationship';
  updatedAt: string;
  note?: string;
}

export type FactMap = Map<string, FactRecord>;

export type Expr =
  | { eq: [string, FactValue] }
  | { neq: [string, FactValue] }
  | { in: [string, FactValue[]] }
  | { exists: string }
  | { missing: string }
  | { gte: [string, number] }
  | { and: Expr[] }
  | { or: Expr[] }
  | { not: Expr };

export type ReviewStatus =
  | 'draft'
  | 'source_verified'
  | 'expert_reviewed'
  | 'approved'
  | 'retired';

export interface SourceRef {
  work: string;
  part?: string;
  principle?: string;
  section?: string;
  edition?: string;
  url?: string;
  verifiedAt?: string;
}

export interface Rule {
  id: string;
  version: string;
  domain: 'routing' | 'halacha_draft' | 'halacha' | 'legal_info';
  titleHe: string;
  reviewStatus: ReviewStatus;
  /** Facts this rule needs before it can conclude anything (drives questions). */
  requiredFacts?: string[];
  /** When the rule is even relevant. Unknown applicability => needs clarification if facts missing. */
  applicability: Expr;
  /** Main conditions. */
  conditions: Expr;
  /** Any true exception blocks the finding (exceptions never grant a blanket permit). */
  exceptions?: Expr[];
  outcome: {
    severity: 'info' | 'low' | 'medium' | 'high';
    code: string;
    messageHe: string;
  };
  source?: SourceRef;
  reviewer?: string;
  reviewedAt?: string;
  fixtures?: string[];
}

export interface RulePack {
  id: string;
  version: string;
  rules: Rule[];
}

export interface FactCatalogEntry {
  id: string;
  questionHe: string;
  /** Lower = asked earlier. */
  priority: number;
  sensitivity: 'low' | 'medium' | 'high';
  persistent: boolean;
  /** Sensitive long-lived facts become known only via explicit user confirmation. */
  confirmedByUserOnly?: boolean;
}

export interface MessageEnvelope {
  id: string;
  revision: number;
  direction: 'outgoing' | 'incoming';
  authorRef: string;
  platform: string;
  conversationId: string;
  audienceSnapshot: {
    participantCount?: number;
    participantRefs?: string[];
    /** Email-style audience; group chats may leave these empty. */
    to?: string[];
    cc?: string[];
    bccCount?: number;
  };
  forwarded?: boolean;
  text: string;
}

export interface EvaluationInput {
  message: MessageEnvelope;
  facts: FactMap;
  rulePack: RulePack;
  catalog: FactCatalogEntry[];
  /** Optional direct assessment from the extractor (never trusted alone). */
  directAssessment?: 'concern' | 'no_concern' | 'unsure' | null;
  maxQuestions?: number; // default 1
  /**
   * Which rules may produce user findings.
   * - 'approved_only' (default): only approved rules; drafts stay internal draftObservations.
   * - 'live_draft': owner's decision 2026-10-27 — 'halacha_draft' rules in 'draft' review
   *   also produce findings, marked `draft: true`. Findings only raise attention or ask;
   *   they never assert "permitted" and never lower an alert.
   */
  ruleMode?: 'approved_only' | 'live_draft';
  contextVersion: string;
  modelVersion: string;
}

export interface Finding {
  ruleId: string;
  ruleVersion: string;
  packVersion: string;
  domain: Rule['domain'];
  reviewStatus: ReviewStatus;
  severity: Rule['outcome']['severity'];
  code: string;
  messageHe: string;
  evidenceFactIds: string[];
  /** True when the finding comes from an unreviewed draft rule (ruleMode 'live_draft'). */
  draft?: true;
  source?: SourceRef;
}

export interface DraftObservation {
  ruleId: string;
  note: 'draft_or_unapproved_rule_matched_internal_only';
}

export interface PlannedQuestion {
  factId: string;
  questionHe: string;
  whyHe: string;
  unlocksRuleIds: string[];
}

export interface EvaluationResult {
  status: 'evaluated' | 'needs_clarification' | 'not_checked';
  findings: Finding[];
  draftObservations: DraftObservation[];
  missingFactIds: string[];
  questions: PlannedQuestion[];
  /** True when extractor direct assessment materially disagrees with engine outcome. */
  disagreement: boolean;
  limitationsHe: string[];
  versions: {
    packId: string;
    packVersion: string;
    modelVersion: string;
    contextVersion: string;
  };
  cacheKey: string;
}
