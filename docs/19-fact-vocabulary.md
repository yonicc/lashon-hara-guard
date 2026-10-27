# 19 — אוצר העובדות המאוחד (חפץ חיים)

## מספרים
- הוצעו בכרטיסים: 357 מזהים שונים (`proposedNewFacts`).
- מיזוגים במפה: 53 הצעות.
- סימון `new` במפה: 189 הצעות; הסימון מתאר החלטת איחוד ולא ספירת עובדות.
- נדחו: 115 הצעות, עם סיבה במפה.
- סך הכול ב־`facts.json`: 72 עובדות; 61 המזהים הקיימים נשמרו ונוספו 11 הבחנות.

כל ההכרעות ב־`rules/chafetz-chaim/fact-merge-map.json`: `{action: merge|new|reject, target?, reason}`.

השלמת ממצא 11: `extractor/factPolicy.ts` הוא מקור מדיניות הקבלה של `validateExtraction` וגם `factStoreFromExtraction`. סף מפורש 0.6 (כולל); אפס, נמוך, חסר, לא־סופי ומחוץ ל־0..1 נדחים. `valueType` בקטלוג מגדיר string/number; ברירת המחדל boolean. אין המרות מטיפוס לטיפוס. גם מסלול meaning אינו עוקף את הסף או אישור המשתמש. עובדות user-only נדחות מקליטה אוטומטית, ולא נשמרות כידועות. `ANALYSIS_LIMITS.questions=1`.

ארבע הבחנות נוספות אומתו בקריאה ישירה ב־`text/p1_prin9.txt` ו־`text/p2_prin8.txt`: `message.praise_is_excessive` (א ט:א–ב), `audience.includes_subject_enemies` (א ט:א), `subject.is_established_righteous` (א ט:ב), `message.disclosure_authorized` (א ט:ו; ב ח:ה לחובת הסוד). שלוש האחרונות דורשות אישור משתמש; הרשות מתייחסת למידע המסוים ואינה היתר לספר לשון הרע. כולן draft.
הרצה חוזרת: `python -I rules/chafetz-chaim/consolidate_facts.py` (אידמפוטנטי, שומר מפה קיימת).

## העובדות החדשות לפי נושא
- **הודעה:** `message.medium_is_written`, `message.is_praise`, `message.was_told_in_confidence`, `message.has_favorable_interpretation`, `message.about_past_or_family`, `message.about_character_traits`, `message.denies_virtue_or_status`, `message.said_incidentally_without_intent`
- **מדובר:** `subject.is_public_torah_figure`, `subject.is_established_wicked`, `subject.has_repented_or_reformed`, `subject.repeated_intentional_sin`
- **עניין:** `matter.is_between_man_and_god`, `matter.involves_money_dispute`
- **קהל/שומע:** `audience.can_help_or_influence`, `audience.is_close_to_speaker_or_subject`, `audience.includes_authorities_or_non_fellow`, `listener.already_knew`, `listener.will_act_harmfully`, `listener.can_leave_or_mute`, `listener.shows_agreement`, `listener.judges_favorably`
- **ראיות:** `evidence.has_recognizable_signs`, `evidence.multiple_firsthand_witnesses`
- **כותב/הקשר:** `speaker.was_pressured_to_tell`, `speaker.is_minor`, `speaker.motive_is_revenge_or_hatred`, `context.inquiry_has_future_purpose`, `context.threat_of_planned_harm`

עובדות רגישות (`subject.*` חדשות, `audience.is_close_to_speaker_or_subject`, `speaker.is_minor`) סומנו `persistent` + `confirmedByUserOnly`. גם `subject.is_fellow`, `toelet.no_excess_harm`, `speaker.checked_halachic_classification` ו־`speaker.is_sinner_like_subject` דורשות אישור משתמש מפורש; אין לקבוע מעמד הלכתי או משפטי מתוך טענת המודל. התשובה היא מידע שהמשתמש אישר, לא פסק.

## השלמות כלל י׳ — קריאה ישירה במקורות
המראים הם מפתחות הסעיפים ב־`sources/chafetz-chaim/manifest.json`; הטקסט ב־`text/p1_prin10.txt`. כולם אוצר טיוטה.

| מזהה | סעיפים | ההבחנה שנשמרת |
|---|---|---|
| `speaker.checked_halachic_classification` | 10:2, פרט ב׳ | האם התקיימה בדיקת סיווג; אינו אומר מה הסיווג, ואינו מאמת את הסיפור |
| `speaker.is_sinner_like_subject` | 10:3 | אישור המשתמש להתנהגות דומה של הכותב, ללא הכרזה שהכותב חוטא |
| `toelet.future_benefit_expected` | 10:4,6,13 | צפי תועלת בפועל נפרד מכוונה מועילה |
| `audience.can_help_victim` | 10:1,13 | יכולת לעזור לנפגע, נפרדת מהעובדה הרחבה `audience.can_help_or_influence` |
| `audience.can_influence_subject` | 10:4,13 | יכולת להשפיע על המדובר, ללא הנחה שיכולת לעזור לנפגע מוכיחה אותה |
| `matter.known_to_victim` | 10:5,6 | האם הנפגע כבר יודע על הדברים |
| `context.asked_to_identify_sinner` | 10:17 | האם נשאלה שאלה על זהות העושה; אינו קובע שנעשתה עבירה |

אין מזהה חדש ל־`toelet.subject_has_not_repent`: ההפך מ־`subject.has_repented_or_reformed` מתועד במפה עם `negate:true`. כלי הגירה חייב לכבד את ההיפוך רק לערך בוליאני ידוע; אין להפוך unknown/disputed ל־false. המפה אינה מסלול לקבלת מזהים חלופיים ב־`/check`.

## דחיות שנותרו
שאלות־על מצטברות, כוונות/הכרעות פנימיות שאין לברר בצ'אט, פרטי בית דין/קניינים/אונאה, וענייני תשובה לאחר מעשה. הדחויות נשארות מתועדות בכרטיסים ב־`proposedNewFacts`.

## חיבור למנוע — מקור יחיד
`facts.json` הוא המקור לשאלות ולכל נתוני הבטיחות והעדיפות של האוצר. `consolidate_facts.py` מייצר ממנו את האזור המסומן ב־`engine/src/lessonScenario.ts`; חמש עובדות תרחיש השיעור נשארות מחוץ לאזור. כל 66 מזהי הקטלוג המקורי נשמרו; כעת יש 77. אין לערוך את האזור המיוצר ידנית.

```powershell
python -I rules\chafetz-chaim\consolidate_facts.py
python -I rules\chafetz-chaim\consolidate_facts.py --check
cd engine
npm run typecheck
node --import tsx --test test/factVocabulary.test.ts
```

ההרצה אידמפוטנטית; `--check` אינו כותב ונכשל על סטייה. קובץ מפה לא תקין נכשל במקום להידרס. הסקריפט אינו משנה כרטיסים ואינו מוסיף עובדות מתוך ניחוש של מזהי המודל.

המחלץ מקבל את השאלות הקנוניות מהקטלוג, ומחריג עובדות `confirmedByUserOnly`; הוולידציה אוכפת זאת שוב. `liveFacts.ts` שומר `disputed` גם לאחר חזרה של המודל על אחת הגרסאות. תשובת `null` נשארת unknown; רק תשובת משתמש מפורשת פותרת מחלוקת. מזהים מחוץ לקטלוג ותשובות שאינן boolean/null נזרקים.

הערת בדיקות ב־Windows: worktree עשוי לקבל מקורות CRLF בגלל Git. קורא סעיפים שמפצל רק לפי LF ומשתמש ב־`^... (.*)$` בלי להסיר CR אינו מוצא אף אחד מ־177 הסעיפים. יש לתקן את הקורא, לא לנרמל מחדש את קובצי המקור או לשנות את הציטוטים.
