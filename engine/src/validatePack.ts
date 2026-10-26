import type { RulePack } from './types.js';

export interface PackValidation {
  valid: boolean;
  errors: string[];
}

/** Structural validation. An approved rule without a valid source is a pack error. */
export function validateRulePack(pack: RulePack): PackValidation {
  const errors: string[] = [];
  if (!pack.id) errors.push('pack.id missing');
  if (!pack.version) errors.push('pack.version missing');
  const seen = new Set<string>();
  for (const r of pack.rules ?? []) {
    if (!r.id) errors.push('rule without id');
    if (r.id && seen.has(r.id)) errors.push(`duplicate rule id: ${r.id}`);
    if (r.id) seen.add(r.id);
    if (!r.version) errors.push(`${r.id}: version missing`);
    if (!r.titleHe) errors.push(`${r.id}: titleHe missing`);
    if (!r.applicability) errors.push(`${r.id}: applicability missing`);
    if (!r.conditions) errors.push(`${r.id}: conditions missing`);
    if (!r.outcome?.code) errors.push(`${r.id}: outcome.code missing`);
    if (r.reviewStatus === 'approved') {
      if (!r.source?.work || !r.source?.verifiedAt) {
        errors.push(`${r.id}: approved rule requires verified source (work + verifiedAt)`);
      }
      if (!r.reviewer || !r.reviewedAt) {
        errors.push(`${r.id}: approved rule requires reviewer + reviewedAt`);
      }
      if (!r.fixtures || r.fixtures.length === 0) {
        errors.push(`${r.id}: approved rule requires fixtures`);
      }
    }
    if (r.reviewStatus !== 'draft' && r.reviewStatus !== 'retired' && !r.source?.work) {
      errors.push(`${r.id}: non-draft rule requires source.work`);
    }
  }
  return { valid: errors.length === 0, errors };
}
