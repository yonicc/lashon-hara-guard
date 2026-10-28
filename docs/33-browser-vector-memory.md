# 33 — Vector DB בתוך הדפדפן: זיכרון מקומי לשליפת קונטקסט (מחקר)

סטטוס: מחקר R&D, לא מומש בתוסף החי. אין שינוי בחוזה `/check` (docs/18), ב־proxy, ב־gate או ב־Worker.
כל המספרים המסומנים "נמדד" נמדדו ב־Node על BI-1 עם נתונים סינתטיים בלבד; "הערכה" = ספרות/תיעוד רשמי, לא מדידה.
השוואת המנועים והאחסון מבוססת גם על דוח מחקר מקביל (ראה סעיף מקורות); מדידות ה־POC במאגר הן העוגן.

## 1. נקודת המוצא במאגר (קיים, לא הצעה)

- `extension/context-store.js` — חנות מקומית `lhg-context` ב־IndexedDB (fallback לזיכרון): שיחות, משתתפים, הודעות (עד 1,000 תווים, 30 לשיחה), עובדות ויחסים. הודעות נמחקות אחרי 14 יום באתחול ה־runtime; שמות אמיתיים נשארים מקומית בלבד.
- `engine/src/contextPacket.ts` — `ContextPacket v1`: refs בדויים (`self/p1…`), עד 5 הודעות אחרונות × 300 תווים, `status` תלת־ערכי (`candidate/unknown` לעולם לא `false`).
- `PRIVACY.md` — ה־IndexedDB אינו מוצפן בידי LHG; `/check` שולח טקסט וקונטקסט לעיבוד מרוחק. כל שכבת וקטורים מחייבת עדכון מדיניות.
- שאלת המחקר: האם זיכרון וקטורי מקומי (שיחות/עובדות/אנשים) יכול לספק קונטקסט רלוונטי להודעה חדשה, כמו ש־brain-mcp עושה בצד השרת — בלי לשלוח היסטוריה החוצה.

## 2. אחסון: IndexedDB מול OPFS

| | IndexedDB | OPFS |
|---|---|---|
| זמינות | SW / content script / offscreen | worker/offscreen; לא ב־content script רגיל |
| מה שומרים | רשומות + `Float32Array` לידן | קבצי אינדקס / SQLite שלם |
| מחיקה | לפי רשומה (מתאים ל־14 הימים הקיימים) | מחיקת קובץ — פשוטה אך גסה |
| עלות מעבר | אפס — התשתית קיימת | גבוהה |

מסקנה: נשארים ב־IndexedDB הקיים. OPFS נדרש רק אם בעתיד בוחרים sqlite-vec עם persistence מלא.

## 3. מנועי חיפוש וקטורי — מדידת POC במאגר (`research/vector-poc/bench.mjs`)

סביבה: Node 24 על BI-1 (CPU, ONNX Runtime), `Xenova/multilingual-e5-small` quantized, dim=384, נתונים סינתטיים (תבניות עבריות, 8 נושאים × 40 אנשים בדויים), top-10, 30 שאילתות.

| מדידה | N=2,000 | N=20,000 |
|---|---:|---:|
| טעינת מודל (cache חם) | 860ms | 739ms |
| embedding למסמך (batch 32) | 5.50ms | 5.64ms |
| brute-force cosine p50 / p95 | 1.37 / 2.12ms | 16.2 / 19.7ms |
| Voy (build; query p50 / p95) | 203ms; 1.61 / 3.44ms | 2,216ms; 15.0 / 26.2ms |
| Voy recall@10 מול brute-force | 1.000 | 1.000 |
| Orama BM25 (build; query p50 / p95) | 16ms; 0.05 / 0.42ms | 107ms; 0.33 / 3.55ms |
| אינדקס float32 | 3.07MB | 30.7MB |

קריאה: בסקאלה אישית (אלפי רשומות; תקופת השמירה הנוכחית היא 14 יום) brute-force מדויק על `Float32Array` מהיר כמו ANN ופשוט ממנו בהרבה. Voy אינו מהיר יותר עד N=20,000, אבל ה־recall שלו מלא והוא קטן. Orama מהיר מאוד כחיפוש מילולי (BM25), אך הטוקניזציה העברית שלו נאיבית — הוא משלים, לא מחליף, חיפוש סמנטי.

גדלים (registry רשמי; בדוח המקביל): Voy‏ ~202KB (MIT/Apache-2.0); `@orama/orama`‏ ~344KB מקומית (Apache-2.0); `hnswlib-wasm`‏ ~3MB והבילד שלו web-only (נכשל ב־Node — לא נמדד); `sqlite-vec` עדיין pre-v1 עם plumbing של sqlite-wasm+OPFS; מודל e5-small quantized‏ ~118MB (MIT, dim=384) — הורדה חד־פעמית ו־cache עצל, לעולם לא בתוך ה־bundle. שימו לב: החבילה `orama` בלי scope היא ספריית ויזואליזציה; מנוע החיפוש הוא `@orama/orama`.

## 4. embeddings מקומיים

- `multilingual-e5-small` דרך transformers.js: נמדד לעיל — 5.5ms למסמך ב־CPU ב־Node. בדפדפן עם WebGPU צפוי מהיר יותר (הערכה, לא נמדד). קידומות `query:`/`passage:` חובה לפי כרטיס המודל.
- חלופה קטנה יותר (אנגלית בעיקר, ~22MB) אינה מתאימה לעברית. אין לקדם אנקודר בלי רגרסיית עברית (לקח docs/30).

## 5. MV3: service worker מול offscreen document

ה־SW נכבה אחרי ~30 שניות idle, אין לו DOM, והוא שומר כיום רק על `fetch` (`extension/background.js`). embeddings ואינדקס חייבים לגור ב־offscreen document (עם `offscreen` permission ו־reason) או להישאר ב־content script כמו שכבת הקונטקסט הנוכחית. המלצת המחקר: offscreen document ייעודי; ה־SW נשאר כמות שהוא.

## 6. פרטיות, הצפנה, מחיקה

- וקטור של הודעה הוא מידע רגיש כמו הטקסט. וקטורים יקבלו את אותו retention של רשומת המקור (14 יום להודעות) ויימחקו איתה; `clear` מוחק גם וקטורים.
- אין לשלוח וקטורים גולמיים ל־`/check`; החוזה נשאר טקסט + refs בדויים.
- הצפנה במנוחה (WebCrypto AES-GCM עם מפתח ב־`chrome.storage.local`) אפשרית אך היא הערכה בלבד, לא מומשה, ואינה הגנה מול גישה למכשיר. נדרש עדכון `PRIVACY.md` לפני כל מימוש.
- אין לטעון "הכל נשאר מקומי": `/check` המרוחק נשאר.

## 7. המלצה אחת והצעד הבא

**המלצה:** שכבת זיכרון מקומית ב־offscreen document: IndexedDB קיים + וקטורי `Float32Array` (int8 בהמשך) עם brute-force cosine עד ~20k רשומות, ומעל זה Voy; embeddings מקומיים e5-small quantized ב־cache עצל. בלי sqlite-vec ובלי hnswlib בשלב זה.

**צעד הבא:** להריץ את ה־POC בדפדפן אמיתי (unpacked זמני, מחוץ למאגר): זמן טעינת מודל ראשונה, p95 שליפה, זיכרון, ובדיקת מחיקה — ואז החלטת בעלים. קריטריון מעבר מוצע: שליפה p95 מתחת ל־50ms, תוספת bundle (בלי המודל) מתחת ל־500KB, מחיקה מוחקת וקטורים.

## מקורות

- מדידות: `research/vector-poc/bench.mjs` (הרצה: `node bench.mjs 2000` / `20000`).
- [sqlite-vec](https://github.com/asg017/sqlite-vec), [transformers.js](https://huggingface.co/docs/transformers.js), [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), תיעוד Chrome על [offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen) ומחזור חיי service worker.
- במאגר: `extension/context-store.js`, `engine/src/contextPacket.ts`, `PRIVACY.md`, `docs/24-safe-context-expansion.md`.
