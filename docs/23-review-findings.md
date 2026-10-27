# 23 — מעקב ממצאי ביקורת הרחבת הכללים

מסמך עבודה לביקורת, 2026-10-27. ממצא נסגר רק לאחר מימוש ובדיקה מול השינויים המשולבים; baseline אינו ראיה לסגירת ממצא חדש.

| # | ממצא | בעלות | ראיה נדרשת לסגירה |
|---|---|---|---|
| 1 | חריג unknown/disputed טופל כהיעדר חריג | integration | unknownExceptions: true/false/unknown/disputed/candidate, בירור חריג חסר |
| 2 | שער רכילות תלוי בגנות | rules | שער דיווח עצמאי + מקרה ללא גנות |
| 3 | כיסוי לפי ספירה בלבד | cards/rules/integration | מיפוי 177 סעיפים לכללים/סיבת אי־מימוש, Rule→card→manifest→source hash ומקרי־נגד |
| 4 | תיעוד אינו משקף live_draft | cards/facts/rules/integration | docs/17,18,19,21 והערות קוד תואמים למימוש |
| 5 | רכילות ללא גנות/כוונת שנאה ובאמת | rules | בדיקת גנות=false, כוונה=false, אמת=true לפי ב׳ א׳:ב׳–ד׳ |
| 6 | חמישה תנאי אזהרה עתידית ומגבלות ה׳–ו׳ | rules/facts | מסלול ב׳ ט׳ עצמאי, כוונה וצפי תועלת נפרדים |
| 7 | מסגרת תועלת דורשת firstHand AND verified; חסר פרט ב׳ | rules/facts | OR, בדיקות שני הענפים; checked_halachic_classification נשאל ולא מוסק |
| 8 | חריג תוכחה מבוסס על knows_will_not_accept בלבד | rules | י׳:ז׳–ח׳ תחום מדויק, מבחני true/false/unknown לכל חריג |
| 9 | hash אינו מחושב מחדש מהמקור | cards | שינוי טקסט מקור ללא שינוי manifest נכשל בבדיקת hash |
| 10 | יותר משאלת בירור אחת בתצוגה | integration/facts | שאלת קטלוג מקבלת עדיפות; תקציב analysis=1; רגרסיות proxy ופאנל מול תשובת שרת ישן |
| 11 | עובדות חילוץ ללא טיפוס/סף; עקיפת אישור משתמש | facts | ולידציה בשני המסלולים, confidence=0/נמוך, טיפוס שגוי ורגישות |
| 12 | baseline לא מכסה פערים | integration | engine/proxy typecheck+test ו-extension tests על SHA משולב, לצד בדיקות ייעודיות |

## מצב ביניים

- ממצא 1: התיקון קיים ב־integration; 3 בדיקות ממוקדות עברו, כולל disputed. נדרש מבחן שילוב בחבילות הסופיות.
- ממצא 10: proxy ופאנל תוקנו; 6 בדיקות panel עברו ו־proxy typecheck עבר. בדיקת proxy עם שאלת קטלוג ושלוש שאלות ניתוח עברה. שינוי תקציב validateAnalysis נמצא בבעלות facts.
- שתי בדיקות התוכחה תוקנו: התרחיש החיובי מאשר במפורש מטרה לתועלת והיעדר ידיעה שלא יקבל תוכחה. נוספה רגרסיה דרך handler שבה חריג null אינו מפיק ממצא ואינו נשאל שוב. לאחר שילוב commit העובדות `703f8c3`: כל 42 בדיקות proxy ו־typecheck עברו. זו תוצאת ביניים לפני חבילות הכללים החדשות, לא ראיה לסגירת הביקורת.
- שולב `2d2b919` מענף העובדות כ־`703f8c3`; תשע בדיקות האוצר ושלוש בדיקות החריגים ו־engine typecheck עברו. טיפוסים/סף confidence ותקציב validateAnalysis עדיין דורשים השלמה; אין לסמן את ממצאים 10–11 כסגורים.
- טרם הושלמו האינטגרציה, ה־push והפריסה. מסמך זה אינו אישור סקירה הלכתית.

## שילוב recovery — ראיות מפורשות 1–12

מצב לפני snapshot הכיסוי הסופי: 113 תזכורות בשמונה חבילות, 79 עובדות קנוניות, קטלוג 84. זו אינה טענה למימוש סמנטי מלא של 177 סעיפים. כל פלט נשאר live_draft; אין פסק ואין הורדת אזהרה.

| # | מצב מימוש וראיה |
|---|---|
| 1 | תוקן: evaluate בודק חריג unknown/disputed/candidate כלא מוכרע, חוסם finding ומתכנן בירור. unknownExceptions + ccCompletePack + rebukePublicity עוברים. |
| 2 | תוקן: RECHILUT עצמאי מ־SPEECH. ccCompletePack ו־proxy completeRules בודקים דיווח אמת עם גנות=false. |
| 3 | ממתין לשילוב בן המיפוי: נדרש נימוק מקור ייחודי בכל177, הבחנה documentary/partial_semantic/executable, ללא טענת מימוש מלא מספירה. |
| 4 | תוקן docs17/18/19/21 + AGENTS: CC_ALL,113 תזכורות,79/84 עובדות; תמונות21 מסומנות היסטוריות. |
| 5 | תוקן: אמת=true, גנות=false, intent=false מגיעים דרך handler לשלושת כללי הרכילות. המבקר אימת גם validate→store→evaluate, ללא עקיפה. |
| 6 | תוקן כמסלול בירור מוגבל: examined_matter_as_harmful, future_benefit_expected ו־disclosure_causes_actual_harm מופרדים מאימות אמת/כוונה/no_excess_harm. ccSafetyBoundaries+handler עוברים. פרטי קניין, בית דין וה׳–ו׳ מחייבים מומחה; המערכת מפנה לבירור ואינה מכריעה בהם. |
| 7 | תוקן: firsthand OR verified; בדיקת סיווג user-only נפרדת. ccCompletePack בודק שני הענפים וחסר/מחלוקת. |
| 8 | תוקן התנהגותית עם הבחנות מקור: פחד user-only מדכא אזהרת פרסום ומפנה למומחה (ח׳ מסויג); ט׳ דורש ארבע עובדות מוניטין ציבורי נפרדות+knows. שאר התנאים אינם מתבטלים. rebukePublicity ו־handler עוברים, לרבות true/false/unknown/candidate/disputed. חסם: הכרעת ההקלה מחמת פחד דורשת מומחה ואינה קלט היתר אוטומטי. |
| 9 | תוקן ב626a225: CC02 מחשב SHA256 אמיתי מכל טקסט סעיף prefix16, CC07 mutation בלי שינוי manifest. המבקר אימת עצמאית177 hashes/19 כללים ו־byte-content תואם; רגרסיה על השילוב עברה. |
| 10 | תוקן: תקציב validation=1, עדיפות לשאלת קטלוג בhandler, guard בתוסף לתשובת שרת ישן. proxy completeRules/rules ו־panel עוברים. |
| 11 | תוקן ב626a225 ובשילוב: factPolicy משותף דוחה טיפוס/סף/טווח, meaning ללא clamp, guard נוסף בstore ו־user-only. המבקר אימת12 רגרסיות+44 מקרי קצה עצמאיים בשני שדות confidence; רגרסיה בסוויטה המשולבת עוברת. |
| 12 | ביניים: engine typecheck נקי,136 בדיקות (135pass,1live skip),proxy typecheck+48/48,extension78/78. נדרש הרצה על SHA סופי לאחר המיפוי, ביקורת עצמאית וראיות push/deploy. |

נוסף: כפל כלל הסוד תוקן לכלל קנוני אחד שמכבד disclosure_authorized. המבקר אימת8 probes דרך validate→store→CC_ALL: user true ללא ממצא סוד, false עם ממצא יחיד, missing/null/candidate/disputed ללא ממצא, והצעות מודל ל־user-only נדחות.16 probes של הפרסום ו־25 בדיקות קודמות אימתו את הסרת ה־FP לפני השלמת העובדות; אחרי ההשלמה נוספו5 בדיקות source-specific ובדיקת handler. הן אינן אישור הלכתי.

אוצר העובדות: drift=2 הקודם היה קטלוג+מפה עקב שתי הבחנות ב׳ט׳; נימוקי ההבחנות ב־docs19 ובמפה. חמש הבחנות הפרסום נוספו בנימוקים פרטניים; אחרי generation המפה והקטלוג תקינים, facts=79 map=368 drift=0. hash המקורות נבדק בנפרד מהכיסוי הסמנטי.
