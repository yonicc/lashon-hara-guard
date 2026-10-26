# Brain כ־Backend ל־Extractor (ממצאי מחקר 2026-10-26)

מעמד: מחקר מאומת מקוד brain-mcp (לקריאה בלבד, ללא שינוי) + החלטת פרוטוטייפ.
אין כאן פסק, אין כלל approved, ואין סודות (endpoint/token רק בשמות משתנים).

## 0. עדכון 2026-10-26 (גובר על סעיפים 1–3 להלן)

סעיפים 1–2 נכתבו לפני שינוי ב־brain-mcp ונשארים כתיעוד היסטורי. שני תיקונים:

- **הממצא ש־1.3 לא קיים היה שגוי.** הוא בדק את ה־backend `muse`
  (Muse Code CLI, `_agents/muse.py`). ב־Brain קיים backend נפרד `meta_api`
  (`_agents/meta_api.py`, ‏`MetaApiAgent`) שמדבר ב־HTTP ישירות עם
  `https://api.meta.ai/v1/chat/completions`, ויש בו `muse-spark-1.3` ו־`muse-spark-1.3-contributor`.
- **brain-mcp ‏`491364e`** הוסיף ל־`/api/v1/chat/completions` ענף
  `agent_kind == 'meta_api'`: קריאה stateless אחת, מפתח מחשבון ה־Muse שבשדה
  `account` (חשבון לא מוכר = 400, לא נופל לחשבון הפעיל), `reasoning_effort`
  אופציונלי (`minimal|low|medium|high`), ובלי צ׳אט, היסטוריה או כלי סוכן.
  ה־transport משותף עם OpenRouter (`_http_completion`).

**החוזה הנוכחי של הספק** (`engine/src/extractor/brainSend.ts`):

```
POST {LHG_BRAIN_BASE_URL}/api/v1/chat/completions
Authorization: Bearer $LHG_BRAIN_TOKEN        (scope chat:send, לא guest)
{ "agent_kind":"meta_api", "model":"muse-spark-1.3-contributor", "account":"yoni",
  "stream":false, "system_prompt":"<הוראות JSON בלבד>",
  "messages":[{"role":"user","content":"<קטלוג + cues + הודעה>"}],
  "reasoning_effort":"<אופציונלי>" }
-> { "reply":"<JSON של RawExtraction>", "model":..., "usage":... }
```

ברירת מחדל `LHG_BRAIN_MODEL=muse-spark-1.3-contributor`; משתנה חדש
`LHG_BRAIN_REASONING_EFFORT`. כל כשל (רשת/timeout/HTTP/תשובה ריקה/לא JSON)
זורק, וה־pipeline ממפה אותו ל־`not_checked`. הזרימה new→model→send→delete הוסרה.

## 1. ממצא מאומת: ‎/api/v1/chat/completions אינו תומך ב־muse

מקור: `brain_mcp/dashboard/routes/v1_chat.py`, שורות ~148–156 (נכון ל־2026-10-26).
הלוגיקה היא ניתוב מפורש בלבד:

- `agent_kind == 'openrouter'` (או מזהה `vendor/model`) ← החזרת completion דרך OpenRouter.
- `agent_kind == 'codex'` ← החזרת completion דרך Codex CLI.
- **כל דבר אחר נופל לנתיב Claude SDK** (`claude_agent_sdk.query`).

אין בנתיב הזה שום ענף `muse`, שום קריאה ל־Meta API, ושום העברת `account` של muse.
מסקנה: **לא ניתן לשרת `muse-spark-*` דרך ‎/api/v1/chat/completions ללא שינוי קוד ב־brain-mcp.**
זו עובדה מבנית, לא מגבלת תצורה.

## 2. ההכרעה המעשית לפרוטוטייפ: צ׳אט ייעודי דרך ‎/api/chat/send

צד ה־muse ב־Brain חי **רק** בתוך מערכת הצ׳אטים (`agent_kind='muse'`,
`brain_mcp/dashboard/routes/chat/_agents/muse.py`, מודלים מקודדים
`muse-spark-1.2` / `muse-spark-1.2-contributor` / `muse-spark-1.1`).
הערה: המודל המבוקש `muse-spark-1.3-contributor` **אינו מופיע בקוד** —
הספק מקבל את שם המודל כפרמטר (`LHG_BRAIN_MODEL`), וברירת המחדל היא
`muse-spark-1.2-contributor` הקיים. אם וכאשר 1.3 יתווסף ל־Brain,
מספיק לשנות משתנה סביבה — לא קוד.

לכן הדרך המעשית היחידה כיום, בלי לשנות את brain-mcp:

1. `POST /api/chat/chats/new` ← מקבלים `{chat_id}` (מזהה hex קצר).
2. `POST /api/chat/model` עם `{agent_kind:'muse', model, account, chat_id}`
   ← מצמידים מודל/חשבון **per-chat**, בלי לגעת בגלובלים.
3. `POST /api/chat/send` עם `{message, chat_id}` ← מריץ turn אחד ומזרים
   SSE (`delta`/`done`/`error`); אפשר גם לקרוא תשובה לא־זורמת.
4. `DELETE /api/chat/chats/{chat_id}` בסוף כל קריאה ← איפוס מצב ופרטיות.

כל הקריאות מאומתות בטוקן שירות (`Authorization: Bearer`, scope `chat:send`);
שם משתנה הסביבה אצלנו: `LHG_BRAIN_TOKEN`. הבסיס: `LHG_BRAIN_BASE_URL`.

### למה SEND הוא התאמה גסה — ואיך מצמצמים

`/api/chat/send` הוא stateful מטבעו: היסטוריית הצ׳אט נשמרת בצד השרת,
מוזרק system-prompt של סוכן, והמודל רץ דרך subprocess עם כלים.
עבור inference בודד וחסר־מצב (structured JSON) זה overhead אמיתי
(הקמת צ׳אט + היסטוריה + סוכן לכל קריאה).

הצמצום בפרוטוטייפ: צ׳אט ייעודי חדש לכל קריאת extraction, prompt קצר
הדורש **JSON בלבד**, ומחיקה מיידית של הצ׳אט בסוף. התשובה חייבת לעבור
את `validateExtraction` הקיים — JSON לא תקין הוא כשל ספק (`not_checked`),
לא עובדות. המדידה המדויקת של ה־overhead (p50/p95) תיעשה רק מול Brain חי.

### אלטרנטיבה שנדחתה (לטווח ארוך)

הוספת ענף `muse` ב־`v1_chat.py` (stateless completions מול Meta API)
הייתה נותנת חוזה נקי יותר ל־Extractor. זה שינוי ב־brain-mcp —
מחוץ לתחום של משימה זו (המאגר שם לקריאה בלבד). נרשם כאפשרות עתידית,
לא כהמלצה לביצוע כאן.

## 3. חוזה הספק `BrainSendExtractorProvider` (מימוש: `engine/src/extractor/brainSend.ts`)

| פריט | ערך |
|---|---|
| בסיס | `LHG_BRAIN_BASE_URL` (למשל `http://localhost:PORT`) |
| auth | `Authorization: Bearer $LHG_BRAIN_TOKEN` (שם בלבד, אין סוד בקוד/גיט) |
| מודל | `LHG_BRAIN_MODEL` (ברירת מחדל `muse-spark-1.3-contributor`) |
| חשבון | `LHG_BRAIN_ACCOUNT` (תווית החשבון ב־Brain, למשל `yoni`) |
| timeout | `LHG_BRAIN_TIMEOUT_MS` (ברירת מחדל 30000) |
| זרימה | קריאה אחת ל־`/api/v1/chat/completions` עם `agent_kind=meta_api` (ראו סעיף 0); כל כשל רשת/HTTP/JSON/ולידציה = `not_checked` |
| כלל ברזל | המודל מציע עובדות/משמעות בלבד (`RawExtraction` גולמי); לעולם לא פוסק |

תשובת המודל נדרשת להיות אובייקט JSON עם `proposedFacts`, `meaning`,
`directAssessment` — כל דבר אחר נפסל בשכבת `validateExtraction`
(שכבר קיימת ואוכפת: מזהי קטלוג בלבד, בלי `confirmedByUserOnly`,
`evidenceExcerpt` חייב להיות קטע מילולי מההודעה, confidence חוקי).

## 4. מגבלות ידועות

- **היסטוריית צ׳אט**: כל קריאה יוצרת רשומת צ׳אט בשרת ה־Brain ונמחקת בסוף;
  אם המחיקה נכשלת, נרשמת אזהרה וההיסטוריה עלולה להישאר זמנית בשרת.
- **latency**: לא נמדד (אין Brain חי בהישג יד במשימה זו); צפוי overhead
  של से�טאפ צ׳אט + subprocess סוכן מעבר לזמן המודל נטו. סף ה־timeout
  מוגדר במשתנה סביבה וכל חריגה = `not_checked`.
- **פרטיות**: לשרת ה־Brain נשלח רק טקסט שעבר את `localGate` (כמו כל ספק ענן
  עתידי); אין שליחה של קשרים/זהויות מעבר לטקסט ההודעה וה־cues.
- **חיבור חי חסום כרגע**: לא אותר Brain מאזין נגיש מה־runner (פורט 3000
  המקומי שייך לשירות אחר), ולא הוגדרו חשבונות muse — לכן אין מדידת
  זמן־אמת במשימה זו. הבדיקה החיה כבויה כברירת מחדל מאחורי דגל סביבה.

## 5. שאלת Modal כמארח backend חלופי

המשתמש שאל האם עדיף לארח דרך Modal. תשובה עקרונית (בלי לשנות
את `ExtractorProvider` — הוא נשאר provider-agnostic):

- Modal מתאים לאירוח **stateless** של פונקציית inference (autoscale
  לאפס, secrets דרך Modal Secrets — הטוקן שהודבק בשיחה **אסור**
  להיכנס לקוד/גיט/env במאגר; רק Secret/משתנה סביבה בצד הפריסה).
- אבל Modal **אינו פותר את הגישה למודל**: עדיין צריך backend שמדבר
  עם Meta API עבור `muse-spark-*`. אם ה־Brain נשאר היחיד שיודע לדבר
  עם החשבון `yoni`, ה־Modal function בסוף תקרא ל־Brain (או ישירות
  ל־Meta API עם סוד משלו) — כלומר Modal הוא שכבת פריסה/הרחבה,
  לא תחליף להכרעת ה־endpoint.
- ל־MVP הנוכחי אין צורך ב־Modal: הספק מדבר ישירות עם ה־Brain
  מה־engine. Modal יישקל רק כשצריך proxy מרוחק לתוסף הדפדפן
  (מפתח לא נכנס לתוסף — ראו סעיף 6).

## 6. הפעלה מקומית ל־MVP (בלי סודות במאגר)

```powershell
$env:LHG_BRAIN_BASE_URL='http://<brain-host>:<port>'
$env:LHG_BRAIN_TOKEN='<service-token>'   # Bearer, scope chat:send
$env:LHG_BRAIN_MODEL='muse-spark-1.3-contributor'
$env:LHG_BRAIN_ACCOUNT='yoni'
$env:LHG_BRAIN_TIMEOUT_MS='30000'
$env:LHG_BRAIN_LIVE='1'                  # רק לבדיקת אינטגרציה חיה; כבוי כברירת מחדל
```

בדיקות: `npm run typecheck`, `npm test` (יחידה עם mock בלבד, בלי רשת).
בדיקה חיה: `npm run test:live` (דורש `LHG_BRAIN_LIVE=1` + env לעיל).

## 7. מה חסר כדי שהתוסף בדפדפן יקרא ל־backend בפועל

- Brain נגיש מהרשת של התוסף + טוקן שירות בתוקף (scope `chat:send`).
- **מפתח לא נכנס לתוסף**: אם התוסף מדבר ישירות עם ה־Brain, הטוקן
  היה נחשף — לכן נדרש proxy בצד שרת (אחת האפשרויות: Modal function
  שמחזיקה את `LHG_BRAIN_TOKEN` ב־Secret ומעבירה בקשות; הפריסה עצמה
  אינה חלק ממשימה זו וטרם הוגדרה).
- מדידות latency אמיתיות מול Brain חי + קביעת ספים ל־`not_checked`.
- אישור מדיניות שליחה לענן (מה נשלח, מתי, בהסכמת משתמש) — החלטה פתוחה ב־06.
