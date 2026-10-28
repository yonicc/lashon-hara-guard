// Real MV3/Chromium transport test against a synthetic loopback Ollama API.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve(process.argv[2] || 'research/local-memory/package.json'));
const { chromium } = require('playwright');
const profile = await mkdtemp(path.join(os.tmpdir(), 'lhg-ollama-'));
let output = '{}';
const calls = [];
const models = ['hf.co/yonicc/lhg-extractor-qwen7b-gguf:Q4_K_M',
  'hf.co/yonicc/lhg-extractor-dictalm-gguf:Q4_K_M'];
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let body = ''; for await (const part of req) body += part;
  calls.push({ path: req.url, body: body ? JSON.parse(body) : null });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/api/tags' ? { models: models.map(name => ({ name })) } :
    { done: true, response: output }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(11434, '127.0.0.1', resolve);
});
let browser;
try {
  const extension = path.resolve('extension');
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await worker.evaluate(() => !!(globalThis.LHG_OLLAMA_ENGINE && globalThis.LHG_CHECK_MODE));
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Ollama background scripts initialized');
  const status = await worker.evaluate(() => globalThis.LHG_CHECK_MODE.status());
  assert.deepEqual(status, { 'local-fast': true, 'local-hebrew': true, 'local-union': true });
  async function check(mode) {
    return worker.evaluate(async mode => {
      let cloudCalls = 0;
      const result = await globalThis.LHG_CHECK_MODE.route({
        text: 'I checked the invoice.', platform: 'manual', direction: 'outgoing',
        context: { version: 1, recentMessages: [] },
      }, { lhgCheckMode: mode }, async () => { cloudCalls++; return { alert: 'none' }; });
      return { result, cloudCalls };
    }, mode);
  }
  for (const mode of ['local-fast', 'local-hebrew', 'local-union']) {
    const { result, cloudCalls } = await check(mode);
    assert.equal(result.alert, 'unsure'); assert.equal(result.checkedBy, 'local');
    assert.notEqual(result.rules.notChecked, true); assert.equal(cloudCalls, 0);
  }
  output = 'invalid JSON';
  const failed = await check('local-fast');
  assert.equal(failed.result.alert, 'not_checked'); assert.equal(failed.cloudCalls, 0);
  assert.equal(calls.filter(c => c.path === '/api/generate').length, 5);
  assert.ok(calls.filter(c => c.body).every(c => c.body.raw === true && c.body.stream === false));
  console.log('PASS real MV3: both registrations, all modes, browser bundle/rules, invalid output, no cloud fallback');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
