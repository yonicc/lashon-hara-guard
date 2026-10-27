# 19 — אוצר העובדות המאוחד (חפץ חיים)

## מספרים
- הוצעו בכרטיסים: 357 מזהים שונים (`proposedNewFacts`).
- מיזוגים במפה: 53 הצעות.
- סימון `new` במפה: 204 הכרעות (כולל מזהי ההבחנות שנוספו); הסימון מתאר החלטת איחוד ולא ספירת עובדות.
- נדחו: 115 הצעות, עם סיבה במפה.
- סך הכול ב־`facts.json`: 83 עובדות; 61 המזהים הקיימים נשמרו ונוספו 22 הבחנות.

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
`facts.json` הוא המקור לשאלות ולכל נתוני הבטיחות והעדיפות של האוצר. `consolidate_facts.py` מייצר ממנו את האזור המסומן ב־`engine/src/lessonScenario.ts`; חמש עובדות תרחיש השיעור נשארות מחוץ לאזור. כל 66 מזהי הקטלוג המקורי נשמרו; כעת יש 88. אין לערוך את האזור המיוצר ידנית.

## חריגי פרסום — א׳ י:ז–ט
## הבחנות לחץ וגנות עצמית — א׳ א:ה–ז,ט; ב׳ א:ה–ז
ארבע עובדות user-only נפרדות נוספו מן המקורות: `speaker.risks_livelihood_for_refusing_disclosure`, `speaker.fears_ridicule_for_refusing_disclosure`, `context.parent_or_rabbi_requested_disclosure`, `message.includes_same_self_disparagement`. לחץ כללי אינו מוכיח סיכון לפרנסה או לעג, וקרבה משפחתית אינה מוכיחה בקשת אב/רב. שבע תזכורות מקור נפרדות בודקות את ההקשר בלי להכריע היתר, דיני אבק, חובת מחאה או גמול. `pressureBoundaries.test.ts` מאמת כל טריגר ומצבי אי־ודאות ודחיית חילוץ אוטומטי. לאחר generation: `facts=83 map=372 drift=0` (88 בקטלוג).

### פרטי חריגי הפרסום
נוספו חמש הבחנות מקור, כולן user-only ולא נשמרות בין הודעות: `speaker.fears_retaliation_from_subject` (ח׳: פחד ממי שבידו להרע), וארבע עובדות מוחזק לרבים בסעיף ט׳: `speaker.publicly_known_impartial`, `speaker.publicly_known_says_in_presence`, `speaker.publicly_known_fearless`, `speaker.publicly_known_truthful`. נכונות אישית לומר בפניו, אמת ההודעה או גודל קהל אינם מוכיחים מעמד ציבורי. כל תכונת מוניטין נדרשת בנפרד.

חריג ידוע מדכא רק אזהרת פרסום ז׳; חסר/unknown/disputed/candidate חוסם אותה ומאפשר שאלה יחידה. ח׳ מפיק תזכורת בירור מומחה משום שהמקור מסויג באפשרות להקלה: אין הכרעה אוטומטית אם הפחד מצדיק אי־פרסום. ט׳ מאפשר ענף ציבור חלופי רק בצירוף ארבע העובדות וידיעה שלא יקבל תוכחה; כל יתר התנאים נשארים. `rebukePublicity.test.ts` בודק כל הבחנה, מצבי אי־ודאות, דחיית חילוץ אוטומטי, ושכל יתר התנאים עדיין נדרשים.

לאחר התוספות הורץ הגנרטור; drift=1 היה אזור הקטלוג בלבד (המפה עודכנה במפורש עם נימוק לכל תוספת), ואז `--check` מאמת drift=0. התקרה 79 נבדקת לצד 18 מראי מקום ספציפיים, מדיניות user-only ורגרסיות התנהגותיות.

שתי השלמות נדרשו מקריאה ישירה בחלק ב׳ ט:ב: `speaker.examined_matter_as_harmful` (פרט א׳: בדיקת מהות העניין, לא אימות אמיתותו) ו־`toelet.disclosure_causes_actual_harm` (פרט ה׳ והמשך ה׳–ו׳: רעה ממשית, בנפרד משלילת טובה ומנזק מעבר לדין). שתיהן user-only; אין להחליפן ב־`facts_verified` או ב־`no_excess_harm`. צפי תועלת משתמש בעובדה הקיימת `toelet.future_benefit_expected`, עם מראי מקום נוספים ט:ב,ד. המפה מתעדת את סיבת שתי התוספות, ובדיקות `ccSafetyBoundaries` מאמתות שאינן מתמזגות עם העובדות הישנות.

בהשלמה זו `consolidate_facts.py` דיווח תחילה `drift=2`: שני הקבצים הצפויים הם אזור הקטלוג והמפה. לאחר יצירתם `--check` החזיר `facts=74 map=363 drift=0`. העלאת תקרת בדיקת האוצר ל־74 מלווה באימות שאלות/מטא־נתונים זהים למקור, מראי מקום תקפים, אישור משתמש ותרחישי נגד; אינה ראיית כיסוי כשלעצמה. ציוני meaning אינם נחתכים לתחום: קלט מחוץ ל־0..1 נדחה לפני ההמרה ושוב בכניסה ל־store, כמו proposedFacts.

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
