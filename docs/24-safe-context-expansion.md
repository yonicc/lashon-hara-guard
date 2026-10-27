# הרחבת בירור בטוחה לאחר e9702c6

מצב: מימוש מקומי לביקורת; לא נפרס ולא אושר עדיין בידי המבקר העצמאי. כל התוצאות live_draft בלבד.

אימות השילוב: engine typecheck נקי,164 בדיקות (163pass,1live skip), proxy typecheck נקי ו51/51, extension78/78. facts93,map381,drift0; גם refresh-coverage --check נקי וgit diff --check נקי. המבקר353cce03f87b ניסה להתחיל אך נחסם ב־workspace credits, ולכן אין עדיין אישור עצמאי לקומיט החדש. main/Worker/תוסף נשארו e9702c6/0.8.2.

הכרעת איחוד שתוקנה: message.has_two_interpretations מופה בעבר אל has_favorable_interpretation. קריאת א ג:ב וב ב:ב מחייבת הפרדה בין שני פירושים לשוניים לבין צד זכות למעשה. הערך הישן במפת האיחוד הוחלף, ולא נוסף לצד אותו מפתח; תשע רשומות חדשות ועוד החלפת הכרעה קיימת מביאות למפה381. בדיקות FACT-VOCAB02/08 מאמתות מקורות ויעד נפרד לכל אחת מעשר ההבחנות.

נוספו עשר עובדות user-only, ברגישות medium, ללא התמדה. אין להפיק אותן מהצעות מודל. האוצר93 והקטלוג98; 14 תזכורות חדשות בחבילה תשיעית,134 בסך הכול. העלאת תקרת CC06 מבוססת על ההבחנות הבאות, ולא על עקיפת drift.

| עובדה | מקור | ההבחנה |
|---|---|---|
| message.reports_action_against_third_party | ב ג:ג, ב ט:ט | אדם שלישי שהדיווח נגדו אינו הנמען הנוכחי; שער RECHILUT הקודם עסק בנמען |
| message.identifies_informant_to_original_speaker | ב ג:ב | זיהוי מעביר הדברים לדובר המקורי, מפורש או מההקשר |
| message.has_two_interpretations | א ג:ב, ב ב:ב | שני פירושים, אחד נטול גנאי; אינו זהה לרמז או צד זכות למעשה |
| message.delivery_conveys_disparaging_interpretation | א ג:ב, ב ב:ב | אופן המסירה הנוכחי, ולא נכונות לומר בפניו או כוונת שנאה |
| audience.has_prior_conflict_with_reported_actor | ב ב:ב | שנאה קיימת בין שני תפקידים מסוימים, ולא תיוג הנמען כנרגן |
| evidence.signs_directly_relate_to_report | א ז:יא, ב ו:ט | קשר ממש לפרטי הסיפור ולא סימן רחוק |
| listener.personally_observed_signs | א ז:יא, ב ו:ט | המקבל עצמו ראה את הסימנים; ידיעה עצמית של המספר אינה ממלאת זאת |
| listener.plans_to_relay_report | א ז:יב, ב ו:ט | פעולה מתוכננת של העברה, בנפרד מאמונה או מפגיעה |
| context.inquiry_purpose_disclosed_to_source | א ד:יא | מטרת השאלה נמסרה לנשאל, ולא רק קיימת אצל השואל |
| context.inquiry_source_has_conflict_of_interest | א ד:יא | הנשאל שונא או מתחרה; העדר ניגוד עניינים אינו הוכחת אמינות |

16 בדיקות מנוע חדשות עוברות דרך validateExtraction → store → CC_ALL: שישה מצבים לכל טריגר, שער זיהוי, דחיית הצעות מודל, שאלה אחת ו־draft. נוספו שלוש בדיקות handler למסירה עקיפה, סימנים/דו־משמעות ומטרת בירור.

אין גרף זהויות או מעקב שרשרת חוצה־שיחות; המשתמש מאשר את התפקידים לכל הודעה. אין זיהוי אוטומטי של קול ותנועות או היתר לדו־משמעות. אין אימות משקל ראיות, הכרעת בית דין, מעמד עדות או קניין. בירורים חיוביים אינם מסלול היתר. נרגנות לאורך זמן, נחיצות כל נשאל ותנאי התועלת המלאים נשארים במטריצה כפיתוח חסר או בירור מוסמך לפי מקורם, ולא הוסתרו כבלתי ניתנים לייצוג.

המפה המעודכנת:104 partial_semantic,73 documentary. אין טענת מימוש מלא של177. המיפוי המיוצר מתחדש באמצעות scripts/refresh-coverage.mts; נימוקי המקור והמגבלות נשארים מידע נבדק ידנית ב־sourceCoverage.json. הפקת המפה והטבלה אינה סקירה פרשנית.

פקודות משורש הפרויקט:
```powershell
py rules\chafetz-chaim\consolidate_facts.py --check
cd engine
node --import tsx ../scripts/refresh-coverage.mts --check
npm run typecheck
npm test
cd ../proxy
npm run typecheck
npm test
cd ..
node --test extension/*.test.cjs
```
