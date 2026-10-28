# Lashon Hara Guard — Privacy Policy / מדיניות פרטיות

Updated: 2026-10-28. Applies to the browser extension and its default checking service. This describes the implementation reviewed on this date; provider configuration may change.

## English

### Local storage and remote processing

**LHG is not an entirely offline service.** Conversation context is stored locally in the browser, but checking a message sends its text and relevant context to remote services. Do not submit content you are not comfortable sending for remote processing.

### What stays in your browser

- Settings, access token, service URL, language, platform switches and panel position/size are stored in `chrome.storage.local`; LHG does not use Chrome storage sync for these settings.
- Check results also use extension-local storage, with hashed account/message/content/context/configuration keys, a 14-day reuse limit and at most 500 entries after maintenance. Results can contain explanations or quoted evidence. Errors are not cached as successful results. Clear extension storage to delete this cache; explicit Check again bypasses it. Local-memory model installation is not required for result reuse.
- The context component uses a local IndexedDB database named `lhg-context`, with an in-memory fallback. It can hold conversation identifiers, participant mappings, recent message excerpts, facts and relationships. IndexedDB used by content scripts is browser/site storage, not a separately encrypted extension vault.
- Persisted message excerpts are limited to 1,000 characters and 30 messages per conversation. The current cleanup runs when the context runtime starts and removes message records older than 14 days. This is not a timed deletion guarantee for all local data: participant, conversation, fact and relationship records do not share that message expiry.
- Local memory viewer (0.11.2): when the optional extension-wide local memory (`lhg-memory-v1`, off by default) holds data, the "Open memory viewer" button in its settings card opens an extension page that shows counts, dates, expiry, stored text and local semantic search scores, and deletes single entries or whole conversations after a confirmation. Only that page and the options page may call these views; a website's content script cannot. Stored text is hidden by default (a fixed row of dots, not the text length); one click reveals one entry, and "Show all text" lasts only until the page is reloaded — that choice is never saved. Vectors are never shown. Everything runs locally; the viewer sends nothing to a server.

### What is sent and why

When configured and enabled, LHG can automatically check incoming messages on supported platforms, drafts on an attempted send, and text you check manually. Typing alone does not start a draft check. Platform monitoring is enabled by default. Checking is not limited to text you have already sent.

A `/check` request sends the message text, platform, direction, language, any supplied user note (up to 500 characters), answers to clarification questions, and available context. Context can include up to five previous message excerpts of up to 300 characters each, participant references, roles, relationships and facts.

The default route uses a Cloudflare Worker, an Oracle-hosted classifier (with a Modal fallback), and, when model extraction runs, the Brain machine API and Meta's model API. The classifier receives the message text; model extraction can also receive the contextual excerpts and user note. A warm-up request contains authentication information but no conversation text. A custom service URL changes who receives the request.

The context builder uses participant references and attempts to redact known display names, email addresses and phone-like strings from exported context. **This does not guarantee anonymity.** The main message and free-text user note are sent without that context redaction, and identifying information can remain in any text.

### Storage outside the browser

The reviewed LHG proxy and classifier code do not implement a persistent message archive. The model adapter uses a stateless completions endpoint rather than creating a saved chat. These properties do not establish zero retention across the service chain.

Account authentication, permissions, balance and billing records are managed remotely. The LHG proxy sends the account service tokens and transaction references/results, not message text. Infrastructure and processing providers may also handle technical data such as IP addresses, request times, usage and error information.

**No blanket promise is made that message content exists only in the local database, that upstream logs never contain it, or that providers have zero retention or never use it for training.** Those properties and retention periods have not been verified across all deployed infrastructure and provider accounts. Provider handling is subject to the applicable service terms and configuration.

### Controls, deletion and contact

Use the extension settings to disable monitoring globally or per platform and to remove the access token. Disabling monitoring does not erase existing data or recall requests already sent. Incoming-message hiding is a display control, not a separate switch that prevents remote checks.

To remove local data, clear the extension's storage/settings and the supported sites' browser data, including the `lhg-context` IndexedDB database. Removing the extension alone may leave site-origin IndexedDB data. This does not delete the original conversations in Gmail, Google Chat or WhatsApp, or remote account/billing records. Local IndexedDB is not encrypted by LHG.

For privacy questions or requests concerning remote records, contact **yoni@citycar.co.il**. Do not include private conversation text or access tokens in a public GitHub issue.

## עברית

### אחסון מקומי ועיבוד מרוחק

**LHG אינו שירות שפועל כולו במחשב המקומי.** הקונטקסט נשמר בדפדפן, אך בדיקת הודעה שולחת את הטקסט וההקשר הרלוונטי לשירותים מרוחקים. אין למסור לבדיקה תוכן שאינכם מעוניינים לשלוח לעיבוד מרוחק.

### מה נשמר בדפדפן

- הגדרות, טוקן גישה, כתובת השירות, שפה, מתגי פלטפורמות ומיקום וגודל החלונית נשמרים ב־`chrome.storage.local`, ללא שימוש של LHG בסנכרון ההגדרות של Chrome.
- תוצאות בדיקה נשמרות גם באחסון המקומי של התוסף, במפתחות מגובבים לפי חשבון, מזהי הודעה ושיחה, תוכן, הקשר והגדרות הבדיקה. שימוש חוזר מוגבל ל־14 יום ולעד 500 רשומות לאחר ניקוי; תוצאה עשויה לכלול הסבר או ציטוט. שגיאות אינן נשמרות כהצלחה. ניקוי אחסון התוסף מוחק מטמון זה, וכפתור בדיקה חוזרת עוקף אותו. שימוש חוזר בתוצאות אינו דורש התקנת מודל הזיכרון המקומי.
- רכיב הקונטקסט משתמש ב־IndexedDB מקומי בשם `lhg-context`, עם חלופה בזיכרון. הוא עשוי להכיל מזהי שיחות, מיפוי משתתפים, קטעי הודעות אחרונות, עובדות ויחסים. אחסון IndexedDB מסקריפטי תוכן הוא אחסון דפדפן המשויך לאתר, ולא כספת נפרדת ומוצפנת של התוסף.
- קטעי הודעות הנשמרים מוגבלים ל־1,000 תווים ול־30 הודעות לשיחה. בעת הפעלת רכיב הקונטקסט מופעל ניקוי רשומות הודעה בנות יותר מ־14 יום. אין בכך הבטחת מחיקה מתוזמנת לכל המידע: רשומות שיחות, משתתפים, עובדות ויחסים אינן כפופות לאותה תפוגה.
- החל מגרסה 0.10 קיימת בנוסף אפשרות לזיכרון מקומי מרכזי של התוסף, כבויה כברירת מחדל. לאחר הפעלתה והתקנת מודל החיפוש נשמרים טקסטים משדות מאובחנים, כולל טיוטות שלא נשלחו, וקונטקסט שנאסף ממיילים ושיחות, רק כשזוהה חשבון. שיחה ללא מזהה מקבלת עבור טיוטה תחום מקומי ייחודי לשדה ולסשן; כותרת שיחה אינה משמשת מזהה.
- מסד זה, `lhg-memory-v1`, נמצא ב־extension origin. טקסט והווקטורים שלו נשמרים יחד עד 14 יום מהתצפית הראשונה, עם סינון תפוגה בכל קריאה וניקוי בעת פתיחת הרכיב ומדי דקה כל עוד הוא פועל. עד 20,000 מקורות או 5 מיליון תווי טקסט בסך הכול; מקורות ישנים מפונים בהגעה למגבלה. מקור אחד מוגבל ל־100,000 תווים ומפוצל למקטעים של עד 1,000 תווים; מקור ארוך יותר אינו נשמר.
- כפתור התקנת המודל מוריד כ־135MB של קובצי נתונים מ־Hugging Face; קוד JS ו־WASM כלולים בתוסף. חישוב embeddings והחיפוש עצמם מקומיים. ההורדה חושפת לספק ההורדה מידע רשת טכני, אך אינה מעבירה אליו טקסט שיחה. תוצאות החיפוש הן קונטקסט נצפה ולא עובדות מאומתות. הנתב המקומי טרם שולב והזיכרון החדש אינו מצורף אוטומטית לבקשת `/check`.
- צפייה בזיכרון (0.11.2): הכפתור "פתיחת צפייה בזיכרון" בכרטיס הזיכרון בהגדרות פותח דף של התוסף המציג ספירות, תאריכים, תפוגה, הטקסט השמור וציון חיפוש סמנטי מקומי, ומאפשר מחיקת רשומה בודדת או שיחה שלמה לאחר אישור. רק הדף הזה ודף ההגדרות רשאים לקרוא לפעולות אלה; סקריפט תוכן באתר אינו יכול. הטקסט מוסתר כברירת מחדל (שורת נקודות קבועה, לא באורך הטקסט); לחיצה מציגה רשומה אחת, ו"הצג את כל הטקסט" תקף רק עד טעינה מחדש של הדף ואינו נשמר. הווקטורים אינם מוצגים. הכול מקומי; הדף אינו שולח דבר לשרת.

### מה נשלח ולשם מה

לאחר הגדרת הגישה, כאשר הניטור פעיל, התוסף עשוי לבדוק אוטומטית הודעות נכנסות בפלטפורמות הנתמכות, טיוטות בעת ניסיון שליחה, וכן טקסט שנבחר לבדיקה ידנית. הקלדה לבדה אינה מפעילה בדיקת טיוטה. הניטור בפלטפורמות מופעל כברירת מחדל. הבדיקה אינה מוגבלת להודעות שכבר נשלחו.

בקשת `/check` כוללת את טקסט ההודעה, הפלטפורמה, הכיוון, השפה, הבהרת משתמש אם נמסרה (עד 500 תווים), תשובות לשאלות בירור והקשר זמין. ההקשר עשוי לכלול עד חמישה קטעי הודעות קודמות בני עד 300 תווים, מזהים חלופיים של משתתפים, תפקידים, יחסים ועובדות.

מסלול ברירת המחדל כולל Cloudflare Worker, מסווג ב־Oracle עם חלופה ב־Modal, ובעת הפעלת חילוץ באמצעות מודל — API מכונה של Brain ו־API המודלים של Meta. המסווג מקבל את טקסט ההודעה; המודל עשוי לקבל גם קטעי הקשר והבהרת משתמש. בקשת חימום כוללת אימות אך אינה כוללת תוכן שיחה. הגדרת כתובת שירות אחרת משנה את הגורם המקבל.

בונה ההקשר משתמש במזהים חלופיים ומנסה להסיר שמות תצוגה מוכרים, כתובות דוא״ל ומספרים דמויי טלפון מהקשר מיוצא. **אין בכך הבטחת אנונימיות.** טקסט ההודעה הראשית והבהרת המשתמש נשלחים ללא מנגנון ההסרה הזה, ובכל טקסט עלולים להישאר פרטים מזהים.

### אחסון מחוץ לדפדפן

קוד ה־proxy והמסווג שנבדק אינו מממש ארכיון הודעות מתמשך. מתאם המודל משתמש בבקשת completions ללא יצירת צ׳אט שמור. אין בכך הוכחה להעדר שמירה בכל שרשרת השירותים.

אימות חשבון, הרשאות, יתרה ורישומי חיוב מנוהלים בשרת. ה־proxy מעביר לשירות החשבון טוקנים ומזהי ותוצאות עסקאות, ללא טקסט הודעות. ספקי תשתית ועיבוד עשויים לטפל גם במידע טכני כגון כתובות IP, זמני בקשות, שימוש ושגיאות.

**אין התחייבות שכל התוכן נשמר רק במסד המקומי, שלוגים בשירותים במעלה השרשרת אינם כוללים אותו, או שלספקים אין שמירה או שימוש לאימון.** מאפיינים אלה ותקופות השמירה לא אומתו בכל התשתיות וחשבונות הספקים הפרוסים. הטיפול אצל הספקים כפוף לתנאי השירות ולהגדרות הרלוונטיים.

### שליטה, מחיקה ויצירת קשר

בהגדרות התוסף ניתן לכבות ניטור לכל הפלטפורמות או לפלטפורמה מסוימת ולהסיר את טוקן הגישה. כיבוי אינו מוחק מידע שכבר נשמר ואינו מבטל בקשות שכבר נשלחו. הסתרת נכנסות היא בקרת תצוגה, ואינה מתג נפרד למניעת בדיקות מרוחקות.

בהגדרות הזיכרון המקומי ניתן לעצור שמירה ושליפה חדשות או למחוק את כל הטקסטים והווקטורים במסד המרכזי. מחיקה זו אינה מוחקת את מסד הקונטקסט הישן המשויך לאתר, את קובצי המודל במטמון, או הודעות במקור. ריקון שדה טיוטה מוחק את רשומת הטיוטה שנצפתה; היעלמות הודעה ממסך או מחיקתה באתר אינן מפעילות כרגע מחיקה אוטומטית מהזיכרון. התפוגה והמחיקה הידנית חלות גם עליה.

למחיקת המידע המקומי יש לנקות את אחסון והגדרות התוסף וגם את נתוני האתרים הנתמכים בדפדפן, כולל מסד `lhg-context`. הסרת התוסף לבדה עשויה להשאיר IndexedDB המשויך לאתר. פעולה זו אינה מוחקת שיחות מקור ב־Gmail, ב־Google Chat או ב־WhatsApp, או רישומי חשבון וחיוב מרוחקים. LHG אינו מצפין בעצמו את מסד IndexedDB המקומי.

לשאלות פרטיות או לבקשות בנוגע לרישומים מרוחקים: **yoni@citycar.co.il**. אין לפרסם תוכן שיחות פרטי או טוקני גישה ב־GitHub issue ציבורי.
