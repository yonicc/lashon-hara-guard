// End-to-end setup UI in a real extension, with a synthetic local Ollama API.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve(process.argv[2] || '../browser-tools/package.json'));
const { chromium } = require('playwright');
const profile = await mkdtemp(path.join(os.tmpdir(), 'lhg-setup-'));
const installed = new Set(), calls = [];
let output = '{}', brokenDownload = false, blocked = false, slow = false;
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let body = ''; for await (const part of req) body += part;
  const input = body ? JSON.parse(body) : null;
  calls.push({ path: req.url, input });
  if (req.url === '/api/tags') {
    res.statusCode = blocked ? 403 : 200;
    return res.end(JSON.stringify({ models: [...installed].map(name => ({ name })) }));
  }
  if (req.url === '/api/pull') {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write('{"total":100,"completed":40}\n');
    if (slow) { res.on('close', () => {}); return; }
    await new Promise(r => setTimeout(r, 80));
    if (brokenDownload) return res.end('{"error":"synthetic download failure"}\n');
    installed.add(input.model);
    return res.end('{"status":"success"}\n');
  }
  res.end(JSON.stringify({ done: true, response: output }));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(11434, '127.0.0.1', resolve); });
let browser;
try {
  const extension = path.resolve('extension');
  browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  for (let i = 0; i < 100; i++) {
    if (await worker.evaluate(() => !!globalThis.chrome?.storage?.local && !!globalThis.LHG_OLLAMA_SETUP)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const base = worker.url().replace(/\/[^/]*$/, '');
  await worker.evaluate(() => chrome.storage.local.set({ lhgLang: 'he', lhgCheckMode: 'cloud', lhgCloudFallback: true }));
  const page = await browser.newPage();
  const unexpected = [];
  page.on('request', req => { if (/^https?:/.test(req.url())) unexpected.push(req.url()); });
  await page.goto(base + '/options.html');
  // The setup link lives in Advanced since the preset-grid release.
  await page.locator('.preset-advanced > summary').click();
  await page.locator('a[href="ollama-setup.html"]').click();
  await page.waitForFunction(() => !document.getElementById('choices').disabled);
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('#activate').isDisabled(), true);
  await page.locator('input[value="local-union"]').check();
  await page.locator('#download').click();
  await page.waitForFunction(() => !document.getElementById('activate').disabled, { timeout: 30000 });
  assert.equal(calls.filter(c => c.path === '/api/pull').length, 2);
  assert.equal(calls.filter(c => c.path === '/api/generate').length, 2);
  let prefs = await worker.evaluate(() => chrome.storage.local.get(['lhgCheckMode', 'lhgCloudFallback']));
  assert.equal(prefs.lhgCheckMode, 'cloud'); assert.equal(prefs.lhgCloudFallback, true);
  await page.locator('#activate').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('הופעל'));
  prefs = await worker.evaluate(() => chrome.storage.local.get(['lhgCheckMode', 'lhgCloudFallback']));
  assert.equal(prefs.lhgCheckMode, 'local-union'); assert.equal(prefs.lhgCloudFallback, false);
  // A 403 gets actionable graphical instructions and never enables downloads.
  blocked = true; await page.reload();
  await page.waitForFunction(() => document.getElementById('help').open);
  assert.equal(await page.locator('#choices').evaluate(el => el.disabled), true);
  blocked = false; await page.locator('#connect').click();
  await page.waitForFunction(() => !document.getElementById('choices').disabled);
  // Invalid model output cannot enable activation, even for an installed model.
  output = 'broken JSON';
  await page.locator('#download').click();
  await page.waitForFunction(() => document.getElementById('cancel').hidden);
  assert.equal(await page.locator('#activate').isDisabled(), true);
  // Failed download, cancellation, then retry reuse the same wizard.
  installed.clear(); output = '{}'; brokenDownload = true;
  await page.locator('#download').click();
  await page.waitForFunction(() => document.getElementById('cancel').hidden);
  assert.equal(await page.locator('#activate').isDisabled(), true);
  brokenDownload = false; slow = true;
  await page.locator('#download').click();
  await page.waitForFunction(() => document.getElementById('progress').value === 40);
  await page.locator('#cancel').click();
  await page.waitForFunction(() => document.getElementById('cancel').hidden);
  assert.equal(await page.locator('#activate').isDisabled(), true);
  slow = false; await page.locator('#download').click();
  await page.waitForFunction(() => !document.getElementById('activate').disabled);
  assert.deepEqual(unexpected, [], 'setup UI makes no external requests');
  await page.screenshot({ path: path.join(os.tmpdir(), 'lhg-ollama-setup-he.png'), fullPage: true });
  // A real refused connection clears readiness; retry never retains a stale success.
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('לא הצלחנו'));
  assert.equal(await page.locator('#activate').isDisabled(), true);
  assert.equal(await page.locator('#choices').evaluate(el => el.disabled), true);
  console.log('PASS real Chromium setup: Hebrew/RTL, options entry, streamed union download, per-engine probe, explicit activation, offline/403 help, invalid output, failed download, cancel, retry, no external UI requests');
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
