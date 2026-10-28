// (7) Gmail thread context: prior messages in the thread reach /check.
// Standalone: loads real store+builder+runtime over a synthetic thread DOM.
// Synthetic text only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocument, append } = require('./mini-dom.testlib.cjs');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('Gmail history refreshes after a collapsed body mounts and never includes future mail', async () => {
  const t = loadThread(), thread = t.document.querySelector('#thread');
  const old = append(thread, '<div class="adn" data-message-id="older"></div>');
  const current = append(thread, threadBody('current', 'Current', 'current@example.test', 'Current synthetic message body.')).querySelector('.a3s');
  append(thread, threadBody('future', 'Future', 'future@example.test', 'Future message must not be context.'));
  const payload = { type: 'lhg-check', platform: 'gmail', direction: 'incoming', text: 'Current synthetic message body.' };
  const first = await t.ctx.LHG_CONTEXT_RUNTIME.prepare(payload, current, true);
  assert.equal(first.context.recentMessages.length, 0);
  append(old, '<div class="a3s aiL">Previously collapsed synthetic body.</div>');
  const second = await t.ctx.LHG_CONTEXT_RUNTIME.prepare(payload, current, true);
  assert.equal(second.context.recentMessages.length, 1);
  assert.match(second.context.recentMessages[0].text, /Previously collapsed/);
  assert.doesNotMatch(JSON.stringify(second.context), /Future message|Current synthetic message/);
});

test('Gmail quote-only reply supplies history even with no mounted message bodies', async () => {
  const t = loadThread();
  const box = append(t.document.body, '<div role="dialog"><div class="Am Al editable" contenteditable="true" role="textbox"><div>New synthetic reply text.</div><div class="gmail_quote">Quoted prior synthetic message.</div></div></div>').querySelector('[role="textbox"]');
  const result = await t.ctx.LHG_CONTEXT_RUNTIME.prepare({ type: 'lhg-check', platform: 'gmail', direction: 'outgoing', text: 'New synthetic reply text.' }, box);
  assert.equal(result.context.recentMessages.length, 1);
  assert.match(result.context.recentMessages[0].text, /Quoted prior/);
});

function loadThread() {
  const INBOX = `<div role="main"><div role="list" id="thread"></div></div>`;
  const document = createDocument(INBOX);
  const sent = [];
  const noopStore = new Proxy({}, { get: () => async () => ({}) });
  const ctx = vm.createContext({
    setTimeout, clearTimeout, setInterval: () => 0, Date, URL,
    document, location: { hostname: 'mail.google.com', pathname: '/mail/u/0/', href: 'https://mail.google.com/mail/u/0/#inbox/abc123' },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (m, cb) => { sent.push(m); if (cb) cb({ alert: 'none' }); },
        getManifest: () => ({ version: 'test' }),
      },
      storage: { local: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() }, onChanged: { addListener() {} } },
    },
    addEventListener() {},
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.top = ctx;
  ctx.LHG_CONTEXT_STORE = { purgeExpired: async () => ({}), createStore: () => noopStore };
  for (const f of ['selectors.js', 'context-dom.js', 'context-store.js', 'context-builder.js', 'context-runtime.js'])
    vm.runInContext(src(f), ctx);
  return { ctx, document, sent };
}

function threadBody(id, senderName, senderEmail, bodyHtml) {
  return `<div role="listitem"><div class="adn ads" data-message-id="${id}">`
    + `<span name="${senderEmail}">${senderName}</span>`
    + `<div class="ii gt"><div class="a3s aiL">${bodyHtml}</div></div>`
    + `</div></div>`;
}

test('(7) Gmail thread: buildPacket after seeding carries 2 prior messages, no names', async () => {
  const t = loadThread();
  const R = t.ctx.LHG_CONTEXT_RUNTIME;
  const thread = t.document.querySelector('#thread');
  const b1 = append(thread, threadBody('m1', 'רוני כהן', 'roni@example.com',
    '<div dir="ltr">היי, מציע שניפגש מחר לדון בפרויקט המשותף</div>'));
  const b2 = append(thread, threadBody('m2', 'דנה לוי', 'dana@example.com',
    '<div dir="ltr">מסכימה, אביא את המסמכים הרלוונטיים לפגישה</div>'));
  const b3 = append(thread, threadBody('m3', 'רוני כהן', 'roni@example.com',
    '<div dir="ltr">מעדכן שהלקוח ביטל, נדחה לשבוע הבא</div><div class="gmail_quote">ציטוט ארוך של ההודעות הקודמות בשרשור הזה</div>'));
  const el3 = b3.querySelector('.a3s');
  const out = await R.prepare(
    { type: 'lhg-check', text: 'מעדכן שהלקוח ביטל, נדחה לשבוע הבא', platform: 'gmail', direction: 'incoming' },
    el3, true);
  await tick();
  assert.ok(out.context, 'runtime attached a context packet');
  assert.equal(out.context.conversationKind, 'email_thread');
  assert.equal(out.context.recentMessages.length, 2, 'two prior thread messages seed the packet');
  assert.match(out.context.recentMessages[0].text, /מציע שניפגש מחר/);
  assert.match(out.context.recentMessages[1].text, /אביא את המסמכים/);
  assert.doesNotMatch(JSON.stringify(out), /רוני כהן|דנה לוי|example\.com/, 'names stay local (refs only)');
  const joined = out.context.recentMessages.map((m) => m.text).join('\n');
  assert.doesNotMatch(joined, /הלקוח ביטל/, 'the current mail is not duplicated in history');
  // A second check of the same mail sees the same 2 (remembered once, not twice).
  const out2 = await R.prepare(
    { type: 'lhg-check', text: 'מעדכן שהלקוח ביטל, נדחה לשבוע הבא', platform: 'gmail', direction: 'incoming' },
    el3, true);
  assert.equal(out2.context.recentMessages.length, 2, 'no duplicate seeding on re-check');
  void b1; void b2;
});

test('(7) Gmail thread: reply draft seeds history from the quoted part only', async () => {
  const t = loadThread();
  const R = t.ctx.LHG_CONTEXT_RUNTIME;
  const thread = t.document.querySelector('#thread');
  append(thread, threadBody('m1', 'רוני כהן', 'roni@example.com',
    '<div dir="ltr">היי, מציע שניפגש מחר לדון בפרויקט המשותף</div>'));
  const dlg = append(t.document.body, `<div role="dialog"><div class="M9">`
    + `<div id="rdraft" class="Am Al editable" contenteditable="true" role="textbox" g_editable="true"></div>`
    + `</div></div>`);
  const box = dlg.querySelector('#rdraft');
  append(box, '<div>אחלה, אגיע מחר עם המסמכים המעודכנים</div>'
    + '<div class="gmail_quote">היי, מציע שניפגש מחר לדון בפרויקט המשותף</div>');
  const S = t.ctx.LHG_SELECTORS;
  assert.equal(S.textWithout(box, S.gmail.quotedPart), 'אחלה, אגיע מחר עם המסמכים המעודכנים');
  const out = await R.prepare(
    { type: 'lhg-check', text: 'אחלה, אגיע מחר עם המסמכים המעודכנים', platform: 'gmail', direction: 'outgoing' },
    box, true);
  await tick();
  assert.ok(out.context, 'draft check carries context');
  assert.equal(out.context.recentMessages.length, 1, 'the quoted history message seeds once');
  assert.match(out.context.recentMessages[0].text, /מציע שניפגש מחר/);
});

test('(7) Gmail thread: collapsed handle inside compose is never clicked', async () => {
  const t = loadThread();
  for (const f of ['compose-watch.js', 'incoming.js']) vm.runInContext(src(f), t.ctx);
  let scanner = null;
  t.ctx.LHG_INCOMING.observe = (s) => { scanner = s; };
  vm.runInContext(src('content-google.js'), t.ctx);
  assert.ok(scanner, 'adapter registered its scanner');
  let clicked = 0;
  const dlg = append(t.document.body, `<div role="dialog"><div class="M9">`
    + `<div id="d2" class="Am Al editable" contenteditable="true" role="textbox"></div>`
    + `<div role="button" aria-expanded="false" id="exp">...</div>`
    + `</div></div>`);
  const handle = dlg.querySelector('#exp');
  handle.click = () => { clicked++; };
  scanner.scan();
  await tick();
  assert.equal(clicked, 0, 'expand handle inside compose dialog is never clicked');
});
