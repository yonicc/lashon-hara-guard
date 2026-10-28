# 35 — מודל מקומי שמחליט על הרחבת קונטקסט: נתונים, אימון ומדידות (R&D)

סטטוס: מחקר בלבד, 2026-10-28. אין פריסה, אין שינוי ב-proxy, ב-gate, באורקל, בתוסף החי או בחוזה `/check` (docs/18).
(מספור: קיים גם `docs/35-local-memory-ingestion-and-browser-test.md`, מאותו יום; שני המסמכים משלימים זה את זה.)
קו אדום: המודל לא פוסק ולעולם לא מחזיר "מותר". הוא רק מחליט אם להרחיב קונטקסט, ואם כן מאיזה סוג.

## 1. מה המודל מחליט, ומה צומצם

ההחלטה לכל הודעה היא אחת משלוש (מקור יחיד: `classifier/router/labels.json` → `heads`):

| ראש | פירוש | מי מביא את הקונטקסט (קוד דטרמיניסטי) |
|---|---|---|
| (אף ראש לא עבר סף) | הקונטקסט מספיק | — |
| `mem_recent` | צריך את ההודעות האחרונות בשיחה | `get_recent` (‏k≤5) |
| `mem_search` | צריך מידע ישן יותר: "כבר דיברנו", שמועה, אירוע קודם | `search_history` (‏top_k≤3, embeddings מקומיים) |
| `ask_user` | צריך לשאול שאלה אחת (קשר / מטרה-תועלת) — לעולם לא להסיק | `propose_question` (רק מכניס לתור של השאלה האחת) |

**צומצם בבקשת הבעלים:** תכנון ראשון של שש תוויות לפי docs/34 (היסטוריה, משתתפים, קשר, אירוע, מטרה, ידיעה קודמת) נשאר רק כהערות בנתונים. `participants` אינו החלטת מודל — רשימת ה-refs נקראת דטרמיניסטית מה-packet. `event` נכלל ב-`mem_search`. מועמד decoder (Qwen2.5-0.5B) הושמט אחרי סבב 1 (הגרוע ביותר).
המודל הוא מסווג קטן (אנקודר + ראש sigmoid לכל אחד משלושת הראשים), לא LLM ולא סוכן כלים.

## 2. נתונים (סינתטיים בלבד)

- **אימון/dev:** `classifier/data/router_v2_synth.jsonl` — ‏11,181 שורות, 4,941 משפחות (he 4,933 / en 4,941 / mixed 1,307), split לפי משפחה (train 9,513 / dev 1,668; תרגומים תמיד באותו split). כל שורה מסומנת `synthetic:true`, `review_status: agent_reviewed_sample;human_review_pending`, ומקורה ב-`source`.
  - יצירה: `classifier/router/gen_router_modal.py` — Qwen2.5-32B כותב הודעות באנגלית לפי סט תוויות-יעד, ומתייג אותן שוב בעיוורון; תרגום לעברית ב-DictaLM-2.0-instruct; שפה מעורבת ב-Qwen2.5-32B. סבב השלמה ממוקד לתוויות נדירות (`--focus need_purpose,need_participants`, ‏909 משפחות).
  - תיוג סופי: `classifier/router/relabel_modal.py` — Qwen2.5-72B-Instruct (bf16, ‏4×H100) מתייג מחדש בעיוורון את הטקסט האנגלי של כל משפחה, באותן הגדרות. התייג של 32B נשמר בשדה `labels_32b`.
  - **לקח:** Qwen2.5-32B שכותב עברית ישירות (טמפ' 0.9) החזיר 0 שורות שמישות (רסיסי קירילית, סינית, טורקית והערות עצמיות). אנגלית + תרגום DictaLM בטמפ' 0 נותן עברית טבעית. DictaLM עצמו לא יודע לערבב שפות, ובלי הוראה בעברית ("תרגם לעברית:") הוא עונה על שאלה במקום לתרגם.
- **סט בחינה עצמאי:** `classifier/data/router_holdout_v1.jsonl` (מקור: `classifier/router/holdout_v1.src.txt`) — ‏153 שורות, 50 משפחות (he 59 / en 54 / mixed 40), כולל זוגות ניגוד (אותה הודעה עם/בלי וו להקשר). נכתב ידנית על ידי הסוכן (Claude) — כותב ו-prompt שונים מהמחולל; לא אומן עליו. 
- **בדיקת מדגם שלי:** 45 שורות אנגליות אקראיות מתיוג 32B: ‏39 תקינות, 6 שגויות (בעיקר "אירוע" ללא אירוע מסוים, החמצת "מטרה" אחת). מכאן ההחלטה לתייג מחדש עם 72B.
- **הסכמת מקור התוויות עם סט הבחינה** (המתייג הוא "תקרה" לתלמיד): 32B — ‏26.4% ראשים חסרים, 6.6% שורות שצריכות קונטקסט בלי שום הרחבה; ‏72B — ‏14.0% / 2.8%. החלוקה לסוגים מעורפלת גם לבני אדם; צריך סקירה אנושית לפני שמסתמכים על המספרים.

## 3. מועמדים ומדידות

ספים: לכל ראש נבחר על dev הסף הגבוה ביותר עם recall ≥ 0.9, ואז הוקפא והופעל על סט הבחינה. מדדים (`classifier/router/evaluate.py`):
**missed heads** = שיעור (שורה, ראש נדרש) שלא התבקש; **no-expansion miss** = שורות שצריכות קונטקסט וקיבלו אפס הרחבה (החמור ביותר); **needless** = שורות שלא צריכות כלום וקיבלו הרחבה (עלות בלבד, לעולם לא מסתיר הודעה).

### 3.1 סט הבחינה העצמאי (153 שורות), שלושה ראשים

| מועמד | נתונים | missed heads | no-expansion miss | needless | getters בממוצע |
|---|---|---|---|---|---|
| never (בסיס) | — | 1.000 | 1.000 | 0.000 | 0 |
| always (בסיס) | — | 0.000 | 0.000 | 1.000 | 4 |
| keywords (בסיס; נכתב אחרי סט הבחינה → אופטימי) | — | 0.223 | 0.123 | 0.340 | 1.25 |
| r1-xlmr (6 תוויות, ממופות לראשים) | v1, תיוג 32B | 0.190 | 0.085 | 0.447 | 1.82 |
| r1-e5s | v1 | 0.215 | 0.047 | 0.468 | 1.95 |
| r1-dicta | v1 | 0.190 | 0.047 | 0.468 | 1.76 |
| r1-qwen05 (decoder) | v1 | 0.281 | 0.104 | 0.553 | 1.51 |
| r2-xlmr (fp32) | v2, תיוג 72B | 0.116 | 0.019 | 0.362 | 1.77 |
| r2-e5s (fp32) | v2 | 0.091 | 0.047 | 0.511 | 2.01 |
| r2-e5lr (e5 קפוא + רגרסיה לוגיסטית) | v2 | 0.058 | 0.009 | 0.617 | 2.08 |
| **r2-e5s, emb8 ב-transformers.js** (ספים כוילו על התוצר עצמו) | v2 | **0.058** | **0.028** | **0.489** | 2.14 |
| r2-xlmr, emb8 ב-transformers.js | v2 | 0.107 | 0.028 | 0.830 | 2.41 |
| teacher Qwen2.5-72B (zero-shot) | — | 0.140 | 0.028 | 0.277 | 1.35 |

### 3.2 המועמד הנבחר לפי ראש ושפה (r2-e5s emb8, סט הבחינה, precision/recall)

| שפה | mem_recent | mem_search | ask_user | no-expansion miss | needless |
|---|---|---|---|---|---|
| הכול | 0.54/0.95 (n=37) | 0.77/0.92 (n=50) | 0.32/0.97 (n=34) | 0.028 | 0.489 |
| עברית | 0.52/0.93 (n=14) | 0.76/0.94 (n=17) | 0.29/0.92 (n=13) | 0.051 | 0.600 |
| אנגלית | 0.50/0.92 (n=13) | 0.68/0.88 (n=17) | 0.34/1.00 (n=12) | 0.027 | 0.471 |
| מעורב | 0.63/1.00 (n=10) | 0.88/0.94 (n=16) | 0.33/1.00 (n=9) | 0.000 | 0.300 |

פספוס שהוא "אפס הרחבה" על סט הבחינה: 3 מתוך 107 שורות שצריכות קונטקסט (2 בעברית, 1 באנגלית). ה-precision של `ask_user` נמוך (0.32): המודל מציע שאלה בערך פי 3 מהנדרש — מקובל רק כי השאלה היא אחת לכל היותר ונכנסת לתור קיים (docs/18).
טבלאות מלאות לכל מועמד/ראש/שפה ול-dev: `classifier/results/router/summary_r1.json`, `summary_r1_heads.json`, `summary_r2.json`, `summary_r2_int8.json` (`py -I classifier/router/table.py <summary> <run>`).

### 3.3 האם ההרחבה שהמודל ביקש מביאה את הקונטקסט הנכון מהזיכרון?

`research/local-router/memory-eval.mjs` + `memory-scenarios.json`: ‏16 שיחות סינתטיות, בכל אחת 12 הודעות הסחה ועוד הודעה רלוונטית אחת "מושתלת" בתוך ה-`LocalMemory` האמיתי של התוסף (`extension/memory.mjs`, embedding e5-small ב-revision המוצמד של התוסף). הנתב רואה רק את ההודעה החדשה.

| | הראש הנכון הופעל | הקונטקסט הנכון הוחזר (מקצה לקצה) | שליפה בלבד (ראש כפוי) |
|---|---|---|---|
| `mem_search` (ההודעה הרלוונטית בת 72 שעות, מחוץ ל-5 האחרונות) | 10/11 | 10/11 | 11/11 |
| `mem_recent` | 5/5 | 5/5 | 5/5 |

הפספוס היחיד (s01, "כמו שכבר דיברנו…"): הנתב בחר `mem_recent` במקום `mem_search`. זמן: החלטת נתב ≤7.7ms, תוכנית שלמה ≤14ms (`classifier/results/router/memory_eval_r2-e5s.json`). קבצי הזיכרון ב-YONI-PC (`memory.mjs`, `memory-embedding.mjs`, `memory-offscreen.mjs`) זהים בייט-לבייט ל-`origin/main` שעליו רצה הבדיקה (sha256 נבדק 2026-10-28). הבדיקה רצה ב-Node עם fake-indexeddb; מסלול ה-offscreen בדפדפן אומת בנפרד ב-docs/35-local-memory.

### 3.4 Latency (BI-1, ‏i7-10700K, ‏thread אחד, הודעה בודדת: טוקניזציה + forward)

| מודל | runtime | גודל | p50 | p95 |
|---|---|---|---|---|
| r2-e5s fp32 | onnxruntime (Python) | 449MB | 10.7ms | 13.9ms |
| r2-e5s emb8 | onnxruntime (Python) | 174MB | 10.0ms | 13.6ms |
| **r2-e5s emb8 (התוצר המומלץ)** | transformers.js 2.17.2 (Node 24) | 174MB | **6.4ms** | **7.8ms** (טעינה 0.9s) |
| r1-e5s int8 (dyn) | transformers.js 2.17.2 (Node 24) | 113MB | 3.4ms | 4.4ms |
| r2-xlmr fp32 | onnxruntime (Python) | 1,061MB | 34.7ms | 48.3ms |
| r2-xlmr emb8 | transformers.js 2.17.2 (Node 24) | 511MB | 17.1ms | 21.8ms |
| r2-xlmr int8 (dyn) | transformers.js 2.17.2 (Node 24) | 266MB | 9.2ms | 12.7ms |

תקציב docs/34: החלטה ≤150ms, הרחבה כוללת ≤400ms. נמדד: החלטה ≤8ms ב-Node, `search_history` אמיתי 11–14ms. זה Node עם onnxruntime-node, לא WASM בדפדפן — זמן ה-offscreen document לא נמדד כאן (הערכה: איטי פי כמה, עדיין בתוך התקציב).

### 3.5 דחיסה: לקח שנמדד
- `quantize_dynamic` רגיל (int8 לכל האופרטורים) הרס את xlmr: שינה 173/459 החלטות על סט הבחינה, ואחרי כיול מחדש 89% הרחבות סרק. גם int8 ל-MatMul בלבד הזיז הסתברויות עד 0.92.
- **emb8** (int8 רק לטבלת ה-embeddings, כל השכבות fp32): e5s ירד מ-449MB ל-174MB, סטייה מקסימלית 0.08, ו-13/459 החלטות השתנו ב-transformers.js. זה התוצר המומלץ.
- xlmr emb8 נראה תקין ב-onnxruntime של Python (סטייה 0.04) אבל ב-transformers.js שינה 106/459 החלטות — פער לא מוסבר בין שני ה-runtimes; לא נחקר.
- DictaBERT (האנקודר של ה-gate) לא נטען ב-transformers.js 2.17: `Unknown Normalizer type: NFD`.
- מסקנה: מכיילים ספים על התוצר שבאמת ירוץ, ושופטים לפי החלטות ולא לפי גודל/מהירות.

## 4. getters וחוזה (נבדק)

`research/local-router/getters.mjs`: עטיפה דקה ל-`LocalMemory.tools(scope)` (‏scope נקבע על ידי האפליקציה) ול-ContextPacket מחוטא (`engine/src/contextPacket.ts`).
- כל getter מחזיר `ok` או `unknown(reason)` — אף פעם false/ריק.
- תקציב: ≤50ms לקריאה, ≤400ms כולל, עד 3 קריאות זיכרון/שאלה; קריאות packet (thread/participants/event) מחוץ לתקציב הקריאות. בלי thread identity — אין שליפה מאוחסנת.
- אין דליפת טקסט: קטעים ≤300 תווים, refs פסאודונימיים (`m1…`, ה-sourceId של הזיכרון לא יוצא), ה-`trace` (היחיד שמיועד ללוג) מכיל רק שם getter, סטטוס, סיבה ו-ms.
- `propose_question` רק מכניס עובדה אחת מ-`FACT_CATALOG` לתור ומסיים את ההרחבה; לא עונה ולא שואל.
- בדיקות: `getters.test.mjs` — 14 עוברות; 4 שבירות מכוונות (unknown→0, thread→false, טקסט ב-trace, בלי חיתוך 300) נתפסו כולן. `integration.test.mjs` — 4 עוברות מול הזיכרון האמיתי (כולל אי-דליפה בין שיחות).

## 5. עלות GPU (הערכה לפי מחירון Modal, לא חשבונית)

| שלב | GPU-שניות (בערך) | $ |
|---|---|---|
| smoke ×6 (ניפוי מחולל עברית) | H100 ≈ 650 + idle, A100 ≈ 380 | ≈1.1 |
| יצירה מלאה (1,200 prompts) | H100 614, A100 228 | ≈0.8 |
| השלמת תוויות נדירות | H100 553, A100 174 | ≈0.7 |
| תיוג מחדש 72B | 4×H100 × 482 | ≈2.1 |
| אימון סבב 1 (5 מועמדים) + סבב 2 (3) | A10G 702 + 326 | ≈0.3 |
| **סה"כ** | | **≈5–6$** מתוך תקרה של 40$ |

## 6. החלטה

**כן — להמשיך לשילוב ניסיוני מאחורי דגל, עם r2-e5s emb8 (174MB).** הנימוקים: אותו אנקודר כמו הזיכרון המקומי (e5-small, אותו טוקנייזר ואותה ספרייה), latency זניח, אפס-הרחבה ב-2.8% מהמקרים על סט עצמאי, ובדיקה מול הזיכרון האמיתי 15/16.
**לא** לסמוך עדיין על המספרים כהבטחה: הכול סינתטי, סט הבחינה קטן (153) ונכתב בידי סוכן, החלוקה לראשים לא עברה סקירה אנושית, ו-49% הרחבות סרק (עלות זמן, לא סיכון). כשל או timeout של הנתב = `/check` רגיל בלי הרחבה, כמו כשל gate.

## 7. צעד הבא
1. סקירה אנושית של `router_holdout_v1` ושל מדגם מ-`router_v2_synth` (בעיקר `ask_user` ו-`mem_search` מול `mem_recent`), ואחריה סט בחינה טרי שלא הנחה שום החלטה.
2. מדידת latency בתוך offscreen document אמיתי (WASM, ‏1 thread) עם `model_quantized.onnx` של emb8 — לפי `research/local-memory/extension-test.mjs`.
3. הורדת הרחבות סרק: כיול ספים בנפרד לכל ראש ליעד recall נמוך מעט ב-`ask_user`, ונתונים עם זוגות ניגוד נוספים.
4. רק אחר כך: חיבור מאחורי דגל ב-offscreen, בלי שינוי ב-`/check`.

## 8. שחזור
```powershell
py -m modal run classifier/router/gen_router_modal.py --out classifier/data/router_v1_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --n-prompts 1200 --n-mix 3000
py -m modal run classifier/router/gen_router_modal.py --out classifier/data/router_v1_aug.jsonl --n-prompts 500 --n-mix 1000 --seed 2027 --focus need_purpose,need_participants
py -m modal run classifier/router/relabel_modal.py --data classifier/data/router_v1_synth.jsonl,classifier/data/router_v1_aug.jsonl --holdout classifier/data/router_holdout_v1.jsonl --out classifier/data/router_v2_synth.jsonl
py -m modal run classifier/router/train_router_modal.py --data classifier/data/router_v2_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --cands xlmr,e5s,e5lr --tag r2
py -I classifier/router/evaluate.py --data classifier/data/router_v2_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --probs "classifier/results/router/r2-*.probs.json" --out classifier/results/router/summary_r2.json
cd D:\lhg-router-models; py -m modal volume get lhg-models router/r2-e5s .     # יעד: תיקייה קיימת
py classifier/router/onnx_bench.py --model D:\lhg-router-models\r2-e5s --holdout classifier/data/router_holdout_v1.jsonl --probs classifier/results/router/r2-e5s.probs.json --variants fp32,emb8 --ship emb8
cd research/local-router; npm ci; node bench-router.mjs D:\lhg-router-models r2-e5s ..\..\classifier\data\router_holdout_v1.jsonl 1
cd engine; node --import tsx --test ../research/local-router/getters.test.mjs
```
`router_v1_synth.jsonl` ו-`router_v1_aug.jsonl` לא נשמרו במאגר: כל שורותיהם נמצאות ב-`router_v2_synth.jsonl` (התיוג של 32B בשדה `labels_32b`). המודלים ב-Volume ‏`lhg-models` תחת `/router/<run>`.
