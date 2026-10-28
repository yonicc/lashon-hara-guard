# Ollama מקומי בתוסף

## התקנה
1. התקן Ollama מ־https://ollama.com/download במחשב שבו Chrome רץ.
2. הפעל Ollama, או `ollama serve`. החיבור קבוע ל־`http://127.0.0.1:11434`; אין כתובת שרת מרוחק הניתנת להגדרה.
3. הורד במפורש את המודל הנחוץ:
```sh
ollama pull hf.co/yonicc/lhg-extractor-qwen7b-gguf:Q4_K_M
ollama pull hf.co/yonicc/lhg-extractor-dictalm-gguf:Q4_K_M
```
כל הורדה היא כ־4GB; union דורש את שניהם. התוסף אינו מתקין או מוריד מודלי Ollama.
4. לאחר שילוב ושחרור בידי המתאם: טען מחדש את התוסף ורענן את לשונית האתר. באפשרויות בחר local-fast (Qwen), local-hebrew (DictaLM), או local-union. ענן fallback נשאר כבוי כברירת מחדל.
5. אם Ollama מחזיר 403 בגלל Origin, הגדר את `OLLAMA_ORIGINS` ל־`chrome-extension://<extension-id>` המדויק המופיע ב־chrome://extensions והפעל את Ollama מחדש. אין צורך לפתוח שרת לרשת או להתיר כל Origin.

בדיקה: `curl http://127.0.0.1:11434/api/tags` צריכה להציג את שם המודל המדויק לעיל.
זמן inference מוגבל ל־60 שניות לכל מודל; בירור זמינות מוגבל לשתי שניות. מדידות המחקר ב־docs/40 אינן מדידה של המחשב המותקן.

## גבולות החיבור
- check-mode.js נשאר מקור הניתוב היחיד. ollama-register.js רושם את שני המנועים ברקע; אין נגיעה ב־memory/router או ב־UI.
- raw:true, stream:false וטמפרטורה 0. ההוראה והכינויים מיוצאים ישירות מ־probe_modal.instruction ומ־contract.json; אין עותק ידני של ההוראה. תבניות Qwen ו־DictaLM מרונדרות במתאם.
- request.context עובר sanitizeContextPacket ומצורף כבלוק נתונים לא מהימנים נפרד; userNote מצורף בנפרד ומוגבל ל־500 תווים. זו הרחבה לפרומפט האימון, שאינה טענת parity או איכות של חילוץ בהקשר. ראיות מתקבלות רק מתוך הטקסט הראשי.
- החוזה המאומן מחזיר alias:[boolean, quote], ללא confidence וללא הערכת משמעות. המתאם אינו ממציא ציון: validateExtraction/factPolicy דוחים את ההצעות עם confidence_missing_or_invalid (או confirmed_by_user_only). לכן **המודלים האלה עדיין אינם מספקים עובדות שניתן לקבל אוטומטית במנוע הקנוני**. נדרש חוזה מודל מתאים או מדיניות קבלה נפרדת שעברה סקירה כדי לשנות זאת; אין שינוי כזה בענף.
- בכל זאת inference מופעל בפועל, התשובה מאומתת, וכללי המוצר ושאלות ההמשך מופעלים דרך runLiveRules ו־alertFor המקוריים, כולל תשובות משתמש מפורשות. פלט ריק או תקין ללא הערכת משמעות מחזיר unsure, לעולם לא none. כלל קנוני יכול להעלות ל־warn.
- מפתח לא מוכר, טיפוס שגוי, ראיה שאינה בטקסט, JSON פגום, timeout או כשל HTTP גורמים לכשל בדיקה. אין fallback לענן אלא אם lhgCloudFallback=true. אין הרשאת localhost נוספת: רק 127.0.0.1:11434; אין redirects או credentials.

## בנייה ובדיקות
```sh
npm --prefix engine ci
node scripts/build-ollama.mjs
node scripts/build-ollama.mjs --check
node --test extension/*.test.cjs
npm --prefix engine run typecheck
npm --prefix engine test
npm --prefix proxy ci
npm --prefix proxy run typecheck
npm --prefix proxy test
node scripts/test-ollama-browser.mjs /path/to/package-with-playwright/package.json
```
הבנייה דורשת Python 3 (`py` ב־Windows). אין צורך ב־Modal או בחבילות Python: סקריפט הייצוא קורא AST של פונקציית ההוראה בלבד. bundle הדפדפן נבנה מהמקור ב־esbuild; evaluate משתמש ב־SHA-256 נייד מ־@noble/hashes גם ב־Node, עם אותו פלט hash. אין עריכה של engine/dist.

בדיקת Chromium טוענת את התוסף האמיתי ב־MV3, ומפעילה שרת מדומה ב־127.0.0.1:11434; היא מסרבת לרוץ אם הפורט תפוס, ואינה מחליפה שרת קיים. היא מאמתת רישום, שלושה מצבים, כללים, כשל פלט ואפס fallback. זו אינה בדיקת מודל חי.

אימות בענף על בסיס origin/main: 169 בדיקות תוסף, 366 מנוע (+1 skip), 75 proxy; typecheck בשניהם ו־Chromium/MV3 עברו. בשילוב הזיכרון נבדקו גם 174 בדיקות תוסף לפני בידוד קומיט Ollama. ב־BI-1 לא נמצא executable של Ollama והפורט 11434 החזיר connection refused לפני הבדיקה המדומה; inference חי לא אומת. לא בוצע שחרור.
