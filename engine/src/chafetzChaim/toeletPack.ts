// Chafetz Chaim Part One, Principle 10. Draft warnings/clarification only.
// Exact primary text: sources/chafetz-chaim/text/p1_prin10.txt (CC-BY-SA).
// The single condition definition below is shared by all cumulative frames.
import type { Expr, RulePack } from '../types.js';
import { exprFactIds } from '../evalExpr.js';
import { all, any, yes, no, ccRule, ccSource, SPEECH, PURPOSE, UNVERIFIED } from './shared.js';
import { ESTABLISHED_REBUKE_ALTERNATIVE } from './rebukePublicity.js';

const src = (section: number) => ccSource(1, 10, section);
// Section 2 permits personal knowledge OR subsequently verified hearsay.
// Section 7 requires publicity when rebuke is known to be ineffective.
// Section 9's four public-reputation predicates are separate user confirmations.
// Section 8's possible fear leniency suppresses publicity warnings, but does not
// establish this cumulative frame without expert resolution (contextPack).
export const CC_TOELET_CONDITIONS: Expr = all(
  any(yes('speaker.knows_first_hand'), yes('toelet.facts_verified')),
  yes('speaker.checked_halachic_classification'),
  any(yes('toelet.rebuke_attempted'), ESTABLISHED_REBUKE_ALTERNATIVE),
  no('message.contains_falsehood_or_exaggeration'),
  PURPOSE, no('speaker.intent_to_disparage'), no('speaker.motive_is_revenge_or_hatred'),
  yes('toelet.no_other_way'), yes('toelet.no_excess_harm'),
);
const frame = all(SPEECH, PURPOSE);
// Preserve the established rule IDs and source-prefixed messages.
function rule(
  id: string, section: number, title: string, conditions: Expr, text: string,
  required: string[] = [], exceptions: Expr[] = [],
) {
  const result = ccRule(id, src(section), title, frame, conditions, text, exceptions, required);
  result.outcome.messageHe = `לפי חפץ חיים כלל י׳ סעיף ${section}: ${text}; יש לבדוק את התנאים והחריגים. טיוטה בלבד, לא פסק ולא היתר.`;
  return result;
}
export const CC_TOELET_DRAFT_PACK: RulePack = {
  id: 'cc-toelet-draft', version: '0.2.0', rules: [
    rule('cc-toelet.10-01.wrongdoing-frame', 1, 'מסגרת עוולה שלא תוקנה',
      all(CC_TOELET_CONDITIONS, no('subject.has_repented_or_reformed')),
      'גם מסגרת תנאים מלאה דורשת בירור שהעוולה טרם תוקנה ושמתקיימים פרטי הסיפור; אין כאן אישור'),
    rule('cc-toelet.10-02a.first-hand-or-verified', 2, 'ראייה או אימות', UNVERIFIED,
      'אין לפי המידע ראייה עצמית או בירור מאוחר של אמת הדברים'),
    rule('cc-toelet.10-02c.rebuke-first', 2, 'תוכחה בלשון רכה',
      all(no('toelet.rebuke_attempted'), no('toelet.knows_subject_will_not_accept_rebuke')),
      'לא נוסתה תוכחה בלשון רכה; חריג אי־קבלת תוכחה טעון ידיעה ואינו נלמד מחוסר מידע'),
    rule('cc-toelet.10-02d.no-exaggeration', 2, 'אין להגדיל עוולה',
      yes('message.contains_falsehood_or_exaggeration'), 'יש לבדוק תוספת, הגזמה או השמטת פרט זכות שמשנים את הצגת העוולה'),
    rule('cc-toelet.10-02e.constructive-intent', 2, 'כוונה לתועלת',
      any(yes('speaker.intent_to_disparage'), yes('speaker.motive_is_revenge_or_hatred')),
      'הצהרה על תועלת יחד עם כוונת גנאי או שנאה דורשת בירור כוונה, ולא מסירה את החשש'),
    rule('cc-toelet.10-02f.no-other-way', 2, 'עצה אחרת',
      no('toelet.no_other_way'), 'יש דרך אחרת להשיג את אותה תועלת בלי לספר את הגנות'),
    rule('cc-toelet.10-02g.no-excess-harm', 2, 'נזק לא יותר מכפי הדין',
      no('toelet.no_excess_harm'), 'יש לבדוק שהנזק לא יעלה על מה שהיה יוצא לפי הדין על פי עדות באותו אופן'),
    rule('cc-toelet.10-04.no-benefit-from-spread', 4, 'אין תועלת צפויה',
      all(no('toelet.future_benefit_expected'), yes('audience.listener_will_spread')),
      'רצון להועיל אינו תועלת צפויה בפועל; הפצה בלי תועלת עלולה להוסיף רכילות ומחלוקת'),
    rule('cc-toelet.10-11.revenge-or-grievance', 11, 'כוונת גנאי בתלונה',
      yes('speaker.intent_to_disparage'), 'יש לברר תלונה מתוך רצון לפרסם קלון; מסלול עזרה ממשית מפורט בסעיף י״ג'),
    rule('cc-toelet.10-14.seven-conditions-reiterated', 14, 'תנאים בתלונה אישית',
      all(CC_TOELET_CONDITIONS, yes('speaker.knows_first_hand'), no('subject.has_repented_or_reformed')),
      'בתלונה על פגיעה בכותב נדרשת ידיעה עצמית, בירור הדין, תועלת וכל יתר התנאים, לרבות אי־השמטת צד זכות'),
    rule('cc-toelet.10-15.weigh-and-plan', 15, 'שקילה לפני סיפור',
      any(no('speaker.checked_halachic_classification'), yes('message.contains_falsehood_or_exaggeration'), no('toelet.no_excess_harm')),
      'יש לשקול מראש את הסיווג, הניסוח והתוצאה, ולא להכריע מתוך כעס בשעת הסיפור'),
    rule('cc-toelet.10-17.identifying-when-asked', 17, 'נשאל מי עשה',
      all(yes('context.asked_to_identify_sinner'), CC_TOELET_CONDITIONS),
      'גם כאשר נשאל מי עשה, יש לבדוק אם קיימת עילה עצמאית למסירה; היכולת להסיר חשד מן הכותב אינה לבדה בסיס לחשיפת האחר'),
  ],
};
export function toeletPackFactIds(): Set<string> {
  return new Set(CC_TOELET_DRAFT_PACK.rules.flatMap(r => [
    ...(r.requiredFacts ?? []), ...exprFactIds(r.applicability), ...exprFactIds(r.conditions),
    ...(r.exceptions ?? []).flatMap(e => [...exprFactIds(e)]),
  ]));
}
