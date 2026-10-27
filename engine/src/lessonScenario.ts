import type { FactCatalogEntry, RulePack } from './types.js';

/** Canonical fact catalog: each askable fact and its question are defined once here. */
export const FACT_CATALOG: FactCatalogEntry[] = [
  {
    id: 'message.criticizes_lesson_content',
    questionHe: 'האם ההודעה מביעה ביקורת על נושא או תוכן של שיעור?',
    priority: 5,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.may_be_understood_as_disparagement',
    questionHe: 'האם נמען סביר עלול להבין את הדברים כגנאי?',
    priority: 7,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.interpretation_uncertain',
    questionHe: 'האם נדרש בירור כיצד הדברים עלולים להתפרש בעיני הנמענים?',
    priority: 8,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'lesson.teacher_id',
    questionHe: 'מי מוסר את השיעור שההודעה מתייחסת אליו?',
    priority: 10,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'relationships.teacher_is_parent',
    questionHe: 'האם מוסר השיעור הוא אביך?',
    priority: 20,
    sensitivity: 'high',
    persistent: true,
    confirmedByUserOnly: true,
  },
  {
    id: 'lesson.teacher_in_audience',
    questionHe: 'האם מוסר השיעור נמצא בקבוצת הנמענים של ההודעה?',
    priority: 30,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'message.purpose',
    questionHe: 'מה מטרת ההודעה?',
    priority: 40,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'subject.identifiable',
    questionHe: 'האם אפשר לזהות במי מדובר (גם מרמז או מהקשר)?',
    priority: 50,
    sensitivity: 'medium',
    persistent: false,
  },
  // --- Chafetz Chaim vocabulary (rules/chafetz-chaim/facts.json) ---
  // questionHe below is copied verbatim from facts.json: that file is the single
  // source of the clarification questions, and toelet.test.ts fails on any drift.
  // The toelet.* / speaker.* facts drive the draft rules in chafetzChaim/toeletPack.ts.
  {
    id: 'message.content_is_disparaging',
    questionHe: 'האם תוכן הדברים מגנה את המדובר?',
    priority: 6,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'toelet.purpose_is_constructive',
    questionHe: 'האם יש לדברים תועלת לעתיד (מניעת נזק, הצלה, תיקון)?',
    priority: 45,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'toelet.facts_verified',
    questionHe: 'האם הכותב בירר שהדברים נכונים ולא הסיק מהר?',
    priority: 46,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'toelet.rebuke_attempted',
    questionHe: 'האם קודם ניסו להוכיח את המדובר בעצמו?',
    priority: 47,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'toelet.no_other_way',
    questionHe: 'האם אין דרך להשיג את התועלת בלי לספר?',
    priority: 48,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'toelet.no_excess_harm',
    questionHe: 'האם הנזק למדובר לא יעלה על מה שמגיע לו לפי הדין?',
    priority: 49,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'subject.is_fellow',
    questionHe: 'האם מדובר באדם שחלים עליו דיני ״עמיתך״ (ולא במי שהספר מוציא מכלל זה)?',
    priority: 60,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'subject.is_group',
    questionHe: 'האם הדברים נאמרים על קבוצה, משפחה, קהילה או עיר שלמה?',
    priority: 61,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'subject.is_relative_of_speaker',
    questionHe: 'האם המדובר הוא קרוב משפחה של הכותב?',
    priority: 62,
    sensitivity: 'high',
    persistent: true,
  },
  {
    id: 'subject.is_minor',
    questionHe: 'האם המדובר הוא קטין?',
    priority: 63,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'message.content_may_cause_harm',
    questionHe: 'האם הדברים עלולים לגרום לו נזק בגוף, בממון, בפרנסה או צער?',
    priority: 64,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.content_is_true',
    questionHe: 'האם הדברים אמת לפי מה שידוע לכותב?',
    priority: 65,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.contains_falsehood_or_exaggeration',
    questionHe: 'האם יש בדברים תוספת, הגזמה או אי־דיוק?',
    priority: 66,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.is_hint_or_implied',
    questionHe: 'האם הגנאי נאמר ברמז, בשתיקה מכוונת או בנימה, ולא במפורש?',
    priority: 67,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.said_in_jest',
    questionHe: 'האם הדברים נאמרו בדרך צחוק או הלצה?',
    priority: 68,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.reports_what_someone_said_or_did_against_listener',
    questionHe: 'האם הכותב מספר לשומע מה פלוני אמר או עשה נגדו (רכילות)?',
    priority: 69,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.about_craft_or_goods',
    questionHe: 'האם הדברים עוסקים באיכות מלאכתו, סחורתו או שירותו של אדם?',
    priority: 70,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'message.about_torah_or_piety',
    questionHe: 'האם הדברים עוסקים בחסרון בתורתו או ביראת השמים שלו?',
    priority: 71,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'speaker.knows_first_hand',
    questionHe: 'האם הכותב יודע את הדברים בעצמו, ולא משמועה?',
    priority: 72,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'speaker.would_say_in_subjects_presence',
    questionHe: 'האם הכותב היה אומר את הדברים גם בפני המדובר?',
    priority: 73,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'speaker.intent_to_disparage',
    questionHe: 'האם הכוונה היא לבזות או להקטין את המדובר?',
    priority: 74,
    sensitivity: 'medium',
    persistent: false,
  },
  {
    id: 'matter.already_known_to_many',
    questionHe: 'האם הדבר כבר ידוע לרבים (למשל נאמר בפני שלושה)?',
    priority: 75,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'audience.size_at_least_three',
    questionHe: 'האם הדברים נאמרים בפני שלושה אנשים או יותר?',
    priority: 76,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'audience.includes_subject',
    questionHe: 'האם המדובר נמצא בין הנמענים?',
    priority: 77,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'audience.listener_will_spread',
    questionHe: 'האם צפוי שהשומעים יפיצו את הדברים הלאה?',
    priority: 78,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'listener.role_is_receiving',
    questionHe: 'האם המשתמש הוא השומע/המקבל של הדברים (הודעה נכנסת)?',
    priority: 80,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'listener.needs_info_for_protection',
    questionHe: 'האם השומע צריך את המידע כדי להיזהר או להינצל מנזק?',
    priority: 81,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'listener.believes_report',
    questionHe: 'האם השומע מקבל את הדברים כאמת?',
    priority: 82,
    sensitivity: 'low',
    persistent: false,
  },
];

/** Lookup helper for modules that need catalog metadata without duplicating it. */
export const FACT_BY_ID = new Map(FACT_CATALOG.map((entry) => [entry.id, entry]));

/**
 * DRAFT routing rules for the lesson scenario only.
 * These are NOT halachic/legal rules and are NOT approved.
 * They only route clarification and internal review; they never emit user findings
 * and never encode "group size / presence / declared purpose => permitted".
 */
export const LESSON_ROUTING_PACK: RulePack = {
  id: 'routing-draft',
  version: '0.1.0',
  rules: [
    {
      id: 'route.lesson.teacher-identity',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: זיהוי מוסר השיעור לצורך השלמת בדיקה',
      reviewStatus: 'draft',
      requiredFacts: ['lesson.teacher_id'],
      applicability: { eq: ['message.criticizes_lesson_content', true] },
      conditions: { exists: 'lesson.teacher_id' },
      outcome: {
        severity: 'info',
        code: 'ROUTING_TEACHER_KNOWN',
        messageHe: 'זוהה מוסר השיעור; ניתן להמשיך בבדיקות התלויות בזהותו.',
      },
    },
    {
      id: 'route.lesson.family-review',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: פתיחת מסלול בדיקת קשר הורי (אינו ממצא ואינו פסק)',
      reviewStatus: 'draft',
      requiredFacts: ['lesson.teacher_id', 'relationships.teacher_is_parent'],
      applicability: { eq: ['message.criticizes_lesson_content', true] },
      conditions: { eq: ['relationships.teacher_is_parent', true] },
      outcome: {
        severity: 'info',
        code: 'ROUTING_FAMILY_REVIEW',
        messageHe: 'נפתח מסלול בדיקה נפרד לקשר הורי; נדרשת סקירת מקורות לפני כל הכוונה.',
      },
    },
    {
      id: 'route.lesson.audience',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: נוכחות מוסר השיעור בקהל (עובדת הקשר בלבד, ללא היתר)',
      reviewStatus: 'draft',
      requiredFacts: ['lesson.teacher_in_audience'],
      applicability: { eq: ['message.criticizes_lesson_content', true] },
      conditions: { eq: ['lesson.teacher_in_audience', true] },
      outcome: {
        severity: 'info',
        code: 'ROUTING_TEACHER_IN_AUDIENCE',
        messageHe: 'מוסר השיעור בקהל הנמענים; עובדה זו כשלעצמה אינה היתר ואינה הכרעה.',
      },
    },
    {
      id: 'route.lesson.purpose',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: בירור מטרת ההודעה לפני בדיקות התלויות במטרה',
      reviewStatus: 'draft',
      requiredFacts: ['message.purpose'],
      applicability: { eq: ['message.criticizes_lesson_content', true] },
      conditions: {
        in: ['message.purpose', ['warning', 'clarification', 'sharing', 'other']],
      },
      outcome: {
        severity: 'info',
        code: 'ROUTING_PURPOSE_KNOWN',
        messageHe: 'המטרה ידועה; הצהרת מטרה כשלעצמה אינה היתר וטעונה בדיקת תנאים.',
      },
    },
  ],
};

/**
 * Meaning-routing pack: messages whose perceived meaning may be heard as
 * insult/disparagement — including by implication, hint, irony, praise or
 * mockery — route to identity/purpose clarification even when no explicit
 * disparaging word is present. Draft routing only; never a finding.
 */
export const MEANING_ROUTING_PACK: RulePack = {
  id: 'meaning-routing-draft',
  version: '0.1.0',
  rules: [
    {
      id: 'route.meaning.perceived-disparagement',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: משמעות שעלולה להתפרש כהעלבה או גנות גם בלי גנאי מפורש',
      reviewStatus: 'draft',
      requiredFacts: ['subject.identifiable'],
      applicability: { eq: ['message.may_be_understood_as_disparagement', true] },
      conditions: { eq: ['message.may_be_understood_as_disparagement', true] },
      outcome: {
        severity: 'medium',
        code: 'ROUTE_PERCEIVED_DISPARAGEMENT',
        messageHe: 'הדברים עלולים להתפרש כגנות או העלבה; נדרש בירור זהות ומטרה לפני כל הכוונה.',
      },
    },
    {
      id: 'route.meaning.uncertain-interpretation',
      version: '0.1.0',
      domain: 'routing',
      titleHe: 'ניתוב: בירור פרשנות אפשרית של הדברים בעיני הנמענים',
      reviewStatus: 'draft',
      requiredFacts: ['subject.identifiable'],
      applicability: { eq: ['message.interpretation_uncertain', true] },
      conditions: { eq: ['message.interpretation_uncertain', true] },
      outcome: {
        severity: 'medium',
        code: 'ROUTE_INTERPRETATION_CLARIFICATION',
        messageHe: 'לא ברור כיצד הדברים יתפרשו; יש לברר אם אפשר לזהות במי מדובר.',
      },
    },
  ],
};

/** Convenience routing packs: lesson routing plus meaning routing. */
export const ROUTING_PACKS: Record<'lesson' | 'meaning', RulePack> = {
  lesson: LESSON_ROUTING_PACK,
  meaning: MEANING_ROUTING_PACK,
};
