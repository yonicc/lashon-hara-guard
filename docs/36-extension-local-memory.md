# 36 — חיבור הזיכרון המקומי לתוסף

2026-10-28, גרסה 0.10.0. המשך ל־docs/35. אין שינוי בחוזה `/check`, ב־proxy או ב־gate.

## מה חובר

- `compose-watch.js` מזין כל שינוי בשדות שהמתאמים מאבחנים, גם טקסט קצר וטיוטה שלא נשלחה.
  snapshots מאוחדים במשך 150ms ומועברים גם ב־focusout/pagehide, עם scope שנלכד לפני ההמתנה.
  בכל שדה נשמרת הטיוטה האחרונה, לא יומן הקשות. ריקון מוחק אותה ואינו ראיה לשליחה.
- `incoming.js` מזין קונטקסט מהשורות שנמצאו במסך, כולל baseline שלא נשלח לבדיקה מרוחקת.
  `context-runtime.prepare` מזין גם קונטקסט שנאסף לבדיקה ידנית.
  המקור נשאר `context`; אין המצאת אישור שליחה, עובדה מאומתת או זיהוי אדם בין אתרים.
- `memory-background.js` מאמת extension id, כתובת frame, אתר ומתגים, ומקים owner יחיד
  ב־`memory-offscreen.html`. אין שמירה במצב incognito. אין תלות בהצלחת `/check`.
- `memory.mjs` הוא מימוש האחסון הקנוני גם עבור מעבדת המחקר: IndexedDB ב־extension origin,
  טקסט והווקטורים באותה רשומה, חלוקה למקטעי 1,000 תווים והחלפה/מחיקה אטומית של המקור כולו.
  עד 100,000 תווים למקור, 20,000 מקורות או 5 מיליון תווים כוללים; פינוי מהישן.
  כל ה־embeddings מחושבים לפני החלפה, כך שכשל משאיר את הגרסה הישנה בשלמותה.
- `LHG_MEMORY.tools(platform,element)` מספק רק `get_recent({k})` ו־`search_history({query,top_k})`.
  ה־scope נקשר ביישום לפני הפעלת כלי; המודל לא בוחר חשבון/שיחה. עד 5 recent או 3 תוצאות חיפוש,
  300 תווים לתוצאה. `candidate/dom_observed` בלבד. המודל המנתב עצמו טרם אומן או חובר.
  התוצאות אינן מתווספות אוטומטית לבקשת הבדיקה המרוחקת.

## זיהוי וגבולות אמיתיים

Gmail/Chat: מזהה החשבון נאסף מאזור חשבון Google מפורש עם כתובת יחידה;
מזהה שיחה מ־data-thread-id/data-space-id/data-group-id.
WhatsApp: מזהה עצמי מ־last-wid/last-wid-md וזהות שיחה מתוך ה־JID ב־data-id של הודעה.
כל locators ה־DOM נמצאים ב־selectors.js. שם/כותרת אינם fallback.

אלה מתאמים שנבדקו ב־fixtures סינתטיים; אין כאן טענה שנבדקו מול כל גרסאות
ה־DOM של חשבונות מחוברים אמיתיים. אם אין מזהה עצמי, כולל iframe של Chat שלא
מציג זהות חשבון, הזיכרון לא ישמור בו. הבדיקה הרגילה ממשיכה.
טיוטה חדשה בלי thread מקבלת scope ייחודי לשדה ולסשן; אין קישור אוטומטי
לשיחה שהופיעה לאחר שליחה. שינוי תחום בשדה מפנה את רשומת הטיוטה הקודמת.
היעלמות DOM עקב virtualization אינה מחיקה. סנכרון מחיקה מפורשת באתר טרם מומש;
יש מחיקת כל הזיכרון והסרה בתפוגה, ואין לטעון שסנכרון מחיקות כבר עובד.

14 יום מהתצפית הראשונה; קריאות מסננות תפוגה, ניקוי בעת פתיחה ומדי דקה כל עוד ה־owner פועל.
אין הצפנת דיסק עצמאית. כיבוי עוצר פעולות חדשות ואינו מוחק את הקיים או מבטל פעולה שכבר החלה.
הפרטים והגבולות עודכנו גם ב־PRIVACY.md.

## הפעלה

1. לטעון מחדש את התוסף ב־chrome://extensions ולרענן את האתר הנתמך.
2. בהגדרות: להתקין מודל חיפוש מקומי ולהפעיל זיכרון קונטקסט מקומי.
3. אם הרשת חוסמת הורדות, לבחור בהגדרות תיקייה מקומית המכילה
   config.json, tokenizer.json, tokenizer_config.json ו־onnx/model_quantized.onnx.
   ב־BI-1 הקבצים שנבדקו נמצאים ב־
   `C:\Users\dev\lhg-worktrees\rnd-ctx\research\vector-poc\node_modules\@xenova\transformers\.cache\Xenova\multilingual-e5-small`.
   אין להעביר תיקיית פרופיל דפדפן או הודעות לתיקייה זו.
4. מחיקת זיכרון מקומי מוחקת טקסט ווקטורים; קובצי המודל נשארים במטמון.

JS/WASM כלולים בחבילה; רק נתוני המודל יורדים מ־Hugging Face בלחיצה מפורשת.
המודל נעול ל־revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`;
כל אחד מארבעת הקבצים נבדק ב־SHA-256 גם בהורדה וגם בייבוא.
אין fallback לשרת embeddings או הורדת קוד מרוחק.
הורדה אמיתית בדפדפן BI-1 קיבלה 403 עם `blocked by YSHO filter`;
לא שונו מסננים/שירותים. ייבוא תיקייה מקומית דרך מסך ההגדרות נבדק בהצלחה.

## מה נבדק בפועל

- 118 בדיקות Node של התוסף, כולל זהויות Gmail/Chat/WhatsApp, unknown,
  ביטול טיוטה, snapshots במעבר שיחה, coalescing ומניעת בחירת scope על ידי מודל.
- 17 בדיקות שילוב עם התוסף האמיתי ב־Chromium 141, פרופיל זמני,
  service worker, content script מבודד ו־offscreen אמיתיים:
  קליטת הקלדה ללא שליחה; קונטקסט מייל baseline; חיפוש סמנטי בעברית עם e5/WASM;
  החלפת/ריקון טיוטה; הפרדת חשבונות; הגבלת sender; כיבוי;
  restart של offscreen ושל תהליך הדפדפן; chunking ומחיקה; דחיית מודל עם hash שגוי.
  תוכן Gmail הוא fixture סינתטי, לא חשבון אמיתי.
- מסלול הורדה נבדק עם redirect של כתובות המודל לשרת loopback שמגיש את הקבצים המקוריים.
  אין להסיק ממנו שהורדה חיצונית מותרת ברשת המסוננת.
- 26 בדיקות המעבדה המקורית רצו שוב על אותו מימוש אחסון קנוני ב־Chrome 155:
  על 2,000 רשומות fixture שאילתה מלאה p50=57.7ms, p95=64.3ms;
  0 בקשות חיצוניות. זו ריצת רגרסיה, לא הוכחת איכות או SLA.
- engine: typecheck ו־274 בדיקות עברו, בדיקה חיה אחת דולגה; proxy: typecheck ו־63 עברו.
- חבילת ההתקנה נדרשת כעת לכלול קובצי mjs ו־vendor/wasm.
  מחולל ה־ZIP ב־TZ והמתקין בלינוקס עודכנו לתיקיות מקוננות; יש regression אריזה סינתטי.

שחזור: `cd research/local-memory; npm ci; npx playwright install chromium`.
להגדיר `LHG_TRANSFORMERS_DIR` לתיקיית @xenova/transformers עם cache קיים;
להריץ `node extension-test.mjs`. לבדיקת בחירת התיקייה במסך ההגדרות:
`LHG_IMPORT_MODEL=1` (ב־PowerShell להגדיר env בתוך קובץ ps1).
`extension-results.json` מכיל את הריצה האחרונה.

## מקורות

- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen):
  lifecycle, runtime messaging, הרשאות ו־getContexts.
- [Transformers.js 2.17.2 custom usage](https://huggingface.co/docs/transformers.js/v2.17.2/en/custom_usage).
- [מודל e5 הנעול לגרסה](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78).
