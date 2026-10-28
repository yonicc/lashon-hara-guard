// Group-D rabbi referral (docs/32 group D; docs/40 §B; owner decision 2026-10-29).
//
// 73 of the 177 Chafetz Chaim sections need something no device check can
// supply: external evidence, an authorized/expert halachic ruling, or they are
// not representable as a message decision at all. These sections NEVER
// auto-rule. The only artifact they may produce is a structured referral — an
// organized question for a qualified rabbi carrying every fact already
// gathered. This module is deterministic: it renders the referral from the
// reviewed source coverage (sourceCoverage.json) and the rule cards; it makes
// no judgment call of its own.
import { REFERRAL_DATA } from './referralData.js';
import type { FactMap } from '../types.js';
import type { RabbiReferral, SourceRef } from '../types.js';

export interface CoverageSection {
  key: string;
  disposition: string;
  blocker: null | { category: string; reasonHe: string; sourceUrl: string };
  ref: string;
  url: string;
  cardId: string;
  implementedScopeHe?: string;
  unimplementedHe?: string;
  chatFeasibility?: string;
  ruleIds?: string[];
}

export interface ReferralCard {
  summaryHe?: string;
  quotesHe?: string[];
  uncertainHe?: string[];
  factsNeeded?: string[];
}

/** Group D per docs/32 §1 decision rule 1: blocked, or chatFeasibility=external_evidence. */
function isGroupD(s: CoverageSection): boolean {
  return s.disposition === 'blocked' || s.chatFeasibility === 'external_evidence';
}

/** All group-D sections are referral-only, including partial coverage. */
export function isBlocked(s: CoverageSection): boolean {
  return s.disposition === 'blocked';
}

/** Load the 73 group-D sections (cached). Injectable for tests. */
export function loadGroupDSections(): CoverageSection[] {
  return REFERRAL_DATA.filter(isGroupD);
}

/** Load card summaries/quotes/doubts by cardId (cached). Injectable for tests. */
export function loadReferralCards(): Map<string, ReferralCard> {
  return new Map(REFERRAL_DATA.map((s) => [s.cardId, s.card]));
}

let sectionCache: CoverageSection[] | null = null;
let cardCache: Map<string, ReferralCard> | null = null;

export function groupDSections(): CoverageSection[] {
  return (sectionCache ??= loadGroupDSections());
}

export function referralCards(): Map<string, ReferralCard> {
  return (cardCache ??= loadReferralCards());
}

/** Test seam: override the cached inputs, pass null to reset. */
export function __setReferralData(sections: CoverageSection[] | null, cards: Map<string, ReferralCard> | null): void {
  sectionCache = sections;
  cardCache = cards;
}

/** Coverage key -> group-D section, for O(1) lookup by rule source. */
export function groupDByKey(): Map<string, CoverageSection> {
  return new Map(groupDSections().map((s) => [s.key, s]));
}

// Conservative referral routing, never a test of halachic applicability.
// Generic identity/fellow facts alone do not establish a topic. Any positive
// topic fact (including explicitly labelled candidate/disputed evidence) keeps
// the question open. False/unknown facts never establish a topic.
const GENERIC_FACTS = new Set(['subject.identifiable', 'subject.is_fellow']);
export function hasReferralTopic(s: CoverageSection, facts: FactMap, ruleFactIds: Iterable<string> = []): boolean {
  return [...new Set([...(referralCards().get(s.cardId)?.factsNeeded ?? []), ...ruleFactIds])].some((id) => {
    const rec = facts.get(id);
    return !GENERIC_FACTS.has(id) && rec && rec.status !== 'unknown' &&
      rec.value !== false && rec.value !== null && rec.value !== '';
  });
}

/** Coverage key of a rule's source ("p1_prin1:2" style), or null when not a CC section. */
export function coverageKeyOfSource(source: SourceRef | undefined): string | null {
  if (!source || source.work !== 'Chafetz Chaim') return null;
  const principle = (source.principle ?? '').replace(/^Principle\s+/i, '');
  const section = (source.section ?? '').split(':')[1];
  if (!principle || !section) return null;
  const part = source.part?.startsWith('Part One') ? 'p1' : source.part?.startsWith('Part Two') ? 'p2' : null;
  return part ? `${part}_prin${principle}:${section}` : null;
}

/** True when the rule's source section is a group-D (never auto-rule) section. */
export function isGroupDSource(source: SourceRef | undefined): boolean {
  const key = coverageKeyOfSource(source);
  return key !== null && groupDByKey().has(key);
}

const CATEGORY_HE: Record<string, string> = {
  expert_ruling: 'הכרעת מומחה הלכתי',
  external_evidence: 'ראיה חיצונית / אימות מציאות',
  not_representable: 'אין לייצג כהחלטה על הודעה',
  external_evidence_partial: 'השלמת הבדיקה דורשת ראיה חיצונית',
};

const HOW_TO_ASK_HE: Record<string, string> = {
  expert_ruling: 'יש להציג את המקרה בפני רב מוסמך ולשאול כיצד נוהגים; אין להסיק מהבדיקה האוטומטית.',
  external_evidence: 'יש לאמת את הראיות והנסיבות מול מקור חיצוני לפני כל מסקנה; הבדיקה אינה מספיקה.',
  not_representable: 'סעיף זה אינו הכרעה על הודעה בודדת; יש להציג את ההקשר לרב.',
  external_evidence_partial: 'חלק מהתנאים אינם ניתנים לבדיקה מהמכשיר; יש להשלים מול ראיה חיצונית או רב.',
};

/** Deterministic, non-ruling phrasing of the open question for one section. */
function openQuestionHe(s: CoverageSection, category: string): string {
  const subject = s.implementedScopeHe
    ? s.implementedScopeHe.replace(/^תזכורות טיוטה בלבד: /, '').replace(/\..*$/, '')
    : s.ref;
  switch (category) {
    case 'expert_ruling':
      return `האם נסיבות המקרה שנאספו נכנסות לכלל ${s.ref}, וכיצד נוהגים בפועל? (נדרשת הכרעת מומחה.)`;
    case 'external_evidence':
      return `האם ניתן לאמת את הראיות והנסיבות הדרושות לסעיף ${s.ref}? (נדרשת ראיה חיצונית.)`;
    case 'not_representable':
      return `כיצד יש לנהוג בנוגע לסעיף ${s.ref} במקרה זה? (אין לייצג כהכרעה על הודעה.)`;
    default:
      return `האם המקרה (${subject}) עומד בתנאי סעיף ${s.ref}? חלק מהתנאים דורשים בירור מחוץ להודעה.`;
  }
}

/**
 * Build the referral artifact for one group-D section. Never returns a verdict.
 */
export function buildReferral(
  s: CoverageSection,
  gatheredFacts: RabbiReferral['gatheredFacts'],
  cards: Map<string, ReferralCard> = referralCards(),
): RabbiReferral {
  const card = cards.get(s.cardId);
  const category = s.blocker?.category ?? 'external_evidence_partial';
  const categoryHe = CATEGORY_HE[category] ?? CATEGORY_HE.external_evidence_partial!;
  const uncertain = [
    ...(card?.uncertainHe ?? []),
    ...(s.unimplementedHe ? [s.unimplementedHe] : []),
    ...(s.blocker?.reasonHe ? [s.blocker.reasonHe] : []),
  ];
  return {
    sectionKey: s.key,
    sourceRef: s.ref,
    sourceUrl: s.url,
    category,
    questionHe: openQuestionHe(s, category),
    howToAskHe: HOW_TO_ASK_HE[category] ?? HOW_TO_ASK_HE.external_evidence_partial!,
    backgroundHe: card?.summaryHe ?? '',
    quotesHe: card?.quotesHe ?? [],
    gatheredFacts,
    uncertainHe: uncertain,
    whyNotCheckedHe: `סעיף זה מסווג כ"${categoryHe}" (קבוצה ד׳) — אינו מוכרע אוטומטית ואינו מפיק פסק; הוא מופנה לרב עם הפרטים.`,
  };
}
