// Isolated Chromium + real MV3 scripts; synthetic Gmail DOM, mocked /check.
// node extension/gmail-browser.cjs <path-to-playwright-package>
const { chromium } = require(process.argv[2] || 'playwright');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lhg-gmail-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + __dirname, '--load-extension=' + __dirname] });
    const errors = [];
    ctx.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await worker.evaluate(async () => {
      globalThis.__checks = [];
      globalThis.fetch = async (url, init) => {
        if (!String(url).endsWith('/check')) return new Response('{}');
        const body = JSON.parse(init.body); __checks.push(body);
        if (body.direction === 'outgoing') return new Promise(resolve => {
          globalThis.__finish = alert => resolve(new Response(JSON.stringify({ alert })));
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        return new Response(JSON.stringify({ alert: 'none' }));
      };
      return chrome.storage.local.set({ accessKey: 'synthetic-test-only', lhgEnabled: true, hideIncoming: true });
    });
    const html = `<!doctype html><meta charset="utf-8">
      <a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Synthetic (test@example.invalid)"></a>
      <div role="main"><div role="list">
      <div class="adn" data-message-id="m1"><span email="one@example.invalid">One</span><div class="a3s aiL">First prior synthetic message.</div></div>
      <div class="adn" data-message-id="m2"><span email="two@example.invalid">Two</span><div id="expand" role="button" aria-expanded="false">...</div></div>
      <div class="adn" data-message-id="m3"><span email="one@example.invalid">One</span><div id="current" class="a3s aiL">Current synthetic incoming message.</div></div>
      </div></div>
      <div role="dialog"><div class="M9"><div id="draft" class="Am Al editable" contenteditable="true" role="textbox">Initial synthetic outgoing draft.</div><div id="send" class="T-I aoO" role="button" data-tooltip="Send">Send</div></div></div>
      <script>
      window.nativeSends=0;
      document.addEventListener('click', e => {
        if(e.target.closest('#send')) { nativeSends++; document.querySelector('#draft').textContent=''; }
        if(e.target.closest('#expand')) setTimeout(() => {
          const b=document.createElement('div');b.className='a3s aiL';b.textContent='Second prior loaded asynchronously.';
          document.querySelector('#expand').parentElement.appendChild(b);
          document.querySelector('#expand').setAttribute('aria-expanded','true');
        },80);
      });
      </script>`;
    await ctx.route('https://mail.google.com/**', r => r.fulfill({ contentType: 'text/html', body: html }));
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.uncoveredBeforeScan = false;
      function watch() {
        for (const e of document.querySelectorAll('.a3s:not([data-lhg-scanned])'))
          if (getComputedStyle(e).visibility === 'visible') window.uncoveredBeforeScan = true;
        requestAnimationFrame(watch);
      }
      requestAnimationFrame(watch);
    });
    await page.goto('https://mail.google.com/mail/u/0/#inbox/synthetic-thread');
    await page.waitForFunction(() => [...document.querySelectorAll('.a3s')].length === 3 &&
      [...document.querySelectorAll('.a3s')].every(e => e.dataset.lhgScanned && !e.classList.contains('lhg-held')), {}, { timeout: 20000 });
    const incoming = await worker.evaluate(() => __checks.filter(x => x.direction === 'incoming'));
    assert.equal(incoming.length, 3);
    assert.equal(incoming.find(x => x.text.includes('Current synthetic')).context.recentMessages.length, 2);
    assert.equal(await page.evaluate(() => uncoveredBeforeScan), false);
    console.log('PASS early cover and asynchronous collapsed history in real Chromium');
    await page.reload();
    await page.waitForTimeout(5200);
    assert.equal(await worker.evaluate(() => __checks.filter(x => x.direction === 'incoming').length), 3);
    console.log('PASS persisted cache after page reload');
    await page.locator('#draft').fill('Updated outgoing synthetic draft.');
    await page.waitForTimeout(1400);
    assert.equal(await worker.evaluate(() => __checks.filter(x => x.direction === 'outgoing').length), 0);
    await page.locator('#send').click();
    await page.locator('#send').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => nativeSends), 0);
    assert.equal(await worker.evaluate(() => __checks.filter(x => x.direction === 'outgoing').length), 1);
    assert.match(await page.locator('#send').innerText(), /Checking/);
    await worker.evaluate(() => __finish('warn'));
    await page.getByRole('button', { name: 'Send anyway', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => nativeSends), 0);
    await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
    assert.equal(await page.evaluate(() => nativeSends), 1);
    await page.locator('#draft').fill('Keyboard outgoing synthetic draft.');
    await page.locator('#draft').press('Control+Enter');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => nativeSends), 1);
    await worker.evaluate(() => __finish('none'));
    await page.waitForFunction(() => nativeSends === 2);
    console.log('PASS click, duplicate suppression, explicit warning approval and keyboard send');
    assert.deepEqual(errors, []);
    console.log('PASS no page errors; no real mail or paid API used');
  } finally {
    if (ctx) await ctx.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
