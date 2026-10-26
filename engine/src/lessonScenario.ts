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
