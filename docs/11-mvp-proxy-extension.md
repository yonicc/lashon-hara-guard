# MVP: תוסף WhatsApp Web ← Proxy ← Brain (2026-10-26)

מעמד: MVP שהמשתמש אישר במפורש לבנייה. אין בו פסק ואין כלל approved.
התוסף רק מציג תזכורת ואינו חוסם שליחה.

```text
extension (content.js בוואטסאפ Web)
  → background.js   (מחזיק רק את מפתח הגישה x-lhg-key)
  → https://lhg-proxy.yonicc.workers.dev/check   (Cloudflare Worker, proxy/)
      מחזיק את LHG_BRAIN_TOKEN כ־secret; קורא ל־runExtraction של ה־engine
  → https://br.ysho.uk/dash/api/v1/chat/completions (agent_kind=meta_api)
  → Meta: muse-spark-1.3, reasoning minimal
```

## חוזה `POST /check`

- Header: `x-lhg-key: <מפתח גישה>`. מפתח חסר או שגוי מחזיר 401.
- Body: `{ "text": "...", "platform": "whatsapp-web", "direction": "outgoing" }`. עד 2000 תווים (מעבר לכך 413).
- תשובה: `{ alert, status, mechanism, evidence, limitationsHe, ms }`.
- `alert` מוגדר במקום אחד בלבד (`proxy/src/handler.ts` ‏`alertFor`):
  - `warn`: `concern`, או שהמודל סימן משמעות שעלולה להיות מעליבה.
  - `unsure`: `unsure` או חוסר הכרעה.
  - `none`: `no_concern`, או שהסינון המקומי דילג על ההודעה (רק כש־`LHG_ALWAYS_EXTRACT=0`).
  - `not_checked`: כל כשל. לעולם לא מוצג כ״תקין״.
- מגבלה: 30 בקשות לדקה למפתח (Rate Limit binding). ל־MVP, ‏`LHG_ALWAYS_EXTRACT=1`:
  כל הודעה נשלחת למודל, כי הסינון המקומי פספס במדידה ניסוחים כמו ״כרגיל אצלו״.

## אומת חי

- `/check` דרך ה־Worker: 3.2–3.8 שניות מקצה לקצה.
  - ״איזה גאון, שוב באיחור״ ← `warn` (irony)
  - ״כרגיל אצלו״ ← `warn` (mockery)
  - ״תודה רבה לדוד״ ← `none`
- מפתח שגוי ← 401.

## פריסה (BI-1, wrangler מחובר לחשבון yonicc)

```powershell
cd C:\Users\dev\lashon-hara-guard\proxy
npm install; npm run typecheck; npm test
npx wrangler deploy
# secrets: write a JSON file OUTSIDE the repo, then delete it
npx wrangler secret bulk C:\path\outside\repo\secrets.json   # {"LHG_ACCESS_KEY":"...","LHG_BRAIN_TOKEN":"brk_..."}
```

**מלכודת שאומתה:** ‏`<value> | npx wrangler secret put X` ב־Windows PowerShell 5.1
(דרך `npx.ps1`) מדווח Success, אבל הערך שנשמר שגוי, וכל בקשה מקבלת 401.
להשתמש רק ב־`wrangler secret bulk <file.json>`.

## התקנת התוסף (Chrome)

1. `chrome://extensions` ← להפעיל Developer mode ← Load unpacked ← לבחור את התיקייה `extension/`.
2. בהגדרות התוסף: להדביק את מפתח הגישה ← שמור ← ״בדיקת חיבור״.
3. ב־web.whatsapp.com: לכתוב הודעה ולעצור לרגע. אחרי כ־1.2 שניות של שקט נשלחת בדיקה,
   והחלון מופיע מעל שורת הכתיבה.

## פתוח

- סריקת הודעות נכנסות היא דרישת ליבה, ועדיין לא מומשה (רק `outgoing`).
- הסלקטור של שורת הכתיבה (`footer [contenteditable=true]`) תלוי ב־DOM של WhatsApp
  ועלול להישבר כשהוא משתנה.
- מפתח גישה אחד משותף; התחברות פר־משתמש תיבנה בהמשך.
