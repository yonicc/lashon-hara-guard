# מסווג מהיר (Gate) ב־Modal (פעיל מ־2026-10-26)

## זרימה

התוסף ← Proxy (`/check`) ← **Gate**: DictaBERT v2, ‏fp32, ‏CPU, בכתובת
`https://yonicc--lhg-gate-gate-check.us-east.modal.run`. רק כש־`p ≥ 0.2` ממשיכים ל־muse-spark.

- כשל או timeout של ה־Gate (`LHG_GATE_TIMEOUT_MS=1500`) ← ממשיכים ל־muse. ה־Gate יכול רק לחסוך קריאה,
  לעולם לא להסתיר הודעה.
- כיבוי: למחוק את `LHG_GATE_URL` מ־`proxy/wrangler.toml` ולפרוס.
- Secrets: ‏`LHG_GATE_KEY` ב־Worker, ו־`GATE_KEY` ב־Modal secret ‏`lhg-gate`. שניהם אותו ערך.

## נתונים ומודלים (`classifier/`)

- `gen_dataset.py`: הודעות סינתטיות לפי קטגוריה דרך muse-spark, ותיוג חוזר עיוור.
  - `v1.jsonl`: ‏2875 שורות.
  - `v2_aug.jsonl`: ‏1715 שורות קשות: רמיזות, עקיצות בתוך לוגיסטיקה, שבח מותנה, חשיפה מהפרטי,
    ושבח כן שנראה דומה לעקיצה.
- `gen_eval.py`: סט מבחן **בלתי תלוי** מ־Codex gpt-6.1-sol: ספק אחר, prompt אחר, תוויות שהמודל בחר
  (כולל `ambiguous`). אף פעם לא משמש לאימון.
- `train_modal.py`: אימון על T4, כ־75–120 שניות. המודלים נשמרים ב־Modal Volume ‏`lhg-models:/v1`, `/v2`.
- `serve_modal.py`: נקודת הקצה (`modal deploy`) והערכה (`modal run ... --data <eval>`).

## תוצאות על המבחן הטרי `eval_codex_v2`

המבחן לא שימש לאימון ולא לבחירת הקטגוריות. 249 הודעות לא דו־משמעיות.

| מודל | recall חשד | precision | תמימות שנשלחו ל־muse |
|---|---|---|---|
| v1 | 0.959 | 0.967 | 3.1% |
| **v2 fp32 (פעיל)** | **0.992** | 0.960 | 3.9% |
| v2 int8 | 0.992 | 0.931 | 7.1% |

על `eval_codex_v1` הגיע v1 ל־0.906 בלבד. ממנו נלמד שחסרות רמיזות שקטות, ולכן הוא כבר לא בלתי תלוי עבור v2.

## חי דרך ה־Proxy

- הודעות תמימות: 0.4–0.7 שניות, נעצרות ב־Gate בלי קריאה למודל.
- הודעות חשודות: כ־4 שניות, עם אזהרה מלאה. כולל ״אתם יודעים למה״ ו״אבי אמר לכולם שאתה שקרן״.

## עלות וזמינות

- אימון והערכות עד כה: כ־$0.03.
- תעריפים (`modal billing rates`): CPU ‏$0.0473 ל־core לשעה, זיכרון $0.008 ל־GiB לשעה.
  במבנה הנוכחי (2 cores + 2GiB) זה כ־$0.11 לשעה כשהוא ער, וכ־$2.6 ליום אם הוא ער תמיד.
- `scaledown_window` 5 דקות, ‏cold start כ־10–12 שניות. התוסף שולח `/warm` בזמן הקלדה, לכל היותר פעם ב־4 דקות.
  ההודעה הראשונה אחרי שינה ממשיכה ל־muse (timeout), וזה בסדר.
- `min_containers` לא מוגדר. לא להגדיר בלי החלטה של המשתמש.

## מלכודות שאומתו

- `from __future__ import annotations` שובר את `modal.parameter()` (‏`InvalidError` / ‏`KeyError: 'int'`).
- brain-mcp: הענף `codex` ב־`/api/v1/chat/completions` מתעלם מ־`system_prompt`. ‏`gen_eval.py` מכניס
  את ההוראות לתוך הודעת ה־user.
- Cloudflare לפני `br.ysho.uk` חוסם את ה־User-Agent ברירת המחדל של Python, ולכן צריך UA מפורש.
