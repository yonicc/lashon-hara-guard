// Draft source-linked reminders, never verdicts. Primary text: sources/chafetz-chaim.
// CC-BY-SA; interpretation remains draft and requires qualified review.
import type { Expr, Rule, RulePack, SourceRef } from '../types.js';
import { exprFactIds } from '../evalExpr.js';

export const yes = (id: string): Expr => ({ eq: [id, true] });
export const no = (id: string): Expr => ({ eq: [id, false] });
export const all = (...and: Expr[]): Expr => ({ and });
export const any = (...or: Expr[]): Expr => ({ or });

export function ccSource(part: 1 | 2, principle: number, section: number): SourceRef {
  const name = part === 1 ? 'Part One, The Prohibition Against Lashon Hara' : 'Part Two, The Prohibition Against Rechilut';
  return { work: 'Chafetz Chaim', part: name, principle: `Principle ${principle}`,
    section: `${principle}:${section}`, edition: 'Chofetz Chaim (Sefaria, CC-BY-SA)',
    url: `https://www.sefaria.org/Chafetz_Chaim,_${name.replaceAll(' ', '_')},_Principle_${principle}:${section}` };
}

export const IDENTIFIED = yes('subject.identifiable');
export const DISPARAGEMENT = any(yes('message.content_is_disparaging'), yes('message.may_be_understood_as_disparagement'));
export const SPEECH = all(IDENTIFIED, DISPARAGEMENT);
export const RECHILUT = all(IDENTIFIED, yes('message.reports_what_someone_said_or_did_against_listener'));
export const RECEIVING = yes('listener.role_is_receiving');
export const PURPOSE = yes('toelet.purpose_is_constructive');
export const UNVERIFIED = all(no('speaker.knows_first_hand'), no('toelet.facts_verified'));

/** Evaluation owns exception semantics; keep each predicate in one expression. */
export function ccRule(
  id: string, source: SourceRef, titleHe: string, applicability: Expr, conditions: Expr,
  messageHe: string, exceptions: Expr[] = [], requiredFacts: string[] = [],
): Rule {
  return {
    id, version: '0.2.0', domain: 'halacha_draft', reviewStatus: 'draft',
    titleHe: `טיוטה: ${titleHe}`, source, applicability, conditions,
    requiredFacts: [...new Set([...requiredFacts, ...exprFactIds(conditions)])],
    ...(exceptions.length ? { exceptions } : {}),
    outcome: { severity: 'medium', code: id.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_') + '_DRAFT',
      messageHe: `לפי חפץ חיים ${source.part?.startsWith('Part One') ? 'הלכות לשון הרע' : 'הלכות רכילות'} כלל ${source.principle?.replace('Principle ', '')} סעיף ${source.section?.split(':')[1]}: ${messageHe}; יש לבדוק את התנאים והחריגים. טיוטה בלבד, לא פסק ולא היתר.` },
  };
}
export const pack = (id: string, rules: Rule[]): RulePack => ({ id, version: '0.2.0', rules });
