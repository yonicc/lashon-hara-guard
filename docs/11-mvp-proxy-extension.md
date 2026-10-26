# MVP: תוסף WhatsApp Web ← Proxy ← Brain (2026-10-26)

מעמד: MVP שהמשתמש אישר במפורש לבנייה. אין בו פסק ואין כלל approved.
התוסף רק מציג תזכורת ואינו חוסם שליחה.

```text
extension (WhatsApp Web: יוצאות + נכנסות; Gmail/Google Chat: נכנסות)
  → background.js   (מחזיק רק את מפתח הגישה x-lhg-key, מעביר direction)
  → https://lhg-proxy.yonicc.workers.dev/check   (Cloudflare Worker, proxy/)
      מחזיק את LHG_BRAIN_TOKEN כ־secret; קורא ל־runExtraction של ה־engine
  → https://br.ysho.uk/dash/api/v1/chat/completions (agent_kind=meta_api)
  → Meta: muse-spark-1.3, reasoning minimal
```

## סריקת נכנסות (עודכנה ב־2026-10-26, דרישת ליבה לפי docs/06 ‏U-03)

- **היכן:** WhatsApp Web (בנוסף ליוצאות), Google Chat ו־Gmail (שרשור פתוח).
  כל הסלקטורים מרוכזים ב־`extension/selectors.js` עם fallback; אין סלקטור
  שמפוזר בקבצי ה־content.
- **מה נחשב ״חדש״:** ה־Scanner (`extension/incoming.js`) רץ פעם אחת בלי
  לשלוח דבר — זו נקודת הבסיס (baseline). רק בועות/שורות שמופיעות אחרי
  טעינת הדף נשלחות. היסטוריה ישנה אינה נשלחית ״בבת אחת״.
- **כיוון:** `direction: "incoming"`. `background.js` מעביר את הכיוון
  כפי שהוא ל־`/check`; ה־proxy כבר מקבל אותו.
- **סימון:** תגית קטנה צמודה לבועה בלבד: ״עלולה להתפרש כגנאי — אינה
  פסיקה״ / ״ייתכן שיש כאן משמעות לא מכוונת״ / ״לא נבדק״. אין הסתרה,
  טשטוש, חסימה או שכתוב.
- **אין פופאפ אוטומטי להודעות נכנסות:** ב־Gmail/Google Chat (וגם בנכנסות
  ב־WhatsApp) התוצאה היא תגית ליד ההודעה בלבד. רק חלון התוצאה בזמן כתיבה
  ב־WhatsApp הוא פופאפ; ב־Gmail פתיחת דף או רענון אינם אמורים להציג פופאפ.
- **קצב:** ה־proxy מגביל ל־30 בקשות לדקה למפתח. הלקוח מאט את עצמו
  לשליחה אחת כל ~2.1 שניות ומחזיק תור קטן; עודף מעבר לתור מסומן
  ״לא נבדק (עומס בדיקות)״ ואינו נעלם בשקט.
- **מגבלות מוכרות:** הסלקטורים של Google מבוססים על מבנה DOM מוכר אך
  לא אומתו חי מול חשבון Google (אין סביבת Google מחוברת ב־BI-1);
  נפילת סלקטור = אין סריקה ואין התרעת כשל גלויה ב־Google בשלב זה.
  ב־WhatsApp כן קיים באנר ״התוסף לא מזהה את שורת הכתיבה״ כששורת
  הכתיבה לא נמצאה בזמן שיחה פתוחה.

## פתיחה ידנית עם Ctrl+Shift+‎+ (גרסה 0.3.0)

- הקיצור הוא קיצור בתוך העמוד שבפוקוס (לא Chrome Extension Command
  גלובלי), כי ל־Commands API אין שם מקש נתמך ל־Plus/Equal. לכן הוא פועל
  רק כשהטאב הנתמך פעיל ובפוקוס: WhatsApp Web, Gmail או Google Chat.
- לחיצה בלי טקסט מסומן פותחת/סוגרת פאנל מצב גלוי: האם התוסף פעיל והאם
  זוהתה הודעה/שורת כתיבה. זהו חיווי פעילות, לא תוצאת “תקין”.
- לחיצה כאשר טקסט מסומן בעמוד בודקת את הטקסט המסומן. ב־WhatsApp, אם אין
  סימון אך יש טקסט בשורת הכתיבה, נבדק טקסט שורת הכתיבה כ־outgoing.
- תוצאת בדיקה ידנית מוצגת גם כשאין התראה בנוסח “לא התקבלה התראה בבדיקה
  זו”, עם הבהרה שזו אינה פסיקה או קביעה שהטקסט תקין. כשל/חוסר מפתח
  מוצג כ־`not_checked`/לא מוגדר, לעולם לא כתקין.
- ב־Gmail/Google Chat עדיין אין סריקת יוצאות אוטומטית; הקיצור עם סימון
  הוא בדיקה ידנית בלבד והכיוון ברירת־מחדל incoming, אלא אם הסימון נמצא
  בתוך אזור כתיבה מזוהה על ידי המתאם.

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
4. ב־Gmail/Google Chat: אין פופאפ בפתיחה. הודעה נכנסת חדשה שמגיעה אחרי
   טעינת העמוד תקבל תגית ליד גוף ההודעה/שורת הצ׳אט. לפתיחת פאנל המצב או
   לבדיקת טקסט מסומן לחץ `Ctrl+Shift+‎+`.

### YONI-PC (עותק פעיל קבוע)
- מקור האמת הוא `extension/` במאגר הזה (BI-1). כל שינוי בתוסף מועתק גם לעותק ה־unpacked הפעיל במחשב YONI-PC: `/home/yoni/lashon-hara-guard-gmail/extension` (לינוקס, משתמש `yoni`). לאחר ההעתקה מאמתים התאמת SHA-256 מול המאגר ושה־`manifest.json` תקין.
- לא מעתיקים סודות או מפתח גישה; המפתח נשמר מקומית בפרופיל ה־Chrome של אותו מחשב דרך דף ההגדרות.
- לאחר עדכון יידני של התיקייה יש ללחוץ Reload לתוסף ב־`chrome://extensions` (אין טעינה חמה כש־`manifest.json` השתנה).
- ב־2026-10-26 סונכרנה לשם גרסה `0.3.0` עם פאנל ידני ב־`Ctrl+Shift+‎+`; הגרסה הישנה `0.1.2` נשמרה בגיבוי תחת `backups/` באותו מחשב.

## פתוח

- ~~סריקת הודעות נכנסות~~ — מומשה ב־2026-10-26 (WhatsApp Web, Google Chat,
  Gmail). סלקטורי Google לא אומתו חי; נותר לאמת מול חשבון אמיתי.
- הסלקטורים תלויים ב־DOM של האתרים ועלולים להישבר כשהוא משתנה — כל
  הסלקטורים ב־`extension/selectors.js` עם fallback, וב־WhatsApp מוצג
  באנר גלוי כשהכתיבה אינה מזוהה; ב־Google נפילת סלקטור עדיין שקטה.
- מפתח גישה אחד משותף; התחברות פר־משתמש תיבנה בהמשך.
- גמייל/צ׳אט: אין סריקת יוצאות אוטומטית ב־Google, ולא נמדד קצב
  כוזב־חיובי של תגיות הנכנסות. פאנל המצב הידני ב־`Ctrl+Shift+‎+` מראה אם
  זוהתה הודעה פתוחה, אך אינו מחליף אימות חי של הסלקטורים.
