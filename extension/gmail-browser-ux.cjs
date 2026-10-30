// Owner-request UX regression in REAL MV3 Chromium (2026-10-29), synthetic DOM,
// mocked /check that never resolves by itself (each request gets a resolver):
//  1. Incoming held mail shows an ANIMATED loading indicator while pending.
//  2. The outgoing send gate waits at most 30s, then explains that Enter again
//     (or Send anyway) sends immediately without the check result.
// node extension/gmail-browser-ux.cjs <path-to-playwright-package> [shots-dir]
const { chromium } = require(process.argv[2] || 'playwright');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const shots = process.argv[3] || path.join(os.tmpdir(), 'lhg-ux-shots');
  await mkdir(shots, { recursive: true });
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lhg-ux-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + __dirname, '--load-extension=' + __dirname] });
    const errors = [];
    ctx.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await new Promise(r => setTimeout(r, 1000));
    await worker.evaluate(async () => {
      globalThis.__resolvers = [];
      globalThis.fetch = async (url, init) => {
        if (!String(url).endsWith('/check')) return new Response('{}');
        const body = JSON.parse(init.body);
        return new Promise(resolve => __resolvers.push({ body, resolve }));
      };
      return chrome.storage.local.set({ accessKey: 'synthetic-test-only', lhgEnabled: true, hideIncoming: true, lhgLang: 'he' });
    });
    const html = `<!doctype html><meta charset="utf-8">
      <a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Synthetic (test@example.invalid)"></a>
      <div role="main"><div role="list">
      <div class="adn" data-message-id="m1"><span email="one@example.invalid">One</span><div class="a3s aiL">הודעה נכנסת סינתטית שנשלחת לבדיקה ארוכה.</div></div>
      </div></div>
      <div role="dialog"><div class="M9"><div id="draft" class="Am Al editable" contenteditable="true" role="textbox">טיוטה יוצאת סינתטית לבדיקה ארוכה.</div><div id="send" class="T-I aoO" role="button" data-tooltip="Send">שליחה</div></div></div>
      <script>
      window.nativeSends=0;
      document.addEventListener('click', e => {
        if(e.target.closest('#send')) { nativeSends++; document.querySelector('#draft').textContent=''; }
      });
      </script>`;
    await ctx.route('https://mail.google.com/**', r => r.fulfill({ contentType: 'text/html', body: html }));
    const page = await ctx.newPage();
    await page.goto('https://mail.google.com/mail/u/0/#inbox/synthetic-ux');

    // (1) pending hold shows the spinner and the "checking" label, animated.
    await page.waitForSelector('.lhg-hold .lhg-spinner', { timeout: 20000 });
    assert.match(await page.locator('.lhg-hold').innerText(), /נבדקת/);
    const animated = await page.evaluate(() => {
      const s = document.querySelector('.lhg-hold .lhg-spinner');
      const a = getComputedStyle(s).animationName;
      return a && a !== 'none';
    });
    assert.ok(animated, 'spinner has an active CSS animation');
    await page.screenshot({ path: path.join(shots, 'incoming-loading-he.png') });
    console.log('PASS incoming hold shows an animated loading indicator (shot: incoming-loading-he.png)');

    // Let the incoming check finish clean so it does not linger.
    await worker.evaluate(() => { for (const r of __resolvers.splice(0)) if (r.body.direction === 'incoming') r.resolve(new Response(JSON.stringify({ alert: 'none' }))); });

    // (2) outgoing: first click is held; at ~30s the cap text appears; Enter again sends.
    await page.locator('#send').click();
    await page.waitForSelector('text=שלח בכל זאת', { timeout: 10000 });
    assert.equal(await page.evaluate(() => nativeSends), 0, 'first send is held');
    await page.waitForSelector('#lhg-panel.lhg-checking .lhg-title', { timeout: 10000 });
    const outSpin = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#lhg-panel.lhg-checking .lhg-title'), '::before');
      return s.animationName + '|' + s.width;
    });
    assert.ok(/^lhg-spin\|1[0-9]/.test(outSpin), 'outgoing panel title has a visible animated spinner: ' + outSpin);
    console.log('PASS outgoing panel spinner (' + outSpin + ')');
    await page.waitForSelector('text=מקסימום כ־30 שניות', { timeout: 40000 });
    await page.screenshot({ path: path.join(shots, 'send-cap-he.png') });
    console.log('PASS cap text after ~30s (shot: send-cap-he.png)');
    assert.equal(await page.evaluate(() => nativeSends), 0, 'still held: cap explains, it does not send');
    await page.locator('#send').click();
    assert.equal(await page.evaluate(() => nativeSends), 1, 'second send bypasses immediately');
    await worker.evaluate(() => { for (const r of __resolvers.splice(0)) r.resolve(new Response(JSON.stringify({ alert: 'none' }))); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => nativeSends), 1, 'late result cannot replay the send');
    console.log('PASS Enter/click again sends immediately without waiting for the result');
    assert.deepEqual(errors, []);
  } finally {
    if (ctx) await ctx.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
