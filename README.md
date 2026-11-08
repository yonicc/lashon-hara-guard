# שמירת הדיבור — תוסף דפדפן (שם עבודה)

מאגר ציבורי. גרסה חיה נוכחית: 0.17.2 (Chrome + Firefox) — תוסף, מנוע כללים ומסווג פעילים.
מטרת המוצר: לסייע בזיהוי חששות הנוגעים ללשון הרע בהיבט ההלכתי והמשפטי, באמצעות תוכן ההודעה והקשר השיחה.

**Hackathon submission (English): [SUBMISSION.md](SUBMISSION.md)** — what it does, how Meta models are used, and judge install steps.

## מסמכים
[מסווג משמעות מקומי — מדידות ומגבלות](docs/51-local-decider.md).
[חוב טכני ותנאי שחרור](docs/TECH-DEBT.md).
מדיניות עדכנית: [Privacy Policy / מדיניות פרטיות](PRIVACY.md) — אחסון מקומי ועיבוד מרוחק של בדיקות הודעות.

1. [מטרות ודרישות](docs/01-product.md)
2. [קונטקסט ומנגנון בירור](docs/02-context.md)
3. [מקורות ומנוע כללים](docs/03-rules.md)
4. [ארכיטקטורה ופרטיות](docs/04-architecture.md)
5. [תרחישים וקריטריוני קבלה](docs/05-acceptance.md)
6. [החלטות, שאלות ותוכנית עבודה](docs/06-decisions.md)
7. [סקירה ביקורתית של מנוע הכללים (הצעות)](docs/07-review-opus.md)
8. [ארכיטקטורה סופית ובניית המנוע](docs/08-architecture-final.md) — ליבת `engine/` ממומשת עם כללי ניתוב־טיוטה בלבד; אין כלל מאושר

## מקורות וקרדיט
טקסט החפץ חיים (חלק א׳ הלכות לשון הרע כללים א׳–י׳, חלק ב׳ הלכות רכילות כללים א׳–ט׳) נלקח מ־[Sefaria](https://www.sefaria.org/Chafetz_Chaim), מהדורת "Chofetz Chaim" בעברית, שמקורה לפי ספריא ב[ויקיטקסט העברי](https://he.wikisource.org/wiki/%D7%97%D7%A4%D7%A5_%D7%97%D7%99%D7%99%D7%9D), ברישיון **CC BY-SA**. שכבת המקור: [sources/chafetz-chaim](sources/chafetz-chaim/README.md). התוסף נושא את אותו קרדיט: `extension/vendor/chafetz-chaim-sefaria-LICENSE.txt`, דף ההגדרות ותצוגת ההפניה. התקצירים, השאלות והכרטיסים הם ניסוח טיוטה של הפרויקט ואינם חלק מהמקור.

**שיתוף זהה (החלטת הבעלים 2026-11-08):** קובצי הנתונים הנגזרים מטקסט המקור — `sources/chafetz-chaim/`, `rules/chafetz-chaim/`, `engine/src/chafetzChaim/*.json`, `engine/src/chafetzChaim/referralData.ts` ותקצירי/ציטוטי הסעיפים שבתוסף — מופצים ברישיון [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), עם הייחוס לעיל. הרישיון חל על הנתונים האלה בלבד, ולא על קוד התוכנה.

## בסיס האפיון
שיחת התכנון המקורית: 43f1c3aa368e.
דרישות המשתמש מופיעות בנפרד מהצעות העוזר. התרחיש של ביקורת על שיעור הוא דרישת בסיס למנגנון השלמת הקונטקסט.
