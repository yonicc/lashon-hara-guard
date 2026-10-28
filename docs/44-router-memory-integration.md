# 44 — חיבור הנתב המאומן לזיכרון התוסף

2026-10-28. מימוש בענף לשילוב; לא פורסמה גרסה ולא הועתק לתוסף המשתמש.

## הזרימה

`context-runtime.prepare` לוכד את זהות החשבון והשיחה באופן סינכרוני.
כאשר הזיכרון ו־`lhgRouterEnabled` פעילים, הוא מבקש `route_context` דרך
`memory-background.js`; אותו bridge מאמת אתר/frame, extension id, incognito והמתגים.
ה־offscreen מפעיל את `memory-router-model.mjs` ואז `expandMemory` ב־`memory-router.mjs`.
המודל רואה את ההודעה בלבד, ומחזיר רק mem_recent/mem_search/ask_user או רשימה ריקה.
היישום קובע scope ושאילתת חיפוש, ללא לולאת כלים וללא פעולות כתיבה למודל.

חיפוש עד שלושה קטעים קודם ל־recent (עד חמישה), כדי שהיסטוריה ישנה רלוונטית לא תידחק.
כפילויות מקור וההודעה עצמה מסוננות. התקציב הסופי המשותף עם קונטקסט DOM נשאר
חמישה קטעים בני 300 תווים. `builder.mergeMemory` מפעיל את אותו מחטא שמות/טלפונים/מיילים
ומסמן כל קטע כ־candidate/dom_observed ובסוג draft/context/message.
זהות המחבר אינה מומצאת; sourceId, חשבון, מזהה שיחה ווקטורים אינם נכנסים ל־packet.
אין שינוי ב־ContextPacket v1, ב־confirmedFacts או במנוע הכללים.
ask_user נשאר מידע חסר; מנגנון השאלות הקיים בשרת מחליט מה לברר.

ה־packet המורחב מגיע באותו request.context ל־background/check-mode: למנוע המקומי או לענן שנבחר.
הוא כלול גם ב־cacheContext, כך ששינוי בתוצאות השליפה משנה את מפתח מטמון הבדיקה.
אין שינוי במימוש Ollama; ממשק זה נמסר לבן Ollama דרך supervise_prompt.

## התקנה וגבולות

- מתג נפרד כבוי כברירת מחדל. חייבים גם להפעיל זיכרון מקומי.
- בהגדרות מייבאים תיקיית r2-e5s עם config.json, tokenizer.json,
  tokenizer_config.json ו־onnx/model_quantized.onnx של emb8.
  נתיב BI-1 שנבדק: `D:\lhg-router-models\r2-e5s`.
- ארבעת הקבצים נבדקים מול SHA-256 קבוע לפני כתיבתם למטמון ייעודי.
  אין URL הורדה למודל הנתב ואין הורדת נתונים או קוד בעת inference.
- שלושת הספים מכוילים לתוצר emb8: 0.0336/0.1139/0.0367,
  מתוך summary_r2_int8.json (שם ניסוי היסטורי); אורכי tokenizer עד 96 tokens.
- תקציב inference: עד 150ms; לכל שליפה עד 50ms; עד שתי שליפות וסך 400ms.
  runtime מפסיק להמתין אחרי 450ms כולל מעבר ההודעה/תור ה־offscreen.
  timeout אינו מבטל WASM שכבר התחיל; תוצאה מאוחרת לא מתווספת לבקשה.
- כשל נתב או מודל חסר משאירים packet רגיל. כשל שליפה הוא unknown, לעולם לא false.
  אחרי restart, טעינה קרה יכולה לגרום לבדיקה הראשונה לוותר על הרחבה.
- טקסט ווקטורים ממשיכים להימחק באותה רשומה ב־memory.mjs; לא נוסף מאגר תוצאות שליפה.
- הזיכרון והמודל ניסיוניים; אין כאן בדיקת איכות חדשה או הבטחת latency על מחשב משתמש.

## בדיקות ושחזור

`node --test extension/*.test.cjs`: 160/160.
חמש בדיקות חדשות עם LocalMemory אמיתי ו־IndexedDB מדומה ובדיקת bridge:
שליפה scoped עד prepare ו־POST אמיתי של background עם fetch סינתטי,
מחיקת מקור, recent/search/none/ask_user, כשל ו־timeout, scope חסר,
הפרדת חשבונות/שיחות ושמירת זהות בזמן מעבר שיחה.

`research/local-memory/router-extension-test.mjs`: 15/15 ב־Chromium headless,
service worker + isolated content script + offscreen אמיתיים,
e5/WASM והנתב המאומן emb8. הודעה סינתטית בת 72 שעות הוחזרה מחיפוש עד ה־packet;
מידע מחשבון/שיחה אחרים לא הוחזר. ייבוא דרך options, hash שגוי, חסימת sender,
כיבוי וטעינה מחדש של offscreen מהמטמון נבדקו. אפס בקשות חיצוניות.
קריאת route+retrieval חמה בריצה האחרונה: כ־70ms, לא SLA.

להריץ מתוך research/local-memory אחרי npm ci / התקנת Chromium:
להגדיר LHG_TRANSFORMERS_DIR לתיקיית @xenova/transformers עם מטמון e5 קיים,
ו־LHG_ROUTER_DIR לתיקיית המודל המאומן, ואז `node router-extension-test.mjs`.
ב־BI-1 נעשה שימוש בתלויות playwright דרך junction מ־lhg-worktrees/local-memory-db;
נתוני e5 הגיעו ממטמון rnd-ctx/research/vector-poc.
תוצאות סינתטיות ללא טקסטים: router-extension-results.json.

engine: typecheck ו־366 בדיקות עברו, בדיקה חיה אחת דולגה.
proxy: typecheck ו־75 בדיקות עברו, כולל workerd.
לקח runtime מתועד גם ב־AGENTS.md: customCache של transformers.js דורש match וגם put;
בטעינת מודל הנתב יש לשמר גם גישה למטמון embeddings.

## שילוב

לבצע cherry-pick של commit המשימה אל ענף השילוב; לתאם חפיפות ב־options.*,
settings.js ו־i18n.js עם בן Ollama. אין חפיפה ב־background.js או check-mode.js.
לא בוצעו merge, bump לגרסה, deployment או העתקה לתיקיית התוסף הפעילה.
