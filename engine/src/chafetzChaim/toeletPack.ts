// Draft executable rules for Chafetz Chaim, Part One, Principle 10 (to'elet —
// speaking about a wrongdoer for a constructive purpose), se'ifim 1-17.
//
// Source layer (exact refs/urls): sources/chafetz-chaim/manifest.json, key p1_prin10.
// Study cards: rules/chafetz-chaim/cards/p1_prin10.json (all draft).
//
// IRON RULE (docs/03): there is NO rule of the form "constructive purpose =>
// permitted". A declared benefit is never a blanket permit. Every rule here is
// reviewStatus 'draft' in domain 'halacha_draft', so evaluate() can only surface
// it as an internal draftObservation — never as a user finding, never as a verdict.
// While any of the seven conditions of se'if 2 is unknown, the engine asks a
// clarification question about the missing condition (questions come only from
// FACT_CATALOG in lessonScenario.ts; question text lives only in
// rules/chafetz-chaim/facts.json). A failed condition yields a draft observation
// that names the missing condition — it is still not a ruling of "forbidden".
//
// Missing-fact policy: facts that exist only as proposedNewFacts on the cards
// (not yet in rules/chafetz-chaim/facts.json) are NOT used here; they are listed
// in docs/18-toelet-rules.md as open items for the facts-consolidation chat.
import type { Expr, Rule, RulePack, SourceRef } from '../types.js';

const SEFARIA_BASE =
  'https://www.sefaria.org/Chafetz_Chaim,_Part_One,_The_Prohibition_Against_Lashon_Hara,_Principle_10';

/** Exact manifest ref/url for a se'if of Principle 10 (sources/chafetz-chaim/manifest.json). */
function src(section: number): SourceRef {
  return {
    work: 'Chafetz Chaim',
    part: 'Part One, The Prohibition Against Lashon Hara',
    principle: 'Principle 10',
    section: `10:${section}`,
    url: `${SEFARIA_BASE}:${section}`,
  };
}

/** Applicability shared by every rule in this pack: an identifiable subject and
 *  content that is (or may be understood as) disparaging about that subject. */
const ABOUT_IDENTIFIABLE_SUBJECT: Expr = {
  and: [
    { eq: ['subject.identifiable', true] },
    {
      or: [
        { eq: ['message.content_is_disparaging', true] },
        { eq: ['message.may_be_understood_as_disparagement', true] },
      ],
    },
  ],
};

export const CC_TOELET_DRAFT_PACK: RulePack = {
  id: 'cc-toelet-draft',
  version: '0.1.0',
  rules: [
    {
      id: 'cc-toelet.10-01.wrongdoing-frame',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: מסגרת סיפור עוולה לתועלת — שבעת הפרטים הם תנאי מצטבר (כלל י׳ סעיף א׳)',
      reviewStatus: 'draft',
      source: src(1),
      requiredFacts: [
        'speaker.knows_first_hand',
        'toelet.facts_verified',
        'toelet.rebuke_attempted',
        'message.contains_falsehood_or_exaggeration',
        'toelet.purpose_is_constructive',
        'speaker.intent_to_disparage',
        'toelet.no_other_way',
        'toelet.no_excess_harm',
      ],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['speaker.knows_first_hand', true] },
          { eq: ['toelet.facts_verified', true] },
          { eq: ['toelet.rebuke_attempted', true] },
          { eq: ['message.contains_falsehood_or_exaggeration', false] },
          { eq: ['toelet.purpose_is_constructive', true] },
          { eq: ['speaker.intent_to_disparage', false] },
          { eq: ['toelet.no_other_way', true] },
          { eq: ['toelet.no_excess_harm', true] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_1_SEVEN_CONDITIONS_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף א׳ יש לבדוק שמתקיימים כל שבעת הפרטים שבסעיף ב׳ יחד; גם אם כולם מתקיימים, זו טיוטה לבדיקה בלבד ולא היתר ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-02a.first-hand-or-verified',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי א׳ — ראה בעצמו או שנתברר לו אחר כך שהדבר אמת (כלל י׳ סעיף ב׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['speaker.knows_first_hand', 'toelet.facts_verified'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['speaker.knows_first_hand', false] },
          { eq: ['toelet.facts_verified', false] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND1_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט א׳) יש לבדוק שהכותב ראה את הדבר בעצמו, או שאם שמע מאחרים — נתברר לו אחר כך שהדבר אמת; לפי המידע הידוע תנאי זה אינו מתקיים, ולכן זו הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-02c.rebuke-first',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי ג׳ — תוכחה בלשון רכה לפני פרסום (כלל י׳ סעיף ב׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['toelet.rebuke_attempted'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: { eq: ['toelet.rebuke_attempted', false] },
      // Se'if 7: one who knows the subject will not accept rebuke need not rebuke
      // first. A true exception only blocks THIS draft note; it never permits.
      exceptions: [{ eq: ['toelet.knows_subject_will_not_accept_rebuke', true] }],
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND3_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט ג׳) יש לבדוק שקודם הוכיחו את החוטא בלשון רכה; לפי המידע הידוע לא נעשה ניסיון תוכחה, ולכן זו הערת טיוטה לבדיקה ולא פסק (החריג למי שיודע שלא יקבל תוכחה נדון בסעיף ז׳).',
      },
    },
    {
      id: 'cc-toelet.10-02d.no-exaggeration',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי ד׳ — שלא יגדיל העוולה יותר ממה שהיא (כלל י׳ סעיף ב׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['message.contains_falsehood_or_exaggeration'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: { eq: ['message.contains_falsehood_or_exaggeration', true] },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND4_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט ד׳) יש לבדוק שלא מגדילים את העוולה יותר ממה שהיא; לפי המידע הידוע יש בדברים תוספת, הגזמה או אי־דיוק, ולכן זו הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-02e.constructive-intent',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי ה׳ — כוונה לתועלת ולא להנאה מהפגם או שנאה (כלל י׳ סעיף ב׳, וביאורו בסעיף ד׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['toelet.purpose_is_constructive', 'speaker.intent_to_disparage'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        or: [
          { eq: ['toelet.purpose_is_constructive', false] },
          { eq: ['speaker.intent_to_disparage', true] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND5_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט ה׳) וסעיף ד׳ יש לבדוק שהכוונה היא לתועלת ולא להנאה מהפגם ולא מצד שנאה; לפי המידע הידוע תנאי הכוונה אינו מתקיים, ולכן זו הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-02f.no-other-way',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי ו׳ — אין עצה אחרת להשיג את התועלת בלי לספר (כלל י׳ סעיף ב׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['toelet.no_other_way'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: { eq: ['toelet.no_other_way', false] },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND6_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט ו׳) יש לבדוק שאי אפשר לסבב את אותה תועלת בעצה אחרת בלי לספר; לפי המידע הידוע קיימת דרך אחרת, ולכן זו הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-02g.no-excess-harm',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: תנאי ז׳ — שלא יסובב נזק יותר מכפי הדין (כלל י׳ סעיף ב׳)',
      reviewStatus: 'draft',
      source: src(2),
      requiredFacts: ['toelet.no_excess_harm'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: { eq: ['toelet.no_excess_harm', false] },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_2_COND7_UNMET_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ב׳ (פרט ז׳) יש לבדוק שהסיפור לא יסובב לנדון נזק יותר מכפי הדין; לפי המידע הידוע הנזק עלול לעלות על כך, ולכן זו הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-04.no-benefit-from-spread',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: כשאין צפי לתועלת והדברים צפויים להתפשט — בירור נוסף (כלל י׳ סעיף ד׳)',
      reviewStatus: 'draft',
      source: src(4),
      requiredFacts: ['toelet.purpose_is_constructive', 'audience.listener_will_spread'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['toelet.purpose_is_constructive', false] },
          { eq: ['audience.listener_will_spread', true] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_4_NO_BENEFIT_SPREAD_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ד׳ יש לבדוק את צפי התועלת מהסיפור; כשאין תועלת צפויה והשומעים צפויים להפיץ את הדברים הלאה, זו הערת טיוטה לבדיקה נוספת ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-11.revenge-or-grievance',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: סיפור עוול אישי מתוך כוונת גנאי — בדיקת כוונה (כלל י׳ סעיף י״א)',
      reviewStatus: 'draft',
      source: src(11),
      requiredFacts: ['speaker.intent_to_disparage', 'toelet.purpose_is_constructive'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['speaker.intent_to_disparage', true] },
          { eq: ['toelet.purpose_is_constructive', false] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_11_DISPARAGING_INTENT_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף י״א יש לבדוק את כוונת המספר; כוונה לבזות או להקטין בלי תועלת בונה היא הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-14.seven-conditions-reiterated',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: חזרה על שבעת התנאים כתנאי מצטבר (כלל י׳ סעיף י״ד)',
      reviewStatus: 'draft',
      source: src(14),
      requiredFacts: [
        'speaker.knows_first_hand',
        'toelet.facts_verified',
        'toelet.rebuke_attempted',
        'message.contains_falsehood_or_exaggeration',
        'toelet.purpose_is_constructive',
        'speaker.intent_to_disparage',
        'toelet.no_other_way',
        'toelet.no_excess_harm',
      ],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['speaker.knows_first_hand', true] },
          { eq: ['toelet.facts_verified', true] },
          { eq: ['toelet.rebuke_attempted', true] },
          { eq: ['message.contains_falsehood_or_exaggeration', false] },
          { eq: ['toelet.purpose_is_constructive', true] },
          { eq: ['speaker.intent_to_disparage', false] },
          { eq: ['toelet.no_other_way', true] },
          { eq: ['toelet.no_excess_harm', true] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_14_SEVEN_CONDITIONS_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף י״ד יש לבדוק שכל שבעת התנאים מתקיימים יחד לפני כל סיפור לתועלת; גם מסגרת מלאה נשארת טיוטה לבדיקה ולא היתר ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-15.weigh-and-plan',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: שקול ותכנון הניסוח לפני סיפור לתועלת (כלל י׳ סעיף ט״ו)',
      reviewStatus: 'draft',
      source: src(15),
      requiredFacts: ['message.contains_falsehood_or_exaggeration', 'toelet.no_excess_harm'],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['toelet.purpose_is_constructive', true] },
          {
            or: [
              { eq: ['message.contains_falsehood_or_exaggeration', true] },
              { eq: ['toelet.no_excess_harm', false] },
            ],
          },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_15_WEIGH_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף ט״ו יש לבדוק בשקול רב את הניסוח ואת התוצאות לפני סיפור לתועלת; ניסוח מוגזם או נזק עודף הם הערת טיוטה לבדיקה ולא פסק.',
      },
    },
    {
      id: 'cc-toelet.10-17.identifying-when-asked',
      version: '0.1.0',
      domain: 'halacha_draft',
      titleHe: 'טיוטה: גילוי זהות חוטא כשנשאל — אותה מסגרת תנאים (כלל י׳ סעיף י״ז)',
      reviewStatus: 'draft',
      source: src(17),
      requiredFacts: [
        'speaker.knows_first_hand',
        'toelet.facts_verified',
        'toelet.no_other_way',
        'toelet.no_excess_harm',
      ],
      applicability: ABOUT_IDENTIFIABLE_SUBJECT,
      conditions: {
        and: [
          { eq: ['speaker.knows_first_hand', true] },
          { eq: ['toelet.facts_verified', true] },
          { eq: ['toelet.purpose_is_constructive', true] },
          { eq: ['toelet.no_other_way', true] },
          { eq: ['toelet.no_excess_harm', true] },
        ],
      },
      outcome: {
        severity: 'medium',
        code: 'CC_TOELET_10_17_IDENTIFY_DRAFT',
        messageHe:
          'לפי חפץ חיים כלל י׳ סעיף י״ז יש לבדוק שמתקיימת אותה מסגרת תנאים של סיפור לתועלת גם כשמגלים זהות; זו טיוטה לבדיקה בלבד ולא היתר לחשוף זהות ולא פסק.',
      },
    },
  ],
};

/** Fact ids referenced by this pack (applicability + conditions + requiredFacts). */
export function toeletPackFactIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (e: Rule['applicability']): void => {
    if ('eq' in e) ids.add(e.eq[0]);
    else if ('neq' in e) ids.add(e.neq[0]);
    else if ('in' in e) ids.add(e.in[0]);
    else if ('exists' in e) ids.add(e.exists);
    else if ('missing' in e) ids.add(e.missing);
    else if ('gte' in e) ids.add(e.gte[0]);
    else if ('and' in e) e.and.forEach(walk);
    else if ('or' in e) e.or.forEach(walk);
    else if ('not' in e) walk(e.not);
  };
  for (const r of CC_TOELET_DRAFT_PACK.rules) {
    (r.requiredFacts ?? []).forEach((f) => ids.add(f));
    walk(r.applicability);
    walk(r.conditions);
    (r.exceptions ?? []).forEach(walk);
  }
  return ids;
}
