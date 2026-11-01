// Kid-simple topic per group-D (rabbi referral) section, for the Simple
// referral view (owner 2026-11-01). One home for the short topic text:
// panel.js reads it, referral-topics.test.cjs checks every group-D section in
// engine/src/chafetzChaim/referralData.ts has an English topic.
// `en` is always set. `he` is set only where the server-side Hebrew topic
// (from implementedScopeHe) is missing or unusable; otherwise panel.js keeps
// the server's Hebrew topic.
(function () {
  'use strict';
  const T = {
    'p1_prin1:1': { en: 'Even if it is true' },
    'p1_prin1:2': { en: 'Many sins in one remark', he: 'הרבה איסורים בדיבור אחד' },
    'p1_prin1:3': { en: 'A habit of gossip' },
    'p1_prin1:5': { en: 'Asked by a parent or teacher' },
    'p1_prin1:6': { en: 'Fear of losing income' },
    'p1_prin1:7': { en: 'Fear of being mocked' },
    'p1_prin1:8': { en: 'Writing counts too' },
    'p1_prin1:9': { en: 'Blaming yourself too' },
    'p1_prin2:1': { en: 'Many listeners' },
    'p1_prin2:2': { en: 'Could be read two ways' },
    'p1_prin2:4': { en: 'Passing it along' },
    'p1_prin2:6': { en: 'Taking it to another town' },
    'p1_prin2:10': { en: 'A listener who will believe it' },
    'p1_prin3:2': { en: 'Words with a double meaning' },
    'p1_prin3:3': { en: 'Said as a joke' },
    'p1_prin3:7': { en: 'Judging favorably' },
    'p1_prin4:3': { en: 'A mistake, not on purpose' },
    'p1_prin4:4': { en: 'One hidden slip' },
    'p1_prin4:5': { en: 'Witnesses who can help' },
    'p1_prin4:7': { en: 'Does the person regret it?' },
    'p1_prin4:8': { en: 'Refusing a court ruling' },
    'p1_prin4:9': { en: 'Bad character traits' },
    'p1_prin5:4': { en: 'Someone\'s skill at work' },
    'p1_prin5:7': { en: 'Bad-mouthing products' },
    'p1_prin6:1': { en: 'Believing gossip' },
    'p1_prin6:3': { en: 'Why are you listening?' },
    'p1_prin6:8': { en: 'Agreeing with the gossip' },
    'p1_prin6:11': { en: 'Be careful, do not punish' },
    'p1_prin7:2': { en: 'Said in front of them' },
    'p1_prin7:3': { en: 'Many people said it' },
    'p1_prin7:5': { en: 'Someone known as wicked', he: 'מי שהוחזק כרשע' },
    'p1_prin7:7': { en: 'A trusted teller' },
    'p1_prin7:13': { en: 'Theft suspect and the court', he: 'חשד גניבה ובית דין' },
    'p1_prin7:14': { en: 'Reporting a theft suspect', he: 'מסירת חשוד בגניבה' },
    'p1_prin8:1': { en: 'A family member' },
    'p1_prin8:3': { en: 'Hurting a child' },
    'p1_prin8:4': { en: 'A Torah teacher' },
    'p1_prin8:5': { en: 'Someone outside "your people"', he: 'מי שיצא מכלל ״עמיתך״' },
    'p1_prin8:7': { en: 'Known in town as wicked', he: 'מוחזק בעיר כרשע' },
    'p1_prin8:12': { en: 'Listeners who may harm' },
    'p1_prin8:13': { en: 'Clever mocking' },
    'p1_prin9:5': { en: 'Teaching children' },
    'p1_prin10:2': { en: 'Proof first' },
    'p1_prin10:3': { en: 'Doing the same thing yourself' },
    'p1_prin10:7': { en: 'Telling when a warning won\'t help' },
    'p1_prin10:8': { en: 'Fear of being hurt' },
    'p1_prin10:9': { en: 'Known for honest speech' },
    'p1_prin10:11': { en: 'Complaining about being hurt' },
    'p1_prin10:16': { en: 'Answering gossip about you' },
    'p2_prin1:1': { en: 'Tale-bearing', he: 'הולכת רכילות' },
    'p2_prin1:4': { en: 'Tale-bearing, even if true' },
    'p2_prin1:5': { en: 'Asked by a parent or teacher' },
    'p2_prin1:6': { en: 'Fear of losing income' },
    'p2_prin1:7': { en: 'Fear of being mocked' },
    'p2_prin3:1': { en: 'Telling it to their face' },
    'p2_prin5:1': { en: 'Believing tale-bearing' },
    'p2_prin5:2': { en: 'Just listening to it' },
    'p2_prin5:6': { en: 'Judging favorably' },
    'p2_prin6:1': { en: 'Said in public' },
    'p2_prin6:2': { en: 'Said in front of them' },
    'p2_prin6:5': { en: 'Even a trusted teller', he: 'גם מספר נאמן' },
    'p2_prin6:6': { en: 'When may you believe it?', he: 'מתי מותר להאמין' },
    'p2_prin6:10': { en: 'Protecting or revenge?' },
    'p2_prin7:2': { en: 'About a Torah scholar' },
    'p2_prin7:4': { en: 'Listeners who may harm' },
    'p2_prin8:2': { en: 'Praise that causes anger' },
    'p2_prin9:1': { en: 'Warning about a partner' },
    'p2_prin9:4': { en: 'A warning that may backfire' },
    'p2_prin9:5': { en: 'After the deal is done' },
    'p2_prin9:6': { en: 'A listener who will act alone' },
    'p2_prin9:10': { en: 'Warning about a cheating shop', he: 'אזהרה מחנות רמאית' },
    'p2_prin9:11': { en: 'Telling after a purchase', he: 'גילוי אונאה אחרי קנייה' },
    'p2_prin9:13': { en: 'Taking the law into own hands', he: 'אונאה ועשיית דין לעצמו' },
  };
  globalThis.LHG_REFERRAL_TOPICS = {
    all: T,
    /** Short topic for a section key in 'he' or 'en'; '' when not mapped. */
    topic(key, lang) {
      const e = T[key];
      if (!e) return '';
      return (lang === 'he' ? e.he : e.en) || '';
    },
  };
})();
