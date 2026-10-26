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
    questionHe: 'האם הדברים עלולים להתפרש כהעלבה או כגנות כלפי אדם, גם בלי מילת גנאי מפורשת?',
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
    questionHe: 'מה מטרת ההודעה? (למשל: אזהרה, בירור, שיתוף, אחר)',
    priority: 40,
    sensitivity: 'low',
    persistent: false,
  },
  {
    id: 'subject.identifiable',
    questionHe: 'האם אפשר לזהות מההודעה במי מדובר?',
    priority: 50,
    sensitivity: 'medium',
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
