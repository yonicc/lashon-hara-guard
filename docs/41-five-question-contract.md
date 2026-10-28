# 41 — חוזה חמש שאלות (1 → עד 5 שאלות בירור לכל בדיקה)

Date: 2026-10-29 · Status: implemented (branch `research/five-question-contract`) · Synthetic data only.

## רקע והחלטה

החוזה החי של `POST /check` (docs/18) הגביל את התצוגה ל־**שאלת בירור אחת** בלבד
(`rules.question?: {factId, textHe, answers:[כן/לא/לא יודע]}`). הבעלים הורה (2026-10-29,
מתועד ב־docs/40 §A) להעלות את המכסה ל־**עד 5 שאלות** לכל בדיקה. docs/40 סימן זאת כשינוי
חוזה שבור־תאימות הדורש אישור בעלים לפני נגיעה בריצה — אישור זה ניתן, ומסמך זה מתעד את המימוש.

גבולות שלא השתנו (כללי ברזל):

* **מנוע הכללים הדטרמיניסטי הוא היחיד שפוסק**; הנתב (`router`)/המודל לעולם לא מכריע הלכה.
* הפורמט נשאר **כן / לא / לא יודע** (`true` / `false` / `null`); «לא יודע» = `null` = unknown, אף פעם לא false.
* שאלה מגיעה רק מ־`FACT_CATALOG` (מקור יחיד ב־`rules/chafetz-chaim/facts.json`); לא מומצאות שאלות חדשות.
* אין פסק ואין «מותר». כלל רק מעלה ל־`warn` או שואל; לעולם לא מוריד ל־`none`.
* שאלה שכבר נענתה (גם «לא יודע») לא נשאלת שוב.

## מה השתנה

### 1. docs/18 — החוזה

* סעיף «חוזה ה־API»: הוסף `questions?: [...]` (עד 5), ו־`question?` סומן כשיקוף תאימות
  לאחור של `questions[0]` בלבד. עודכנה מכסת התצוגה: כשיש לפחות שאלת קטלוג אחת, שאלות
  `analysis.questionsHe` החופשיות מושהות; רק בלעדי שאלת קטלוג נשמרת לכל היותר שאלת analysis אחת.
* עודכנו שתי אזכורי «שאלה אחת» (שורת proxy, הערת י:ז) ל־«עד 5 שאלות».

### 2. proxy/src/rules.ts — הארביטרציה

* נוסף `MAX_QUESTIONS = 5` (מיוצא).
* `RulesResult` קיבל `questions?: RulesQuestion[]`; `question?` נשאר כשיקוף של `questions[0]`.
* `runLiveRules`: `maxQuestions: MAX_QUESTIONS + Object.keys(confirmed).length` (כדי למלא את
  מכסת התצוגה גם כשתשובות קודמות מדולגות), ואז `filter(unanswered).slice(0, 5)`. המנוע עצמו
  (`engine/src/questionPlanner.ts`) כבר דורג מועמדים; השינוי הוא רק בכמות המוגבלת downstream.

### 3. proxy/src/handler.ts — מכסת התצוגה

* תנאי דחיקת שאלות ה־analysis שונה מ־`rules?.question` ל־`rules?.questions?.length` —
  אותה סמנטיקה (קטלוג דורס שאלות חופשיות), מול המערך החדש.

### 4. router — research/local-router/getters.mjs

* נוסף `MAX_QUESTIONS = 5`. `propose_question` תורגם ממצב יחיד (`questionQueued`) לתור
  (`questionsQueued`): עד 5 עובדות קטלוג **נפרדות**; אותה עובדה לא נתורה פעמיים
  (`question-already-queued`); מעבר למכסה — `question-budget-used`. זהו מודול מחקר בלבד,
  לא נטען על ידי extension/Worker/gate//check; אכיפת המכסה החיה היא ב־proxy (סעיף 2).

### 5. הרחבה — extension/rules.js + panel.js

* `readRules` מנרמל כעת `questions[]` (עדיפות למערך; נפילה חזרה ל־`question` הישן; מכסה 5;
  שאלה ללא תשובות תקינות נזרקת). מחזיר גם `questions` וגם `question` (שיקוף `questions[0]`).
* `panel.js appendRules` מרנדר לולאה על כל השאלות — לכל אחת שורת שאלה משלה + שורת כפתורי
  כן/לא/לא יודע משלה, וכל תשובה שולחת `onAnswer(factId, value)` עם אותו `factId`.
* `detailLines` דורס שאלות חופשיות גם מול `rules.questions[]` (תאימות לשרת ישן וחדש).

## תאימות לאחור (כפולה)

* **שרת חדש → לקוח ישן:** השרת שולח גם `question` (שיקוף `questions[0]`); לקוח pre-0.10
  שמכיר רק את היחיד ממשיך לעבוד ללא שינוי.
* **שרת ישן → לקוח חדש:** `readRules` קורא גם את `questions[]` וגם את `question` הישן;
  שרת שמחזיר רק `question` מניב שאלה אחת בדיוק.

## בדיקות (הכל ירוק)

* proxy: `npm run typecheck` נקי; `npm test` 66/66 (3 חדשות: עד 5 שאלות+שיקוף, מכסה 5, דילוג על נענו).
* extension: `node --test extension/*.test.cjs` 129/129 (2 חדשות: readRules ריבוי+תאימות, panel מרנדר עד 5).
* engine: `npm test` 274/275 (1 מדולגת live); `npm run typecheck` נקי.
* router getters: `node --import tsx --test ../research/local-router/getters.test.mjs` 15/15 (2 חדשות על המכסה).
  הערת סביבה: `integration.test.mjs` נכשל מטעם סביבה בלבד (`@xenova/transformers` cache path), גם על main נקי — לא קשור לשינוי.

## מה נשאר / מחוץ לסקופ

* **docs/40 §B — הפניית רב מובנית (group D):** לא נגענו. דורש עיצוב נפרד מאושר (אילו עובדות
  נארזות, ניסוח, היכן מוצג) — `referral` הוא עבודה עתידית, אף פעם לא פסיקה אוטומטית.
* **הרחבת מאגר ה־router v2** מ־48 תבניות לאלפים (צנרת English→DictaLM→ביקורת עיוורת) וסבב
  extractor טבעי על 18 העובדות — רשומים ב־docs/40 «Next», תלויים באימות עצמאי לפני קידום לריצה.
* **פריסה:** לא בוצע `wrangler deploy`; זהו branch מחקר/מימוש בלבד. קידום לפרודקשן דורש החלטת
  בעלים נפרדת (והתאמת גרסת התוסף).
