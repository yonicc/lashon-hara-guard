import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type {
  DraftObservation,
  EvaluationInput,
  EvaluationResult,
  Finding,
  Expr,
  Rule,
} from './types.js';
import { evalExpr, exprFactIds, isFactKnown } from './evalExpr.js';
import { planQuestions } from './questionPlanner.js';
import { validateRulePack } from './validatePack.js';
import { buildReferral, coverageKeyOfSource, groupDByKey, referralCards, hasReferralTopic } from './chafetzChaim/referral.js';

function cacheKey(input: EvaluationInput): string {
  const audience = JSON.stringify(input.message.audienceSnapshot ?? {});
  const raw = [
    input.message.text,
    input.message.direction,
    audience,
    input.contextVersion,
    input.rulePack.id,
    input.rulePack.version,
    input.modelVersion,
  ].join('\n');
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

/** Only unresolved expression branches can change its three-valued result. */
function unresolvedFacts(expr: Expr, facts: EvaluationInput['facts']): string[] {
  if (evalExpr(expr, facts) !== 'unknown') return [];
  if ('and' in expr) return expr.and.flatMap((child) => unresolvedFacts(child, facts));
  if ('or' in expr) return expr.or.flatMap((child) => unresolvedFacts(child, facts));
  if ('not' in expr) return unresolvedFacts(expr.not, facts);
  return [...exprFactIds(expr)].filter((id) => !isFactKnown(facts, id));
}

function ruleMissingFacts(rule: Rule, facts: EvaluationInput['facts']): string[] {
  const ids = new Set<string>();
  const expressions = [rule.applicability, rule.conditions, ...(rule.exceptions ?? [])];
  const referenced = new Set(expressions.flatMap((expr) => [...exprFactIds(expr)]));
  // Standalone required metadata still matters. Generated requiredFacts lists
  // must not reintroduce a dormant OR/AND branch already resolved by known facts.
  (rule.requiredFacts ?? []).filter((id) => !referenced.has(id)).forEach((id) => ids.add(id));
  expressions.flatMap((expr) => unresolvedFacts(expr, facts)).forEach((id) => ids.add(id));
  return [...ids].filter((id) => !isFactKnown(facts, id));
}

/** The one home of "which rule may surface to the user" for a given ruleMode. */
function mayProduceFinding(rule: Rule, mode: EvaluationInput['ruleMode']): boolean {
  if (rule.reviewStatus === 'approved') return true;
  return mode === 'live_draft' && rule.domain === 'halacha_draft' && rule.reviewStatus === 'draft';
}

/**
 * Deterministic three-valued evaluation.
 * - Only approved rules may produce findings, except in ruleMode 'live_draft'
 *   (owner's decision 2026-10-27), where 'halacha_draft' rules in 'draft' review
 *   produce findings marked `draft: true`.
 * - Other unapproved matching rules produce internal draftObservations only.
 * - Unknown facts never collapse to false; they drive clarification questions.
 * - The result never asserts that a message is permitted.
 */
const FACT_STATUS_HE: Record<string, string> = {
  known: 'ידוע',
  candidate: 'מועמד (לא אושר)',
  disputed: 'שנוי במחלוקת',
  unknown: 'לא ידוע',
};

const PROVENANCE_HE: Record<string, string> = {
  user: 'אושר על ידי המשתמש',
  model_extraction: 'חולץ מהטקסט',
  site_metadata: 'מטא־דאטה של האתר',
  system: 'מערכת',
};

/** Every gathered fact, including explicit unknown answers; never a verdict. */
function gatheredFactsForReferral(
  facts: EvaluationInput['facts'],
  catalog: EvaluationInput['catalog'],
): EvaluationResult['referrals'][number]['gatheredFacts'] {
  const out: EvaluationResult['referrals'][number]['gatheredFacts'] = [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const rec of [...facts.values()]
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const valueHe =
      rec.status === 'unknown' ? 'לא ידוע' :
      rec.value === true ? 'כן' : rec.value === false ? 'לא' : rec.value === '' ? 'לא ידוע' : String(rec.value);
    out.push({
      id: rec.id,
      questionHe: byId.get(rec.id)?.questionHe ?? rec.id,
      valueHe: `${FACT_STATUS_HE[rec.status] ?? rec.status}: ${valueHe}`,
      provenanceHe: PROVENANCE_HE[rec.provenance] ?? rec.provenance,
    });
  }
  return out;
}

export function evaluate(input: EvaluationInput): EvaluationResult {
  const base = {
    findings: [] as Finding[],
    draftObservations: [] as DraftObservation[],
    missingFactIds: [] as string[],
    questions: [] as EvaluationResult['questions'],
    referrals: [] as EvaluationResult['referrals'],
    disagreement: false,
    versions: {
      packId: input.rulePack.id,
      packVersion: input.rulePack.version,
      modelVersion: input.modelVersion,
      contextVersion: input.contextVersion,
    },
    cacheKey: cacheKey(input),
  };

  const packCheck = validateRulePack(input.rulePack);
  if (!packCheck.valid) {
    return {
      ...base,
      status: 'not_checked',
      limitationsHe: [`חבילת הכללים אינה תקינה ולא בוצעה בדיקה: ${packCheck.errors.join('; ')}`],
    };
  }

  const missingByRule = new Map<string, { rule: Rule; missing: string[] }>();
  const limitationsHe: string[] = [];
  const groupD = groupDByKey();
  const referredSectionKeys = new Set<string>();

  /** Emit a referral for a group-D section at most once. */
  const emitReferral = (sectionKey: string): void => {
    if (referredSectionKeys.has(sectionKey)) return;
    const section = groupD.get(sectionKey);
    if (!section) return;
    referredSectionKeys.add(sectionKey);
    base.referrals.push(buildReferral(section, gatheredFactsForReferral(input.facts, input.catalog), referralCards()));
  };

  for (const rule of input.rulePack.rules) {
    if (rule.reviewStatus === 'retired') continue;
    const coverageKey = coverageKeyOfSource(rule.source);
    const groupDSection = coverageKey ? groupD.get(coverageKey) : undefined;
    // All 73 group-D sections are referral-only in every rule mode and review
    // status. This guard precedes findings, observations and question planning.
    if (groupDSection) {
      if (hasReferralTopic(groupDSection, input.facts,
            [...exprFactIds(rule.applicability), ...exprFactIds(rule.conditions)]) &&
          evalExpr(rule.applicability, input.facts) !== false) emitReferral(groupDSection.key);
      continue; // never a finding, never a planned question for this rule
    }
    const applicability = evalExpr(rule.applicability, input.facts);
    if (applicability === false) continue;

    const missing = ruleMissingFacts(rule, input.facts);
    // Not applicable yet because facts are unknown: still a clarification candidate
    // only if the rule declares those facts as required.
    if (applicability === 'unknown' && missing.length === 0) continue;

    const conditions = evalExpr(rule.conditions, input.facts);
    const exceptions = (rule.exceptions ?? []).map((e) => evalExpr(e, input.facts));
    const hasTrueException = exceptions.includes(true);
    const hasUnknownException = exceptions.includes('unknown');

    if (applicability === true && conditions === true && !hasTrueException && !hasUnknownException) {
      if (mayProduceFinding(rule, input.ruleMode)) {
        base.findings.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          packVersion: input.rulePack.version,
          domain: rule.domain,
          reviewStatus: rule.reviewStatus,
          severity: rule.outcome.severity,
          code: rule.outcome.code,
          messageHe: rule.outcome.messageHe,
          evidenceFactIds: ruleMissingFacts(rule, input.facts).length
            ? []
            : [...exprFactIds(rule.conditions)],
          ...(rule.reviewStatus !== 'approved' ? { draft: true as const } : {}),
          ...(rule.source ? { source: rule.source } : {}),
        });
      } else {
        base.draftObservations.push({
          ruleId: rule.id,
          note: 'draft_or_unapproved_rule_matched_internal_only',
        });
      }
      // A matched rule may still declare required facts that were not part of
      // its conditions (e.g. identifiability for a perceived-meaning cue).
      // Those facts remain clarification candidates: matching is not concluding.
      if (missing.length > 0) missingByRule.set(rule.id, { rule, missing });
      continue;
    }

    if (!hasTrueException && conditions !== false &&
        (applicability === 'unknown' || conditions === 'unknown' || hasUnknownException) && missing.length > 0) {
      missingByRule.set(rule.id, { rule, missing });
    }
  }

  // Blocked sections have no executable rules. Route their source-card topics
  // independently, only when this CC pack is being checked. This is referral
  // relevance, not evidence verification or a halachic conclusion.
  const checkingCC = input.rulePack.rules.some((r) => r.reviewStatus !== 'retired' &&
    coverageKeyOfSource(r.source) !== null);
  if (checkingCC) for (const s of groupD.values()) {
    if (s.disposition === 'blocked' && hasReferralTopic(s, input.facts)) emitReferral(s.key);
  }
  base.referrals.sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));

  const missingFactIds = [...new Set([...missingByRule.values()].flatMap((x) => x.missing))].sort();
  const questions = planQuestions(missingByRule, input.catalog, input.maxQuestions ?? 1);

  // Double-check contract: extractor vs engine. Material disagreement downgrades to doubt.
  const engineConcern = base.findings.length > 0;
  let disagreement = false;
  if (input.directAssessment === 'concern' && !engineConcern && missingFactIds.length === 0) {
    disagreement = true;
    limitationsHe.push('הערכת המודל הישירה מצביעה על חשש אך המנוע לא מצא כלל תואם; מסומן כספק לבדיקה.');
  } else if (input.directAssessment === 'no_concern' && engineConcern) {
    disagreement = true;
    limitationsHe.push('הערכת המודל הישירה שונה מתוצאת המנוע; מסומן כספק לבדיקה ולא כהכרעה.');
  }
  base.disagreement = disagreement;

  const needsClarification = missingFactIds.length > 0;
  if (needsClarification) {
    limitationsHe.push('הבדיקה לא הושלמה: חסר מידע שעשוי לשנות את התוצאה. לא זוהה חשש אינו אישור.');
  }
  if (base.draftObservations.length > 0) {
    limitationsHe.push('כללי טיוטה התאימו באופן פנימי אך אינם מאושרים, ולכן לא הופק מהם ממצא למשתמש.');
  }
  if (base.referrals.length > 0) {
    limitationsHe.push(
      `נמצאו ${base.referrals.length} סעיפים (קבוצה ד׳) הדורשים בירור מומחה; הם מופנים לרב עם הפרטים ואינם מוכרעים אוטומטית.`,
    );
  }

  return {
    ...base,
    missingFactIds,
    questions,
    limitationsHe,
    // Specialist clarification remains unresolved even without a yes/no question.
    status: needsClarification || disagreement || base.referrals.length > 0 ? 'needs_clarification' : 'evaluated',
  };
}
