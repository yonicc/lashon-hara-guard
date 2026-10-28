// Regression tests (0.9.0 detection):
//   (6) the user's OWN message must never be scanned/held as incoming
//       (Google Chat, Gmail-embedded Chat, WhatsApp), including the page's
//       echo of a message just sent from the compose box;
//   (5) Gmail e-mail: drafts are checked while typing (outgoing), opened
//       mail bodies are found (incoming), folder-list previews never are.
// Real content scripts run against synthetic DOM fixtures (mini-dom).
// Synthetic text only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocument, append } = require('./mini-dom.testlib.cjs');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Loads selectors + compose-watch + incoming + the adapter into one context.
function load({ host, pathname = '/', top = true, html, adapter }) {
  const document = createDocument(html);
  const sent = [];
  const ctx = vm.createContext({
    setTimeout, clearTimeout, setInterval: () => 0, Date, URL,
    KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    document,
    location: { hostname: host, pathname, href: 'https://' + host + pathname },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (m, cb) => { sent.push(m); if (cb) cb({ alert: 'none' }); },
        getManifest: () => ({ version: 'test' }),
      },
    },
    addEventListener() {},
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.top = top ? ctx : {};
  for (const f of ['selectors.js', 'compose-watch.js', 'incoming.js']) vm.runInContext(src(f), ctx);
  let scanner = null;
  ctx.LHG_INCOMING.observe = (s) => { scanner = s; };
  vm.runInContext(src(adapter), ctx);
  assert.ok(scanner, 'adapter registered its scanner');
  const checks = (direction) => sent.filter((m) => m.type === 'lhg-check' && (!direction || m.direction === direction));
  return { ctx, document, sent, checks, scan: () => scanner.scan() };
}

function typeInto(document, box, text) {
  box.textContent = text;
  document.dispatch('input', box);
}

const CHAT_AREA = `
<c-wiz id="area">
  <div jsname="m1"><div jsname="t1">שלום לכולם, מה נשמע היום</div></div>
  <div jsname="m2"><div jsname="t2">נפגשים מחר בשמונה בבוקר</div></div>
  <div id="compose" role="textbox" contenteditable="true" data-placeholder="הודעה"></div>
</c-wiz>`;

const OWN_BUBBLES = [
  ['explicit marker (data-is-self)', '<div jsname="m3" data-is-self="true"><div jsname="t3">הנה ההודעה ששלחתי לקבוצה הזאת</div></div>'],
  ['aria-label names the user', '<div jsname="m3" aria-label="You: הנה ההודעה ששלחתי לקבוצה הזאת"><div jsname="t3">הנה ההודעה ששלחתי לקבוצה הזאת</div></div>'],
  ['sender chip says "You"', '<div jsname="m3"><span data-member-id="u1">You</span><div jsname="t3">הנה ההודעה ששלחתי לקבוצה הזאת</div></div>'],
  ['Hebrew sender chip "את/ה"', '<div jsname="m3"><span data-name="me">את/ה</span><div jsname="t3">הנה ההודעה ששלחתי לקבוצה הזאת</div></div>'],
];

for (const [frame, opts] of [
  ['chat.google.com', { host: 'chat.google.com', top: true }],
  ['Gmail-embedded Chat iframe', { host: 'mail.google.com', top: false }],
]) {
  for (const [why, bubble] of OWN_BUBBLES) {
    test(`(6) ${frame}: own bubble is not incoming — ${why}`, async () => {
      const t = load({ ...opts, html: CHAT_AREA, adapter: 'content-google.js' });
      t.scan(); // baseline
      const area = t.document.querySelector('#area');
      const own = append(area, bubble);
      t.scan();
      await tick();
      assert.equal(t.checks().length, 0, 'own message sent as incoming');
      assert.ok(!own.querySelector('[jsname="t3"]').classList.contains('lhg-held'), 'own message held');
      // A real incoming message after it is still checked.
      append(area, '<div jsname="m4"><div jsname="t4">ההודעה החדשה של חבר מהקבוצה</div></div>');
      t.scan();
      await tick();
      assert.equal(t.checks('incoming').length, 1);
      assert.equal(t.checks('incoming')[0].text, 'ההודעה החדשה של חבר מהקבוצה');
    });
  }
}

test('(6) Google Chat: a bubble equal to what was just typed and sent is not incoming', async () => {
  const t = load({ host: 'chat.google.com', html: CHAT_AREA, adapter: 'content-google.js' });
  t.scan();
  const box = t.document.querySelector('#compose');
  typeInto(t.document, box, 'בדיקה של הודעה שאני שולח לקבוצה');
  typeInto(t.document, box, ''); // Enter: the page clears the box
  // The page renders the sent message with NO direction marker at all.
  const area = t.document.querySelector('#area');
  append(area, '<div jsname="m5"><div jsname="t5">בדיקה של הודעה שאני שולח לקבוצה</div></div>');
  t.scan();
  await tick();
  assert.equal(t.checks().length, 0, 'own echo checked');
  // It stays "seen": once the window passed it is still not incoming.
  t.ctx.LHG_COMPOSE.noteTyped('משהו אחר לגמרי שהוקלד אחר כך');
  t.scan();
  await tick();
  assert.equal(t.checks().length, 0);
  // Other people's text is unaffected.
  append(area, '<div jsname="m6"><div jsname="t6">תשובה של מישהו אחר בשיחה</div></div>');
  t.scan();
  await tick();
  assert.equal(t.checks('incoming').length, 1);
});

test('(6) compose registry: window, normalisation, short text', () => {
  const t = load({ host: 'chat.google.com', html: CHAT_AREA, adapter: 'content-google.js' });
  const C = t.ctx.LHG_COMPOSE;
  const now = Date.now();
  C.noteTyped('  שלום   לכולם\nמה נשמע  ', now);
  assert.equal(C.recentlySent('שלום לכולם מה נשמע', now + 1000), true);
  assert.equal(C.recentlySent('שלום לכולם מה נשמע 10:42', now + 1000), true, 'trailing time stamp');
  assert.equal(C.recentlySent('שלום לכולם מה נשמע', now + C.SENT_WINDOW_MS + 1), false, 'window passed');
  assert.equal(C.recentlySent('הודעה אחרת לגמרי של חבר', now + 1000), false);
  C.noteTyped('קצר', now);
  assert.equal(C.recentlySent('קצר', now), false, 'short text never matches');
});

test('(6) isOutgoing: incoming evidence and Hebrew particle "את" do not count as self', () => {
  const t = load({ host: 'chat.google.com', html: CHAT_AREA, adapter: 'content-google.js' });
  const S = t.ctx.LHG_SELECTORS;
  const root = t.document.body;
  const a = append(root, '<div aria-label="את ההודעה הזאת כתב יוסי"><span id="x">טקסט כלשהו כאן</span></div>');
  assert.equal(S.isOutgoing(a.querySelector('#x')), false);
  const b = append(root, '<div class="message-in"><div class="message-inline"><span id="y">טקסט נכנס</span></div></div>');
  assert.equal(S.isOutgoing(b.querySelector('#y')), false);
  assert.equal(S.isOutgoing(root, { localContext: { authorDisplayName: 'You' } }), true);
  assert.equal(S.isOutgoing(root, { localContext: { isSelf: true } }), true);
  assert.equal(S.isOutgoing(root, { localContext: { authorDisplayName: 'יוסי' } }), false);
});

test('(6) WhatsApp: an outgoing row is never incoming, even with a "message-in*" class inside', async () => {
  const t = load({
    host: 'web.whatsapp.com',
    html: `<div id="main"><div id="list">
      <div class="message-in"><span class="copyable-text">הודעה נכנסת ישנה מההיסטוריה</span></div>
    </div><footer><div contenteditable="true" role="textbox"></div></footer></div>`,
    adapter: 'content.js',
  });
  t.scan();
  const list = t.document.querySelector('#list');
  append(list, '<div class="message-out"><div class="message-inline"><span class="copyable-text">ההודעה שלי שיוצאת לחבר הזה</span></div></div>');
  t.scan();
  await tick();
  assert.equal(t.checks().length, 0, 'own WhatsApp message sent as incoming');
  append(list, '<div class="message-in"><span class="copyable-text">הודעה נכנסת חדשה מחבר</span></div>');
  t.scan();
  await tick();
  assert.equal(t.checks('incoming').length, 1);
  assert.equal(t.checks('incoming')[0].platform, 'whatsapp-web');
});

const INBOX = `
<div role="main"><table><tbody>
  <tr class="zA" role="row"><td><span>שורת תיקייה עם תצוגה מקדימה של מייל</span></td></tr>
</tbody></table><div id="reading"></div></div>
<div id="search" contenteditable="true" role="textbox"></div>`;

test('(5) Gmail: an e-mail draft is checked as outgoing (quoted history and signature excluded)', async () => {
  const t = load({ host: 'mail.google.com', pathname: '/mail/u/0/', html: INBOX, adapter: 'content-google.js' });
  t.scan();
  const dlg = append(t.document.body, `<div role="dialog"><div class="M9">
    <div id="draft" class="Am Al editable" contenteditable="true" role="textbox" g_editable="true" aria-multiline="true"></div>
  </div></div>`);
  const box = dlg.querySelector('#draft');
  append(box, '<div>הוא תמיד מאחר ואי אפשר לסמוך עליו בכלל</div><div class="gmail_signature">חתימה ארוכה של השולח</div><div class="gmail_quote">ציטוט ישן ארוך מההודעה הקודמת</div>');
  t.document.dispatch('input', box);
  // Not a Gmail compose: a generic editable outside a compose window.
  const search = t.document.querySelector('#search');
  typeInto(t.document, search, 'חיפוש טקסט כלשהו ארוך מספיק');
  await tick(2700);
  const out = t.checks('outgoing');
  assert.equal(out.length, 0, 'typing is silent');
  const send = append(dlg, '<div role="button" data-tooltip="Send">Send</div>');
  t.document.dispatch('click', send);
  await tick();
  out.push(...t.checks('outgoing'));
  assert.equal(out.length, 1, 'exactly one send check');
  assert.equal(out[0].platform, 'gmail');
  assert.equal(out[0].text, 'הוא תמיד מאחר ואי אפשר לסמוך עליו בכלל');
  assert.equal(t.checks('incoming').length, 0, 'the draft is not an incoming mail');
});

test('(5) Gmail: an inline reply textbox inside a compose container is a draft too', async () => {
  const t = load({ host: 'mail.google.com', pathname: '/mail/u/0/', html: INBOX, adapter: 'content-google.js' });
  const reply = append(t.document.querySelector('#reading'),
    '<div class="ip adB"><div id="r" role="textbox" contenteditable="true" g_editable="true"></div></div>');
  typeInto(t.document, reply.querySelector('#r'), 'תודה, אבל הוא באמת לא יודע כלום');
  await tick(2700);
  assert.equal(t.checks('outgoing').length, 0, 'typing reply is silent');
  append(reply, '<div role="button" data-tooltip="Send">Send</div>');
  t.document.dispatch('keydown', reply.querySelector('#r'), { key: 'Enter', ctrlKey: true });
  await tick();
  assert.equal(t.checks('outgoing').length, 1);
  assert.equal(t.checks('outgoing')[0].platform, 'gmail');
});

test('(5) Gmail: an opened mail body is found (whole body, quotes excluded); list previews never', async () => {
  const t = load({ host: 'mail.google.com', pathname: '/mail/u/0/', html: INBOX, adapter: 'content-google.js' });
  t.scan(); // baseline: the folder list
  const reading = t.document.querySelector('#reading');
  // A preview that happens to carry .a3s inside a list row: never a message.
  append(t.document.querySelector('tbody'),
    '<tr class="zA" role="row"><td><div class="a3s">תצוגה מקדימה שאסור לבדוק אותה</div></td></tr>');
  // The opened thread. The body starts with an EMPTY div: the old
  // extraction (first <div>) returned '' and dropped the message.
  append(reading, `<div role="list"><div role="listitem"><div class="adn ads" data-message-id="m1">
    <div class="ii gt"><div class="a3s aiL"><div></div><div dir="ltr">שלום,<br>רציתי לעדכן שהפגישה נדחתה למחר</div>
    <div class="gmail_quote">ציטוט ישן ארוך מההודעה הקודמת</div></div></div></div></div></div>`);
  t.scan();
  await tick();
  const inc = t.checks('incoming');
  assert.equal(inc.length, 1, 'one opened body, no preview');
  assert.equal(inc[0].platform, 'gmail');
  assert.match(inc[0].text, /רציתי לעדכן שהפגישה נדחתה למחר/);
  assert.doesNotMatch(inc[0].text, /ציטוט ישן/);
  assert.doesNotMatch(inc[0].text, /תצוגה מקדימה/);
});

test('(5) Gmail: body fallbacks without the .adn wrapper (.ii.gt, data-legacy-message-id)', async () => {
  const t = load({ host: 'mail.google.com', pathname: '/mail/u/0/', html: INBOX, adapter: 'content-google.js' });
  t.scan();
  const reading = t.document.querySelector('#reading');
  append(reading, '<div class="ii gt"><div class="a3s aiL">גוף מייל ראשון בלי עטיפת adn</div></div>');
  append(reading, '<div data-legacy-message-id="x2"><div class="a3s">גוף מייל שני עם מזהה ישן</div></div>');
  t.scan();
  await tick(2300); // the queue paces requests ~2.1s apart
  assert.deepEqual(t.checks('incoming').map((m) => m.text).sort(),
    ['גוף מייל ראשון בלי עטיפת adn', 'גוף מייל שני עם מזהה ישן'].sort());
  const S = t.ctx.LHG_SELECTORS;
  // A bare .a3s with no message container is still not a message.
  const bare = append(reading, '<div class="a3s">גוף בלי שום מיכל של הודעה</div>');
  assert.equal(S.gmailIsMessageBody(bare), false);
});

test('(5) Gmail chat frame: Chat watcher still owns the Chat box; e-mail draft watcher is top-frame only', async () => {
  const t = load({ host: 'mail.google.com', top: false, html: CHAT_AREA, adapter: 'content-google.js' });
  typeInto(t.document, t.document.querySelector('#compose'), 'וואו, איזה גאון, שוב באיחור');
  await tick(1400);
  assert.equal(t.checks('outgoing').length, 0, 'typing Chat is silent');
  t.document.dispatch('keydown', t.document.querySelector('#compose'), { key: 'Enter' });
  await tick();
  const out = t.checks('outgoing');
  assert.equal(out.length, 1);
  assert.equal(out[0].platform, 'google-chat');
});
