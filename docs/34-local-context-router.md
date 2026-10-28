# 34 — מודל מקומי שמחליט מתי להרחיב קונטקסט (מחקר)

סטטוס: מחקר R&D. לא שונה שום שירות חי ולא חוזה `/check` (docs/18).
קו אדום: המודל אינו פוסק. הוא רק מחליט אם להרחיב קונטקסט ואילו כלים מקומיים להפעיל.
עובדה חסרה נשארת unknown; כשל של הנתב = בדיקה רגילה בלי הרחבה (כמו כשל gate כיום).

## 1. מה כבר קיים במאגר (עובדות, עם קבצים)

- חוזה `/check` (docs/18): `confirmedFacts` עד 20 מזהים מ־`FACT_CATALOG`;`rules.question` אחד לכל היותר. הנתב המקומי לא משנה את החוזה — הוא רק בוחר איזה קונטקסט מקומי לאסוף לפני הבדיקה.
- ה־gate הקיים: `classifier/serve_modal.py` (`Gate._score`, `max_length=96`, סף 0.2) ו־`classifier/oracle/server.py` (שכפול מדויק — חובה לשנות יחד), `LHG_GATE_THRESHOLD` ב־`proxy/src/handler.ts` וב־`proxy/wrangler.toml`. ה־gate רק חוסך קריאה ולעולם לא מסתיר; כשל/timeout מסלים הלאה (docs/12, docs/16).
- `engine/src/contextPacket.ts`: refs בדויים בלבד, `MAX_RECENT=5`, `MAX_TEXT=300`, סטטוס תלת־ערכי, עובדות רגישות רק מ־`user_confirmed`.
- משמעת מדידה קיימת: `classifier/gen_dataset.py` (סינתטי), `classifier/gen_eval.py` (סט עצמאי מספק אחר — לא לאימון), `classifier/eval_phase_a.py`, `classifier/validate_expansion.py`, והלקח של docs/30: החלפת אנקודר בלי דוגמאות רב־לשוניות שברה recall עברי — כל מועמד חייב רגרסיית עברית.

## 2. אפשרויות למודל ההחלטה

| אפשרות | עברית | tool-calling | משקל/זמינות | מסקנה |
|---|---|---|---|---|
| Gemini Nano / Chrome Prompt API | לא ברשימת השפות הנתמכות כיום (`en/ja/es/de/fr`…); עברית "בפיתוח" לפי הדוקס | אין function-calling מובנה; יש פלט JSON מובנה (`responseConstraint`) | הורדת מודל + `LanguageModel.availability()`; לא לכל המשתמשים | לא כשכבה ראשית כעת |
| WebLLM (LLM בדפדפן) | רב־לשוני, עברית לא מוכחת | function-calling רשמי רק בדגמי Hermes‏ 7–8B | ‏~0.9–2.3GB VRAM לדגמים קטנים | כבד מדי להחלטה שגרתית |
| מסווג multi-label קטן (transformers.js/ONNX) | אותה משפחת אנקודר של ה־gate; חובה רגרסיית עברית | לא צריך LLM — הכלים הם getters דטרמיניסטיים בקוד | עשרות MB, רץ מקומית | **מומלץ** |

מקורות: [Chrome built-in AI](https://developer.chrome.com/docs/ai/built-in), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api), [WebLLM](https://github.com/mlc-ai/web-llm), [transformers.js](https://huggingface.co/docs/transformers.js/index).

## 3. ההמלצה: מסווג "דרוש קונטקסט: איזה סוג"

- קלט מקומי בלבד: טקסט ההודעה + מטא־דאטה מקומית (פלטפורמה, סוג שיחה, האם יש thread identity, כמה הודעות אחרונות זמינות) — בלי שמות.
- פלט: הסתברות לכל קטגוריה, ממופה לשדות הקיימים: `need_recent_history`, `need_participants`, `need_thread_identity`, `need_relationship`, `need_event`, `need_purpose`. סף עצמאי לכל תווית (כיול על dev; ברירת מחדל שמרנית כמו 0.2) + `abstain` מחוץ להתפלגות.
- `need_relationship` ו־`need_purpose` לעולם לא מסיקים עובדה — הם מסתיימים בהצעת שאלת המשתמש האחת של docs/18.
- ארכיטקטורה: אנקודר gate קיים/קרוב + ראש sigmoid לכל תווית, ב־offscreen document (ראה docs/33). יעד זמן החלטה: עד ~150ms מקומית.

## 4. סכמת כלים ולולאה עם תקציב (הצעה)

הביצוע הוא קוד דטרמיניסטי, לא לולאת LLM:

```
ctx.get_recent(k: 1..5)        -> [{authorRef, direction, text<=300, ageMin}]
ctx.get_participants()         -> {kind, refs:[self/p..], roles?}
ctx.get_thread()               -> {threadIdKnown: bool}
ctx.search_history(q, top_k<=3)-> [{ref, snippet<=300}]   // שכבת הווקטורים של docs/33
ctx.get_event()                -> {eventKnown: bool, teacherRef?}
ctx.propose_question(factId)   -> {queued: bool}          // לתור השאלה האחת; לא שואל ישירות
```

תקציב קשיח: החלטת נתב ≤150ms; עד 3 קריאות getter, כל אחת ≤50ms; סך הרחבה ≤400ms; עצירה מיידית כשנדרשת שאלת משתמש, כשהספים לא עברו, או ב־timeout — ואז `/check` רגיל בלי הרחבה. ההצדקה: בדיקה תמימה כיום אורכת כ־0.4–0.7 שניות (docs/12); הרחבה לא תהפוך אותה לאיטית באופן מורגש.

## 5. נתוני אימון סינתטיים ומדידה

- סינתטי בלבד (אין הודעות אמיתיות): גנרטור בסגנון `gen_dataset.py`; סט שיפוט עצמאי בסגנון `gen_eval.py` מספק/prompt אחר. חובה contrast pairs — הודעה זהה עם ובלי היסטוריה שמשנה את הצורך בקונטקסט — במשפחות עברית/אנגלית/מעורב, כשאחים מתורגמים נשארים באותו split (docs/28).
- מדדים: recall/precision לכל תווית; `missed_context_rate` על מקרי concern (יעד: לא גרוע מה־recall של gate v2); עלות הרחבת־סרק (שיעור הרחבות מיותרות, קריאות חציוניות, ms ותווים נוספים); השוואה לשני בסיסים: תמיד־להרחיב ולעולם־לא. ספים מכוילים על dev בלבד; שיפוט סופי על holdout טרי; רגרסיית עברית חובה (docs/30).

## 6. צעד הבא

לבנות סט סינתטי קטן (contrast pairs) ולאמן ראש multi-label על אנקודר ה־gate, למדוד מול שני הבסיסים, ורק אז להציע שילוב מאחורי דגל ב־offscreen document. בלי שינוי חוזה, בלי פריסה, ובלי החלטה אוטומטית שמחליפה את שאלת המשתמש.
