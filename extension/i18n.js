// The ONE home of every user-facing extension string (en/he) and of the UI
// language. Owner's decision 2026-10-27: English is the default; the user
// switches with a clear "עברית" / "English" button, stored in
// chrome.storage.local ("lhgLang"). Loaded first in every content script,
// in options/popup, and by background.js (which sends `lang` in POST /check
// so the engine writes its explanation in the same language).
// Server-provided rule texts (findings, catalog questions, limitations) stay
// as the proxy sends them; only the extension's own strings live here.
(() => {
  if (globalThis.LHG_I18N) return;
  const STORE_KEY = 'lhgLang';
  const DEFAULT_LANG = 'en';
  const LANGS = ['en', 'he'];

  const DICT = {
    en: {
      'brand': 'Lashon Hara Guard',
      'lang.other': 'עברית',
      'lang.otherTitle': 'החלף לעברית',
      'close': 'Close',
      'failed': 'Failed',
      'drag': 'Drag to move',
      'resize': 'Drag to resize',
      'you': 'you',
      'audience.private': 'a private conversation',
      'audience.group': 'a group',
      'audience.public': 'a public post',
      'detail.speaker': 'Who says it: {v}',
      'detail.subject': 'About whom: {v}',
      'detail.audience': 'To whom: {v}',
      'detail.claim': 'What is said about them: {v}',
      'detail.why': 'Why it may read as disparaging: {v}',
      'detail.ctxN': '{n} earlier messages in the conversation were taken into account.',
      'detail.ctx0': 'The message was checked on its own, without the conversation context.',
      'details.show': 'Details: who, about whom and why ▾',
      'details.hide': 'Hide details ▴',
      'noFurtherNote': 'No further note under the draft rules; this is not a ruling.',
      'rules.title': 'Chafetz Chaim rules (draft, not reviewed by an expert):',
      'rules.notChecked': 'The rules were not checked.',
      'rules.source': ' Source: ',
      'rules.question': 'Clarifying question: {q}',
      'warn.title': '⚠️ Note: this message may be understood as disparaging',
      'warn.mech': 'How: {v}',
      'warn.because': 'Because of: {v}',
      'warn.reminder': 'This is a reminder to reconsider the wording, not a halachic ruling.',
      'unsure.title': 'ℹ️ There may be an unintended meaning here',
      'unsure.check': 'Worth checking: {v}',
      'unsure.ask': 'How would the person being spoken about understand this?',
      'reminderOnly': 'This is only a reminder, not a halachic ruling.',
      'notChecked.title': 'The message was not checked',
      'notChecked.body': 'There is no connection to the checking server right now. That does not mean it has no problem.',
      'notConfigured.title': 'Lashon Hara Guard is not set up',
      'notConfigured.body': 'Open the extension settings and paste your access key.',
      'none.title': 'No alert in this check',
      'none.body': 'This is not a ruling, and not a statement that the text has no problem.',
      'unknown.title': 'The text was not checked',
      'unknown.body': 'No recognised answer came from the checking server. That does not mean it has no problem.',
      'recheck': '…Checking again with your answer',
      'checkingText': '…Checking the text',
      'checkingDraft': '…Checking the wording',
      'copyDiag': 'Copy diagnostics for the developer',
      'copied': 'Copied ✓ (page structure only, no message content)',
      'copyFailed': 'Copy failed',
      'active.title': 'Lashon Hara Guard is active on this page',
      'active.howto': 'To check text manually: select it on the page and press the panel shortcut again.',
      'off.title': 'Lashon Hara Guard is off on this site',
      'off.body': 'Nothing on this site is checked. You can turn it on here or from the extension icon.',
      'off.enable': 'Turn on',
      'note.placeholder': 'Add context or ask a question (e.g. "he is my brother", "I want advice on how to help")…',
      'note.send': 'Send',
      'note.hintWithText': 'Sent together with the last checked text (up to {max} characters).',
      'note.hintNoText': 'Nothing was checked yet: what you write here is checked as text.',
      'note.sending': '…Checking again with your note',
      'note.yours': 'Your note: {v}',
      'mech.irony': 'irony',
      'mech.praise': 'praise that may sound mocking',
      'mech.hint': 'a hint that identifies a person',
      'mech.mockery': 'mockery',
      'mech.omission': 'an omission that implies something',
      'mech.direct': 'direct criticism',
      'mech.other': 'a possible negative meaning',
      'tag.checking': '…checking',
      'tag.warn': '⚠️ may be understood as disparaging — not a ruling',
      'tag.unsure': 'ℹ️ there may be an unintended meaning',
      'tag.not_checked': 'not checked',
      'tag.unchecked_overflow': 'not checked (too many checks)',
      'tag.title': 'Lashon Hara Guard: a reminder only, not a halachic ruling.',
      'hold.pending': '⏳ Incoming message is being checked before it is shown…',
      'hold.warn': '⚠️ Message hidden: it may be understood as disparaging',
      'hold.unsure': 'ℹ️ Message hidden: it may carry an unintended meaning',
      'hold.not_checked': 'The message was not checked (no connection or too many checks), so it stays hidden',
      'reveal.warn': 'Show anyway',
      'reveal.unsure': 'Show anyway',
      'reveal.not_checked': 'Show unchecked',
      'hold.why': 'Why?',
      'hold.note': 'A reminder only, not a halachic ruling.',
      'wa.noChat': 'No open conversation was detected. Open a chat and try again.',
      'wa.noTitle': 'A conversation is open, but its name was not detected, so the conversation context is not collected.',
      'wa.chat': 'Open conversation: "{title}" (conversation context active)',
      'wa.visible': 'Visible messages detected: {in} incoming, {out} outgoing, {b} with sender details.',
      'wa.compose': 'The compose box was detected; new typing is checked automatically after a short pause.',
      'wa.noCompose': 'The compose box was not detected; automatic checking while typing is not active now.',
      'wa.composeLost.title': 'The extension cannot find the compose box',
      'wa.composeLost.body': 'The page structure changed, so checking while typing is paused. The message was not checked.',
      'g.rows': 'The extension is active and detects messages on this page. New messages are checked automatically and tagged.',
      'g.noRows': 'The extension is active, but no open e-mail or chat message was detected. Open a message or a conversation and try again. This is not shown as a successful check.',
      'g.inChat': 'A chat conversation inside Gmail was detected; only new messages in it are checked, folder rows are not scanned.',
      'g.manual': 'To check manually: select the message text on the page and press the panel shortcut (Ctrl+Shift+L).',
      'g.compose': 'The chat compose box was detected; typing is checked automatically after a short pause.',
      'g.noCompose': 'The chat compose box was not detected; checking while typing is not active now.',
      'g.convId': 'The conversation ID was detected: the conversation context (earlier messages, participants) is collected locally and sent redacted.',
      'g.noConvId': 'The conversation ID was not detected ({n} candidates), so each message is checked on its own, without the conversation context.',
      'g.frames': 'Open chat windows on the page: {n}. They load in a separate frame — to see the conversation status, click inside the chat window and then press the panel shortcut.',
      'opt.pageTitle': 'Lashon Hara Guard — Settings',
      'opt.tagline': 'A gentle reminder while you write and next to incoming messages. Never a halachic ruling.',
      'card.general': 'General',
      'opt.enabled': 'Lashon Hara Guard is on',
      'opt.enabledHint': 'Turning it off stops every check on every site at once.',
      'card.platforms': 'Sites',
      'plat.whatsapp-web': 'WhatsApp Web',
      'plat.gmail': 'Gmail (e-mail and the Chat panel in the mailbox)',
      'plat.google-chat': 'Google Chat (including Chat windows inside Gmail)',
      'card.incoming': 'Incoming messages',
      'opt.hideIncoming': 'Hide incoming chat messages until they are checked',
      'opt.hideIncomingHint': 'A message that may be understood as disparaging, or that was not checked, stays hidden until you press "show". E-mail is never hidden.',
      'card.language': 'Language',
      'opt.langHint': 'The panel, the tags and the explanations from the checking server use this language.',
      'card.account': 'Account and access key',
      'opt.accessKey': 'Access key',
      'opt.proxyUrl': 'Checking server URL',
      'opt.accountLink': 'Manage your personal key and balance at lhg.ysho.uk',
      'opt.save': 'Save',
      'opt.test': 'Test connection',
      'opt.saved': 'Saved ✓',
      'opt.testing': '…Testing',
      'opt.noReply': 'No reply from the extension',
      'opt.testOk': 'Connection works ✓ (the test message was flagged as ironic)',
      'opt.keyBad': 'The access key is missing or wrong',
      'opt.noConn': 'No connection: {e}',
      'opt.reply': 'Reply received: {r}',
      'card.panel': 'Check panel',
      'opt.openPanel': 'Open the panel in the current tab',
      'opt.needTab': 'First open WhatsApp Web (or Gmail / Google Chat) and click the extension icon from there.',
      'opt.noScript': 'The extension is not active in this tab. Refresh the page (F5) after reloading the extension, and try again.',
      'opt.opened': 'The panel opened on the page ✓',
      'opt.shortcut': 'Panel keyboard shortcut: {k}',
      'opt.noShortcut': 'No keyboard shortcut is set for the panel. Set one at chrome://extensions/shortcuts, or use the button above.',
      'opt.resetPanel': 'Reset the panel position and size',
      'opt.resetDone': 'Panel position and size reset ✓',
      'opt.footer': 'The extension only shows reminders and never blocks sending. It is not a halachic ruling.',
      'opt.allSettings': 'All settings',
      'status.on': 'Lashon Hara Guard: on ✓',
      'status.off': 'Lashon Hara Guard: off — nothing is checked',
      'status.hideOn': 'Hiding incoming messages: on ✓',
      'status.hideOff': 'Hiding incoming messages: off',
    },
    he: {
      'brand': 'Lashon Hara Guard',
      'lang.other': 'English',
      'lang.otherTitle': 'Switch to English',
      'close': 'סגור',
      'failed': 'נכשל',
      'drag': 'גרור להזזה',
      'resize': 'גרור לשינוי גודל',
      'you': 'אתה',
      'audience.private': 'שיחה פרטית',
      'audience.group': 'קבוצה',
      'audience.public': 'פרסום פומבי',
      'detail.speaker': 'מי אומר: {v}',
      'detail.subject': 'על מי: {v}',
      'detail.audience': 'למי: {v}',
      'detail.claim': 'מה נאמר עליו: {v}',
      'detail.why': 'למה זה עלול להתפרש כגנאי: {v}',
      'detail.ctxN': 'נלקחו בחשבון {n} הודעות קודמות בשיחה.',
      'detail.ctx0': 'ההודעה נבדקה לבדה, בלי הקשר השיחה.',
      'details.show': 'פרטים: מי, על מי ולמה ▾',
      'details.hide': 'הסתר פרטים ▴',
      'noFurtherNote': 'לא נמצאה הערה נוספת לפי כללי הטיוטה; אינו פסק.',
      'rules.title': 'כללי חפץ חיים (טיוטה, לא נבדקו בידי מומחה):',
      'rules.notChecked': 'הכללים לא נבדקו.',
      'rules.source': ' מקור: ',
      'rules.question': 'שאלת בירור: {q}',
      'warn.title': '⚠️ שים לב: ההודעה עלולה להתפרש כגנאי',
      'warn.mech': 'אופן: {v}',
      'warn.because': 'בגלל: {v}',
      'warn.reminder': 'זו תזכורת לשקול ניסוח, לא פסיקה הלכתית.',
      'unsure.title': 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת',
      'unsure.check': 'כדאי לבדוק: {v}',
      'unsure.ask': 'איך יבין את זה מי שמדברים עליו?',
      'reminderOnly': 'זו תזכורת בלבד, לא פסיקה הלכתית.',
      'notChecked.title': 'ההודעה לא נבדקה',
      'notChecked.body': 'אין חיבור לשרת הבדיקה כרגע. זה לא אומר שאין בה בעיה.',
      'notConfigured.title': 'Lashon Hara Guard לא מוגדר',
      'notConfigured.body': 'פתח את הגדרות התוסף והדבק את מפתח הגישה.',
      'none.title': 'לא התקבלה התראה בבדיקה זו',
      'none.body': 'אין בכך פסיקה, ואין זו קביעה שאין בטקסט בעיה.',
      'unknown.title': 'הטקסט לא נבדק',
      'unknown.body': 'לא התקבלה תשובה מזוהה משרת הבדיקה. זה לא אומר שאין בו בעיה.',
      'recheck': '…בודק שוב לפי התשובה',
      'checkingText': '…בודק את הטקסט',
      'checkingDraft': '…בודק ניסוח',
      'copyDiag': 'העתק אבחון למפתח',
      'copied': 'הועתק ✓ (מבנה הדף בלבד, בלי תוכן הודעות)',
      'copyFailed': 'ההעתקה נכשלה',
      'active.title': 'Lashon Hara Guard פעיל בעמוד זה',
      'active.howto': 'לבדיקה ידנית של טקסט: סמן אותו בעמוד ולחץ שוב על קיצור הפאנל.',
      'off.title': 'Lashon Hara Guard כבוי באתר זה',
      'off.body': 'שום דבר באתר הזה לא נבדק. אפשר להפעיל כאן או דרך אייקון התוסף.',
      'off.enable': 'הפעל',
      'note.placeholder': 'הוסף הקשר או שאל שאלה (למשל: ״הוא אחי״, ״אני מתייעץ איך לעזור״)…',
      'note.send': 'שלח',
      'note.hintWithText': 'נשלח יחד עם הטקסט האחרון שנבדק (עד {max} תווים).',
      'note.hintNoText': 'עוד לא נבדק טקסט: מה שתכתוב כאן ייבדק כטקסט.',
      'note.sending': '…בודק שוב עם ההערה שלך',
      'note.yours': 'ההערה שלך: {v}',
      'mech.irony': 'אירוניה',
      'mech.praise': 'שבח שעלול להישמע כלעג',
      'mech.hint': 'רמז שמזהה אדם',
      'mech.mockery': 'לעג',
      'mech.omission': 'השמטה שמרמזת',
      'mech.direct': 'ביקורת ישירה',
      'mech.other': 'משמעות שלילית אפשרית',
      'tag.checking': '…נבדקת',
      'tag.warn': '⚠️ עלולה להתפרש כגנאי — אינה פסיקה',
      'tag.unsure': 'ℹ️ ייתכן שיש כאן משמעות לא מכוונת',
      'tag.not_checked': 'לא נבדק',
      'tag.unchecked_overflow': 'לא נבדק (עומס בדיקות)',
      'tag.title': 'Lashon Hara Guard: תזכורת בלבד, אינה פסיקה הלכתית.',
      'hold.pending': '⏳ הודעה נכנסת נבדקת לפני הצגה…',
      'hold.warn': '⚠️ ההודעה הוסתרה: היא עלולה להתפרש כגנאי',
      'hold.unsure': 'ℹ️ ההודעה הוסתרה: ייתכן שיש בה משמעות לא מכוונת',
      'hold.not_checked': 'ההודעה לא נבדקה (אין חיבור או עומס בדיקות), ולכן היא מוסתרת',
      'reveal.warn': 'הצג בכל זאת',
      'reveal.unsure': 'הצג בכל זאת',
      'reveal.not_checked': 'הצג בלי בדיקה',
      'hold.why': 'למה?',
      'hold.note': 'תזכורת בלבד, לא פסיקה הלכתית.',
      'wa.noChat': 'לא זוהתה שיחה פתוחה. פתח שיחה ונסה שוב.',
      'wa.noTitle': 'יש שיחה פתוחה, אבל שם השיחה לא זוהה, ולכן הקשר השיחה לא נאסף.',
      'wa.chat': 'שיחה פתוחה: ״{title}״ (הקשר שיחה פעיל)',
      'wa.visible': 'הודעות גלויות שזוהו: {in} נכנסות, {out} יוצאות, {b} עם פרטי שולח.',
      'wa.compose': 'שורת הכתיבה זוהתה; הקלדה חדשה תיבדק אוטומטית אחרי הפסקה קצרה.',
      'wa.noCompose': 'שורת הכתיבה לא זוהתה; הבדיקה האוטומטית בזמן כתיבה אינה פעילה כעת.',
      'wa.composeLost.title': 'התוסף לא מזהה את שורת הכתיבה',
      'wa.composeLost.body': 'מבנה העמוד השתנה, לכן הבדיקה בזמן כתיבה מושהית. ההודעה לא נבדקה.',
      'g.rows': 'התוסף פעיל ומזהה הודעות בעמוד. הודעות חדשות ייבדקו אוטומטית ויתווספו לידן תגיות.',
      'g.noRows': 'התוסף פעיל, אך כרגע לא זוהתה הודעת דוא״ל/צ׳אט פתוחה. פתח הודעה או שיחה ונסה שוב. מצב זה אינו מוצג כבדיקה תקינה.',
      'g.inChat': 'שיחת צ׳אט בתוך ג׳ימייל זוהתה; רק הודעות חדשות בשיחה ייבדקו, שורות תיקייה לא ייסרקו.',
      'g.manual': 'לבדיקה ידנית: סמן את טקסט ההודעה בעמוד ולחץ על קיצור הפאנל (Ctrl+Shift+L).',
      'g.compose': 'שורת הכתיבה של הצ׳אט זוהתה; הקלדה תיבדק אוטומטית אחרי הפסקה קצרה.',
      'g.noCompose': 'שורת הכתיבה של הצ׳אט לא זוהתה; הבדיקה בזמן כתיבה אינה פעילה כעת.',
      'g.convId': 'מזהה השיחה זוהה: הקשר השיחה (הודעות קודמות, משתתפים) נאסף מקומית ונשלח מוסתר.',
      'g.noConvId': 'מזהה השיחה לא זוהה ({n} מועמדים), ולכן כל הודעה נבדקת לבדה, בלי הקשר השיחה.',
      'g.frames': 'חלונות צ׳אט פתוחים בעמוד: {n}. הם נטענים במסגרת נפרדת — כדי לראות את מצב השיחה, לחץ בתוך חלון הצ׳אט ואז על קיצור הפאנל.',
      'opt.pageTitle': 'Lashon Hara Guard — הגדרות',
      'opt.tagline': 'תזכורת עדינה בזמן כתיבה וליד הודעות נכנסות. לעולם אינה פסיקה הלכתית.',
      'card.general': 'כללי',
      'opt.enabled': 'Lashon Hara Guard פעיל',
      'opt.enabledHint': 'כיבוי עוצר מיד כל בדיקה בכל האתרים.',
      'card.platforms': 'אתרים',
      'plat.whatsapp-web': 'WhatsApp Web',
      'plat.gmail': 'Gmail (דוא״ל ופאנל הצ׳אט בתיבת הדואר)',
      'plat.google-chat': 'Google Chat (כולל חלונות צ׳אט בתוך Gmail)',
      'card.incoming': 'הודעות נכנסות',
      'opt.hideIncoming': 'הסתר הודעות צ׳אט נכנסות עד שייבדקו',
      'opt.hideIncomingHint': 'הודעה שעלולה להתפרש כגנאי, או שלא נבדקה, נשארת מוסתרת עד שתלחץ ״הצג״. הודעות דוא״ל אינן מוסתרות.',
      'card.language': 'שפה',
      'opt.langHint': 'הפאנל, התגיות וההסברים משרת הבדיקה יוצגו בשפה זו.',
      'card.account': 'חשבון ומפתח גישה',
      'opt.accessKey': 'מפתח גישה',
      'opt.proxyUrl': 'כתובת שרת הבדיקה',
      'opt.accountLink': 'ניהול המפתח האישי והיתרה ב-lhg.ysho.uk',
      'opt.save': 'שמור',
      'opt.test': 'בדיקת חיבור',
      'opt.saved': 'נשמר ✓',
      'opt.testing': '…בודק',
      'opt.noReply': 'אין תשובה מהתוסף',
      'opt.testOk': 'החיבור עובד ✓ (הודעת הבדיקה זוהתה כאירונית)',
      'opt.keyBad': 'מפתח הגישה חסר או שגוי',
      'opt.noConn': 'אין חיבור: {e}',
      'opt.reply': 'התקבלה תשובה: {r}',
      'card.panel': 'פאנל הבדיקה',
      'opt.openPanel': 'פתח את הפאנל בלשונית הנוכחית',
      'opt.needTab': 'פתח קודם את WhatsApp Web (או Gmail/Google Chat) ולחץ על אייקון התוסף מתוכו.',
      'opt.noScript': 'התוסף לא פעיל בלשונית הזו. רענן את העמוד (F5) אחרי טעינה מחדש של התוסף, ונסה שוב.',
      'opt.opened': 'הפאנל נפתח בעמוד ✓',
      'opt.shortcut': 'קיצור מקלדת לפאנל: {k}',
      'opt.noShortcut': 'לא מוגדר קיצור מקלדת לפאנל. אפשר להגדיר ב־chrome://extensions/shortcuts, או להשתמש בכפתור שלמעלה.',
      'opt.resetPanel': 'אפס מיקום וגודל של הפאנל',
      'opt.resetDone': 'מיקום וגודל הפאנל אופסו ✓',
      'opt.footer': 'התוסף מציג תזכורת בלבד ואינו חוסם שליחה. אינו פסיקה הלכתית.',
      'opt.allSettings': 'כל ההגדרות',
      'status.on': 'Lashon Hara Guard: פעיל ✓',
      'status.off': 'Lashon Hara Guard: כבוי — שום דבר לא נבדק',
      'status.hideOn': 'הסתרת הודעות נכנסות: פעילה ✓',
      'status.hideOff': 'הסתרת הודעות נכנסות: כבויה',
    },
  };

  let lang = DEFAULT_LANG;
  const listeners = [];

  const normalize = (l) => (LANGS.includes(l) ? l : null);
  const dir = (l = lang) => (l === 'he' ? 'rtl' : 'ltr');

  // t('key', {v: 'x'}): current language, English fallback, the key itself last.
  function t(key, vars) {
    let s = DICT[lang][key];
    if (s == null) s = DICT.en[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }

  const mechanism = (m) => (m && DICT.en['mech.' + m] != null ? t('mech.' + m) : '');

  // A string written in Hebrew by a caller not yet migrated to t() (e.g. a
  // shared watcher in another branch): shown in the current language when it
  // is one of the dictionary's Hebrew values. Anything else is returned as is.
  function localize(s) {
    if (typeof s !== 'string' || lang === 'he') return s;
    for (const [k, v] of Object.entries(DICT.he)) if (v === s) return t(k);
    return s;
  }

  function fire() {
    for (const fn of listeners.slice()) {
      try { fn(lang); } catch (_e) { /* one listener never breaks the others */ }
    }
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  function storage() {
    try { return chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (_e) { return null; }
  }

  // persist=false: tests and one-off rendering; the stored choice is untouched.
  function setLang(l, { persist = true } = {}) {
    const next = normalize(l);
    if (!next) return lang;
    const changed = next !== lang;
    lang = next;
    if (persist) {
      const st = storage();
      try { if (st) st.set({ [STORE_KEY]: next }); } catch (_e) { /* storage unavailable */ }
    }
    if (changed) fire();
    return lang;
  }

  // data-i18n="key" -> textContent, data-i18n-ph -> placeholder,
  // data-i18n-title -> title; <html lang/dir> follow the language.
  function apply(doc = globalThis.document) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    for (const el of doc.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
    for (const el of doc.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    for (const el of doc.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    const html = doc.documentElement;
    if (html && typeof html.setAttribute === 'function') {
      html.setAttribute('lang', lang);
      html.setAttribute('dir', dir());
    }
  }

  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  try {
    const st = storage();
    if (st) {
      st.get([STORE_KEY], (s) => {
        const l = normalize(s && s[STORE_KEY]);
        if (l && l !== lang) { lang = l; fire(); }
        readyResolve(lang);
      });
    } else {
      readyResolve(lang);
    }
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area && area !== 'local') return;
      if (!ch || !ch[STORE_KEY]) return;
      const l = normalize(ch[STORE_KEY].newValue) || DEFAULT_LANG;
      if (l !== lang) { lang = l; fire(); }
    });
  } catch (_e) {
    readyResolve(lang); // tests / no storage: keep the default
  }

  globalThis.LHG_I18N = {
    t, dir, mechanism, localize, setLang, onChange, apply, normalize,
    lang: () => lang, ready: () => ready, DICT, LANGS, STORE_KEY, DEFAULT_LANG,
  };
})();
