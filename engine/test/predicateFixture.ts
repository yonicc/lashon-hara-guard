import assert from 'node:assert/strict';
import { evaluate as evaluateRuntime } from '../src/evaluate.js';
import { isGroupDSource, coverageKeyOfSource, groupDByKey, hasReferralTopic } from '../src/chafetzChaim/referral.js';
import { evalExpr, exprFactIds } from '../src/evalExpr.js';
import type { EvaluationInput, EvaluationResult } from '../src/types.js';

/**
 * Preserve predicate-level regression coverage after group D became referral-only.
 * First evaluate the REAL pack and assert the referral boundary. Then evaluate
 * synthetic copies under a non-CC work name to exercise dormant predicates and
 * three-valued question planning independently. This helper is test-only.
 * Runtime integration tests import evaluate directly (rabbiReferral.test.ts).
 */
export function evaluatePredicates(input: EvaluationInput): EvaluationResult {
  const actual = evaluateRuntime(input);
  const groupD = input.rulePack.rules.filter(r => isGroupDSource(r.source));
  for (const rule of groupD) {
    assert.ok(!actual.findings.some(f => f.ruleId === rule.id), rule.id + ': no group-D finding');
    assert.ok(!actual.draftObservations.some(f => f.ruleId === rule.id), rule.id + ': no group-D observation');
    const section = groupDByKey().get(coverageKeyOfSource(rule.source)!);
    if (rule.reviewStatus !== 'retired' && section && hasReferralTopic(section, input.facts,
        [...exprFactIds(rule.applicability), ...exprFactIds(rule.conditions)]) &&
        evalExpr(rule.applicability, input.facts) !== false) {
      assert.ok(actual.referrals.some(r => r.sectionKey === coverageKeyOfSource(rule.source)),
        rule.id + ': actual runtime referral');
    }
  }
  return evaluateRuntime({ ...input, rulePack: { ...input.rulePack,
    rules: input.rulePack.rules.map(r => isGroupDSource(r.source) ?
      { ...r, source: { ...r.source!, work: 'Synthetic predicate fixture' } } : r) } });
}
