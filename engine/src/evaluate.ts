import { createHash } from 'node:crypto';
import type {
  DraftObservation,
  EvaluationInput,
  EvaluationResult,
  Finding,
  Rule,
} from './types.js';
import { evalExpr, exprFactIds, isFactKnown } from './evalExpr.js';
import { planQuestions } from './questionPlanner.js';
import { validateRulePack } from './validatePack.js';

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
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function ruleMissingFacts(rule: Rule, facts: EvaluationInput['facts']): string[] {
  const ids = new Set<string>();
  (rule.requiredFacts ?? []).forEach((f) => ids.add(f));
  exprFactIds(rule.applicability).forEach((f) => ids.add(f));
  exprFactIds(rule.conditions).forEach((f) => ids.add(f));
  (rule.exceptions ?? []).forEach((e) => exprFactIds(e).forEach((f) => ids.add(f)));
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
export function evaluate(input: EvaluationInput): EvaluationResult {
  const base = {
    findings: [] as Finding[],
    draftObservations: [] as DraftObservation[],
    missingFactIds: [] as string[],
    questions: [] as EvaluationResult['questions'],
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

  for (const rule of input.rulePack.rules) {
    if (rule.reviewStatus === 'retired') continue;
    const applicability = evalExpr(rule.applicability, input.facts);
    if (applicability === false) continue;

    const missing = ruleMissingFacts(rule, input.facts);
    // Not applicable yet because facts are unknown: still a clarification candidate
    // only if the rule declares those facts as required.
    if (applicability === 'unknown' && missing.length === 0) continue;

    const conditions = evalExpr(rule.conditions, input.facts);
    const hasTrueException = (rule.exceptions ?? []).some(
      (e) => evalExpr(e, input.facts) === true,
    );

    if (applicability === true && conditions === true && !hasTrueException) {
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

    if ((applicability === 'unknown' || conditions === 'unknown') && missing.length > 0) {
      missingByRule.set(rule.id, { rule, missing });
    }
  }

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

  return {
    ...base,
    missingFactIds,
    questions,
    limitationsHe,
    status: needsClarification || disagreement ? 'needs_clarification' : 'evaluated',
  };
}
