# 18 — כללי התועלת כ־Rules שהמנוע מריץ (draft)

## מצב: live_draft — החלטת הבעלים מ־2026-10-27
הבעלים החליט שצריך מוצר חי עכשיו: כללי חבילת `CC_TOELET_DRAFT_PACK` פועלים בזרימה החיה
של `POST /check` כאילו אדם אישר אותם. סקירה אנושית תגיע בסבב שיפורים אחר כך.
- מנוע: `evaluate(..., ruleMode: 'live_draft')` — כלל `halacha_draft` במצב `draft` מפיק
  `finding` עם `draft: true` ו־`source`. ברירת המחדל `approved_only` לא השתנתה (TOELET-05/07/09).
- עובדות: `engine/src/liveFacts.ts` `factStoreFromExtraction` — הבית היחיד שממיר
  `proposedFacts` + `meaning` + תשובות המשתמש ל־FactStore (גם `extractToFactStore` משתמש בו).
- proxy: `proxy/src/rules.ts` מריץ את החבילה (שאלה אחת לכל היותר). רמת האזהרה נקבעת רק
  ב־`alertFor` שב־`handler.ts`. מתג: `LHG_CC_RULES` = `live` (ברירת מחדל) / `off`.
- בל יעבור: אין פסק ואין «מותר». כלל רק מעלה ל־`warn` או שואל, ולעולם לא מוריד ל־`none`.
  עובדה חסרה = לא ידוע, לא false (תשובת «לא יודע» = `null` = unknown). הצהרה על תועלת לבדה
  לא מתירה (LIVE-05). כשל במנוע = `rules.notChecked=true`, והאזהרה לא משתנה.

### חוזה ה־API (קבוע — התוסף נבנה לפיו; שינוי רק באישור הבעלים)
- בקשה: `confirmedFacts?: Record<factId, boolean|null>` — רק ids מ־`FACT_CATALOG`, עד 20,
  כל ערך אחר נזרק בשקט.
- תשובה: `rules?: { mode:'live_draft', notChecked?, findings: [{ruleId, code, messageHe, sourceRef, sourceUrl}],
  question?: { factId, textHe, answers:[{value:true,'כן'},{false,'לא'},{null,'לא יודע'}] } }`.
  `rules` חסר כש־`LHG_CC_RULES=off` או כשהמסווג המהיר דילג על המודל.
- כשיש finding, נוסף ל־`limitationsHe`: «לפי כללי טיוטה מספר חפץ חיים — לא נבדקו בידי מומחה; אינו פסק הלכה.»
- שאלה שהמשתמש כבר ענה עליה (גם «לא יודע») לא נשאלת שוב. לא נרשם ללוג טקסט של הודעות.
- בדיקות: `engine/test/liveDraft.test.ts` (LIVE-01..05), `proxy/test/rules.test.ts`.

הסעיפים שלהלן מתארים את מצב החבילה לפני ההחלטה.

## מה מומש
- `engine/src/chafetzChaim/toeletPack.ts` — חבילת `cc-toelet-draft` (גרסה 0.1.0):
  12 כללים מביצים, כולם `domain='halacha_draft'`, `reviewStatus='draft'`.
  מיוצאת גם מ־`engine/src/index.ts`.
- `engine/src/lessonScenario.ts` — הורחב `FACT_CATALOG` בכל 31 עובדות
  `rules/chafetz-chaim/facts.json` (היו חסרות 28; שלוש הקיימות —
  `subject.identifiable`, `message.may_be_understood_as_disparagement`,
  `message.purpose` — עודכנו לנוסח facts.json). ערכי `priority/sensitivity/persistent`
  הם בחירת מנוע מקומית; `confirmedByUserOnly` לא הוגדר לאף עובדת אוצר.
- `engine/test/toelet.test.ts` — 9 בדיקות TOELET-01..09.

## כלל הברזל (docs/03) וכיצד הוא נאכף
- אין כלל בצורה «מטרה מועילה → מותר». נוסח כל `outcome.messageHe` מתחיל
  «לפי חפץ חיים כלל י׳ ... יש לבדוק ש...» ומסתיים בהבהרה שזו טיוטה ולא פסק.
  בדיקה TOELET-02 אוסרת את המילים מותר/אסור (כמילה נפרדת) ו־permitted/forbidden
  בכל נוסחי החבילה.
- כל הכללים draft, ולכן `evaluate()` מפיק מהם `draftObservations` פנימיים בלבד —
  לעולם לא `findings` למשתמש (נבדק ב־TOELET-05/07/09).
- כל עוד אחד משבעת התנאים של סעיף ב׳ unknown, התוצאה היא שאלת בירור על התנאי
  החסר (TOELET-06, TOELET-08), לא אישור. תנאי שנכשל מחזיר draft שמסביר איזה
  תנאי חסר (TOELET-07, TOELET-09).

## שאלות הבירור — מקור יחיד
נוסחי השאלות חיים רק ב־`rules/chafetz-chaim/facts.json`. המנוע שולף אותן דרך
`FACT_CATALOG`, ובדיקה TOELET-04 נכשלת אם נוסח בקטלוג סוטה מהנוסח ב־facts.json.
לא שונו `facts.json` ולא `FACT_CATALOG` המקורי מעבר להרחבה שבוצעה בצ׳אט זה לפי
ההנחיה (המשתמש אישר שכל שאלה עוברת דרך FACT_CATALOG בלבד); מזהי `toelet.*`
והמזהים הקיימים לא שונו.

## מיפוי כלל ↔ סעיף (חפץ חיים חלק א׳, כלל י׳; URL מדויק מה־manifest, נבדק בבדיקה)
| כלל | סעיף | תפקיד |
|---|---|---|
| cc-toelet.10-01.wrongdoing-frame | א׳ (10:1) | מסגרת: סיפור עוולה מותנה בכל שבעת הפרטים יחד |
| cc-toelet.10-02a.first-hand-or-verified | ב׳ פרט א׳ (10:2) | ראה בעצמו, או שמע ונתברר לו שהדבר אמת |
| cc-toelet.10-02c.rebuke-first | ב׳ פרט ג׳ (10:2) | תוכחה בלשון רכה לפני פרסום |
| cc-toelet.10-02d.no-exaggeration | ב׳ פרט ד׳ (10:2) | שלא יגדיל העוולה |
| cc-toelet.10-02e.constructive-intent | ב׳ פרט ה׳ (10:2) | כוונה לתועלת, לא הנאה מהפגם/שנאה (ביאור: סעיף ד׳) |
| cc-toelet.10-02f.no-other-way | ב׳ פרט ו׳ (10:2) | אין עצה אחרת לאותה תועלת |
| cc-toelet.10-02g.no-excess-harm | ב׳ פרט ז׳ (10:2) | נזק לא יותר מכפי הדין |
| cc-toelet.10-04.no-benefit-from-spread | ד׳ (10:4) | אין צפי תועלת + שומעים שיפיצו |
| cc-toelet.10-11.revenge-or-grievance | י״א (10:11) | סיפור עוול אישי בכוונת גנאי ללא תועלת |
| cc-toelet.10-14.seven-conditions-reiterated | י״ד (10:14) | חזרה מצטברת על שבעת התנאים |
| cc-toelet.10-15.weigh-and-plan | ט״ו (10:15) | שקול ותכנון ניסוח לפני סיפור לתועלת |
| cc-toelet.10-17.identifying-when-asked | י״ז (10:17) | גילוי זהות כשנשאל — אותה מסגרת |

כללי כשל נפרדים לכל תנאי אינם כוללים את פרט ב׳ של סעיף ב׳ (התבוננות אם המעשה
הוא על פי דין גזל/היזק) — ראו «עובדות חסרות» למטה.

## בדיקות
`npx tsc --noEmit` נקי; `npm test` ב־engine: ‏83 בדיקות, 82 עוברות, 0 נכשלות,
1 מדולגת (live). כולל `ccCards.test.ts` ו־TOELET-01..09 החדשות.

## מה פתוח / עובדות חסרות (לא הומצאו בקוד; ממתין לאיחוד אוצר העובדות)
מ־`proposedNewFacts` בכרטיסי כלל י׳, הנדרשות להשלמת הכיסוי:
- `speaker.checked_halachic_classification` — פרט ב׳ של סעיף ב׳ (התבוננות אם המעשה
  על פי דין גזל או היזק). בלעדיה אין כלל־כשל לתנאי ב׳.
- `speaker.is_sinner_like_subject` — סעיף ג׳ (מפרסם חוטא כמוהו); לכן אין כלל לסעיף ג׳.
- `toelet.knows_subject_will_not_accept_rebuke` — חריג התוכחה בסעיף ז׳; לכן כלל
  התוכחה (10-02c) אינו מבטא את החריג, ומציין זאת בנוסחו.
- `toelet.future_benefit_expected`, `toelet.subject_has_not_repent`,
  `audience.can_help_victim`, `audience.can_influence_subject`,
  `matter.known_to_victim`, `context.asked_to_identify_sinner` ועוד כמפורט
  ב־factsNeeded/proposedNewFacts של הכרטיסים — ישלימו את סעיפים ד׳–י״ז.

## עוד פתוח
- סקירה אנושית של הכרטיסים והכללים (docs/03: איתור מקור → סקירת מומחה → אישור).
  הכללים נשארים `reviewStatus='draft'`, אבל מאז 2026-10-27 הם מחוברים למסלול המשתמש
  במצב live_draft (ראו למעלה).
- איכות חילוץ העובדות (precision/recall של `proposedFacts`) — צעד 2.
- הערות באר מים חיים / ציורים של כלל י׳ טרם נכנסו לשכבת המקור (docs/17).
