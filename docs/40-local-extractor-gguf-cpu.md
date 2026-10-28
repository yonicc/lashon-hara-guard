# 40 — מחלץ מקומי: כיווץ GGUF ומדידה על 4 ליבות CPU (e9)

מחקר offline בלבד, ללא פריסה. ההמרה והמדידה רצו ב-Modal: הקונטיינר הוגבל ל-`cpu=(4,4)` ו-llama.cpp הורץ עם `n_threads=4`, ‏`llama-cpp-python==0.3.7`, ‏llama.cpp `b4500`.
**המדידה לא רצה על אורקל ולא על מחשב של משתמש.** היקף: 8 עובדות בלבד. המשקולות הן של e8 (docs/39).
הסטים: legacy ‏(74 הודעות בעברית) ו-sealed_v3 ‏(30 הודעות). סה"כ 104 הודעות, כל אחת בנפרד (batch 1), חילוץ greedy עם 256 טוקנים לכל היותר. ההנחיה עוברת בדיוק דרך אותה תבנית צ'אט כמו בהערכה על GPU.

## תוצאות (precision / recall; ‏bf16 = אותו מודל על GPU)
| מודל | קובץ | RSS שיא | p50 / p95 להודעה | החלטות ששונו מול bf16 | legacy | sealed_v3 בעברית | F1 ב-legacy ביחס לענן |
|---|---|---|---|---|---|---|---|
| 7B Q4_K_M | 4.36GiB | 5.3GiB | 15.6s / 26.4s | 11/104 | 85.7% / 58.8% | 80.0% / 63.2% | 76% |
| 7B Q8_0 | 7.54GiB | 8.4GiB | 21.1s / 35.4s | 4/104 | 84.2% / 62.7% | 85.7% / 63.2% | 78% |
| DictaLM Q4_K_M | 4.07GiB | 5.1GiB | 26.1s / 42.9s | 8/104 | 73.5% / 70.6% | 93.8% / 78.9% | 78% |
| DictaLM Q8_0 | 7.18GiB | 8.2GiB | 26.8s / 47.4s | 2/104 | 76.1% / 68.6% | 100% / 84.2% | 78% |
| union Q4 (שניהם) | 8.4GiB | — | סכום שני המודלים | — | 76.0% / 74.5% | 88.9% / 84.2% | **82%** |
| union Q8 (שניהם) | 14.7GiB | — | סכום שני המודלים | — | 77.6% / 74.5% | 93.8% / 78.9% | **83%** |

הענן ההיסטורי ב-legacy: P 93.9%, R 90.2%, ‏F1 0.920. ‏union ב-bf16 הגיע ל-85% (docs/39).
החלטה ששונתה פירושה שקבוצת זוגות (עובדה, ערך) בשורה שונה מזו של bf16. כל הריצות הסתיימו בלי שגיאות פורמט JSON, כלומר Q4 לא שבר את הפלט כמו int8 של Torch ב-docs/37.

**הסתייגויות:**
- הספירות קטנות: 51 עובדות ב-legacy, ‏19 ב-sealed_v3 בעברית.
- תחזית הזיכרון ל-union היא סכום של שני הקבצים. היא לא נמדדה בתהליך אחד.
- ‏Modal מגדיר 4 ליבות פיזיות, ולכן זה לא בהכרח זהה ל-4 ליבות של אורקל או של מחשב ביתי.

## מה זה אומר
- **אפשר להריץ מקומית ב-Q4 בלי פגיעה מהותית באיכות:** 4–5GB זיכרון, כ-15 שניות להודעה עם ה-7B וכ-26 שניות עם DictaLM.
- **ה-latency הוא הבעיה, לא האיכות.** בממוצע הוזנו 403 טוקנים של הנחיה ל-7B ו-497 ל-DictaLM, ונוצרו 23–36 טוקנים.
- כיווני האצה שלא נמדדו: הנחיה קצרה יותר, מטמון KV קבוע להנחיה, GPU או Metal אצל המשתמש, והפעלה רק כשהנתב (docs/35) מחליט שצריך.
- **אפשרויות למוצר, לבחירת המשתמש:**
  - "מקומי מהיר": 7B Q4.
  - "מקומי עברית": DictaLM Q4.
  - "מקומי מדויק": union, כפול זמן ו-8.4GB.
  - "ענן": כמו היום, בלחיצה.

## פרסום (Hugging Face) ובדיקת Ollama
- פורסם כ-repo ציבורי, ישירות מ-Modal (`research/local-extractor/hf_publish_modal.py`, ‏secret `lhg-hf-upload`):
  - https://huggingface.co/yonicc/lhg-extractor-qwen7b-gguf
  - https://huggingface.co/yonicc/lhg-extractor-dictalm-gguf

  בכל repo יש Q4_K_M ו-Q8_0, ‏`extractor_prompt.txt`, ‏`contract.json` וכרטיס מודל עם המדידות.
- **בדיקת Ollama** ב-Modal, על 4 ליבות: `ollama pull hf.co/<repo>:Q4_K_M` לקח 24–30 שניות. ‏`/api/generate` עם `raw:true` והנחיה מרונדרת החזיר פלט זהה ל-llama.cpp ב-3 מתוך 3 הודעות בכל מודל. הזמנים: 22, ‏7 ו-3.3 שניות להודעה, כנראה בזכות מטמון ההנחיה הקבועה. זה מדגם של 3 הודעות בלבד. `results/e9-hf-*-ollama.json`.
- הריצה המקומית המתוכננת היא אפליקציה לצד התוסף (Ollama או llama.cpp), לא בתוך התוסף. חיבור התוסף טרם נבדק.

## עלות (הערכה לפי מחירון, לא חשבונית)
ארבע מדידות CPU של כ-40–50 דקות כל אחת, וארבע המרות על 8 ליבות: **כ-1$**. קובצי ה-GGUF שמורים ב-Volume `lhg-models` תחת `local-extractor/<tag>/gguf/`, והאחסון נספר בנפרד.

## שחזור
```
$PY -m modal run --detach research/local-extractor/gguf_modal.py --model 7b --quant Q4_K_M
$PY research/local-extractor/score.py --tag e9-gguf-7b-Q4_K_M
$PY research/local-extractor/compare_gguf.py e9-gguf-7b-Q4_K_M e8-natural-7b-20261028:natural-7b-lora
$PY research/local-extractor/combine.py --a e9-gguf-7b-Q4_K_M:gguf-7b-Q4_K_M --b e9-gguf-dicta-Q4_K_M:gguf-dicta-Q4_K_M --out e9-gguf-combined-Q4_K_M
```
