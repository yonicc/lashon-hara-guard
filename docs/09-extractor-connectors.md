# Extractor ושכבת חיבורים (מימוש 2026-10-26)

מעמד: מימוש ליבה + מתאמי שלד עם fixtures סינתטיים. אין כאן פסק, אין כלל approved,
ואין scraping חי של אתר בשלב זה. ראו גם [08-architecture-final](08-architecture-final.md).

## מה נבנה

```text
engine/src/extractor/
  normalize.ts   נרמול עברי (ניקוד, מקף U+05BE, גרשיים, רווחים) — בלי פרשנות
  localGate.ts   סינון מקומי זול: מילות גנאי, גוף שלישי, אירוניה, רמז, הקשר שיעור
                 (triage בלבד — מעבר/אי־מעבר שלו אינם הוכחה לשום תוצאה)
  types.ts       ExtractorProvider מופשט (provider-agnostic), ProposedFact, RawExtraction
  validate.ts    ולידציית פלט מול FACT_CATALOG: רק מזהי קטלוג, בלי confirmedByUserOnly,
                 evidenceExcerpt חייב להיות קטע מילולי מההודעה, confidence חוקי
  providers.ts   MockExtractorProvider (דטרמיניסטי, לבדיקות/הדגמה) ו־HttpExtractorProvider (שלד)
  index.ts       runExtraction: נרמול -> שער מקומי -> ספק -> ולידציה -> buildMeaningFacts
  pipeline.ts    extractToFactStore: הזנה ל־FactStore דרך propose (רגיש נשאר candidate)

engine/src/connectors/
  types.ts       SourceAdapter: platformId, capabilities, normalize -> NormalizedMessage
  registry.ts    AdapterRegistry: הוספת פלטפורמה = מודול + רישום אחד
  adapters.ts    whatsapp-web, google (chat+mail), facebook-messenger, android
  fixtures.ts    אירועים גולמיים סינתטיים מייצגים לכל פלטפורמה
```

פלט החילוץ הוא **עובדות מוצעות בלבד** עם provenance=`model_extraction`, ראיה ו־confidence.
המחלץ לא פוסק, לא קובע עובדות `confirmedByUserOnly` (למשל קשר משפחתי), ולא ממציא מקורות.
הערכת המשמעות (`mayBeUnderstoodAsDisparagement`, mechanism, evidenceExcerpt, confidence,
identifiable) עוברת דרך `buildMeaningFacts` הקיים בשכבת המשמעות (U-06).

גבולות: כשל ספק/רשת מחזיר `not_checked` מפורש — לעולם לא "נקי". הודעת "מגיע ב־8"
אינה מפעילה קריאת ספק כברירת מחדל. תוכן וקשרים נשארים מקומיים; לענן (כשיהיה) יישלח
רק מה שעבר את הסינון המקומי, לפי מדיניות שתאושר.

## איך כותבים מתאם חדש

1. צרו מודול שמממש `SourceAdapter` מ־`engine/src/connectors/types.ts`:
   `platformId` ייחודי, `capabilities` כנים (מה שהפלטפורמה באמת מספקת), ו־`normalize(raw)`
   שמחזיר `NormalizedMessage` (שדות `MessageEnvelope` + `channelKind` + `participantIds`).
2. ערך לא ידוע נשאר `undefined` — לעולם לא `false` מנוחש (ראו `forwarded` ב־Messenger/Android).
3. למייל: מלאו `audienceSnapshot.to/cc/bccCount` ו־`subject`. לקבוצה: `participantRefs`.
4. הוסיפו fixtures סינתטיים ב־`fixtures.ts` (בלי שמות/תוכן אמיתיים) ובדיקת נרמול.
5. רשמו ב־registry: `createRegistry([...ALL_ADAPTERS, MyAdapter])`. אין לגעת בליבה.

## יכולות לפי פלטפורמה (שלד נוכחי)

| פלטפורמה | observeCompose | observeIncoming | canHoldSend | participants | forwarded | הערות |
|---|---|---|---|---|---|---|
| whatsapp-web | ✓ | ✓ | ✗ | ✓ | ✓ | יירוט שליחה אמין טרם הוכח באתר חי (E1 ב־08) |
| google (chat+mail) | ✓ | ✓ | ✗ | ✓ | ✓ | מייל: To/CC/BCC + נושא במודל ההודעה |
| facebook-messenger | ✓ | ✓ | ✗ | ✓ | ✗ (לא ידוע) | דגל מועבר אינו נחשף באופן אמין |
| android | ✗ | ✓ | ✗ | חלקי | ✗ (לא ידוע) | התראות/נגישות: בלי עצירת שליחה, משתתפים חלקיים, מגבלות מערכת הפעלה ומדיניות חנות |

## מה פתוח לחיבור חי (שאלות פתוחות)

> עדכון 2026-10-26: נבחר backend לפרוטוטייפ — צ׳אט ייעודי דרך
> `POST /api/chat/send` של ה־Brain (`agent_kind:'muse'`). ראו
> [10-brain-send-backend](10-brain-send-backend.md) לחוזה המלא, ההכרעה
> (v1 אינו תומך ב־muse — מאומת מהקוד), והמגבלות. המימוש:
> `engine/src/extractor/brainSend.ts` + `engine/test/brainSend.test.ts`.

- הוכחת היתכנות DOM אמיתי לכל אתר (כולל מניעת הבזק תוכן להודעות נכנסות, E2/IN-01).
- בחירת ספק AI ומודל בפועל (החלטה פתוחה ב־06) ומדיניות שליחה לענן/אישור משתמש.
- מדידות p50/p95, שיעור `not_checked` ושיעור התראות שווא על סט מתויג (ספים טרם נקבעו).
- Android: בחירה בין NotificationListener לנגישות, ומגבלות הרשאות/מדיניות עדכניות.
- מקורות הלכתיים/משפטיים לשכבת המשמעות (אבק לשון הרע וכד') — עבודת צ'אט אחר, לא כאן.
