# 20 — מדידת חילוץ העובדות (proposedFacts) — צעד 2, 2026-10-27

## מה נמדד
- סט מבחן סינתטי: `engine/test/fixtures/fact-extraction-eval-v1.json` — 74 הודעות (52 עם עובדות
  מוצהרות, 12 נייטרליות, 8 גנאי בלי מידע תועלת, 2 «לתועלת» מוצהרת בלבד). `expect` = עובדות שהטקסט
  אומר במפורש; `ok` = מותר להציע לכאן או לכאן. כל הצעה אחרת של `toelet.*`/`speaker.*`/`audience.*`/
  `message.purpose` נספרת «לא נתמכת» (FP). ה־gold מחמיר: חלק מה־FP הן הסקות סבירות.
- מנגנון: `classifier/eval_facts.py <url> <keyfile> <dataset> <out> <label>` מול Worker מדידה זמני:
  `wrangler dev --remote -c <toml מחוץ למאגר>` עם `name = "lhg-proxy"` (כך הוא מקבל את סודות ה־Worker),
  שמריץ את `runExtraction` האמיתי ומחזיר `proposedFacts`/`droppedFacts`/`sentIdCount`. **לעולם לא
  `wrangler deploy` לקובץ כזה** — הוא היה מחליף את ה־proxy. ה־toml וה־entry נשארו מחוץ למאגר.
  Cloudflare חוסם User-Agent ברירת מחדל של Python (error 1010) — לשלוח `user-agent`.

## תוצאות (`classifier/results/fact_extraction_*.json`)
| ריצה | ids שנשלחו | precision | recall | חציון ms | p90 ms |
|---|---|---|---|---|---|
| v1_baseline (72 הודעות, ההנחיה הפרוסה) | 65 | 0.904 | 0.653 | 3512 | 4156 |
| v1b_catalog61 (+עובדת החריג, אותה הנחיה) | 66 | 0.836 | 0.689 | 3540 | 4906 |
| v2_prompt (מילון עובדות כלל בהנחיה) | 66 | 0.903 | 0.878 | 3742 | 4685 |
| v2_prompt_rerun (חזרה) | 66 | 0.889 | 0.865 | 3913 | 4902 |

- ה־Worker הפרוס שולח 65 ids (60 של `facts.json` + 5 של שיעור); אחרי צעד 2 — 66.
- המודל כמעט לא ממציא; החולשה הייתה recall: הוא השמיט עובדות שנאמרו במפורש (בעיקר
  `toelet.purpose_is_constructive`, `speaker.intent_to_disparage`), כי קיבל רק מזהים בלי משמעות.
  ההנחיה ב־`brainSend.ts` מגדירה עכשיו בקצרה כל עובדת כלל, מחייבת ציטוט, ו«לא» מוצהר = false.
- רעש בין ריצות: precision זז ±0.07 על אותה הנחיה — להשוות ממוצע של כמה ריצות.
- עלות: ~+200ms בחציון (הנחיה ארוכה יותר).
