// Real Chromium MV3 + offscreen IndexedDB retrieval; synthetic proxy and texts only.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(path.resolve(process.argv[2]));
const { chromium } = require('playwright');
const profile = await mkdtemp(path.join(os.tmpdir(), 'lhg-context-loop-'));
const calls = [];
let scenario = 'normal', release;
const pending = { alert: 'none', needs: { requests: [{ id: 'recent', kind: 'get_recent', args: { n: 20 } }],
  questions: ['speaker.knows_first_hand'] } };
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-lhg-key');
  if (req.method === 'OPTIONS') { res.end(); return; }
  let text = ''; for await (const part of req) text += part;
  const body = JSON.parse(text); calls.push(body);
  if (scenario === 'edited' && body.round === 1) await new Promise(resolve => { release = resolve; });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body.round === 1 ? pending : { alert: 'warn', status: 'extracted', needs: { requests: [], questions: [] } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const extension = path.resolve('extension');
  browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  await browser.route('https://mail.google.com/**', r => r.fulfill({ contentType: 'text/html', body:
    '<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account (synthetic@example.invalid)"></a><div data-thread-id="synthetic-thread"><div contenteditable="true" role="textbox" id="box">Synthetic primary message.</div></div>' }));
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const options = await browser.newPage();
  await options.goto('chrome-extension://' + id + '/options.html');
  const scope = { platform: 'gmail', accountId: 'synthetic@example.invalid', conversationId: 'synthetic-thread' };
  await options.evaluate(async ({ scope, port }) => {
    await chrome.storage.local.set({ accessKey: 'synthetic', proxyUrl: 'http://127.0.0.1:' + port,
      lhgMemoryEnabled: true, lhgRouterEnabled: false, lhgCheckMode: 'cloud' });
    const { LocalMemory } = await import('./memory.mjs');
    const memory = new LocalMemory({ name: 'lhg-memory-v1', embed: async () => [1, ...Array(383).fill(0)] });
    await memory.ingest({ enabled: true, scope, sourceId: 'planted', type: 'context_observed',
      text: 'Synthetic Context Person checked the maintenance record; synthetic@example.invalid 050-1234567.',
      direction: 'incoming', observedAt: Date.now() - 60000 });
    await memory.ingest({ enabled: true, scope: { ...scope, conversationId: 'foreign' }, sourceId: 'foreign',
      type: 'context_observed', text: 'FOREIGN SECRET', direction: 'incoming', observedAt: Date.now() });
    memory.close();
  }, { scope, port: server.address().port });
  const mail = await browser.newPage(), cdp = await browser.newCDPSession(mail), contexts = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await cdp.send('Runtime.enable');
  await mail.goto('https://mail.google.com/mail/u/0/');
  let world;
  for (let i = 0; i < 100 && !world; i++) {
    for (const c of contexts) { try {
      if ((await cdp.send('Runtime.evaluate', { contextId: c.id, expression: '!!globalThis.LHG_CONTEXT_RUNTIME', returnByValue: true })).result.value) world = c.id;
    } catch {} }
    if (!world) await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(world, 'real isolated content runtime loaded');
  const isolated = async expression => {
    const r = await cdp.send('Runtime.evaluate', { contextId: world, expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  // Register a display name in the canonical builder's real local mapping.
  await isolated("globalThis.LHG_LOCAL_CONTEXT = { attach: () => ({authorDisplayName:'Synthetic Context Person'}) }; true");
  const begin = () => isolated(`new Promise(resolve => LHG_CONTEXT_RUNTIME.send({
    type:'lhg-check', text:'Synthetic primary message.', platform:'gmail', direction:'outgoing', forceRecheck:true
  }, resolve, document.querySelector('#box')))`);
  const result = await begin();
  assert.equal(result.alert, 'warn'); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.round), [1, 2]);
  const context = JSON.stringify(calls[1].context);
  assert.match(context, /maintenance record/); assert.match(context, /candidate; dom_observed/);
  assert.doesNotMatch(context, /FOREIGN|Synthetic Context Person|synthetic@example.invalid|050-1234567/);
  assert.ok(calls[1].context.recentMessages.length <= 5);
  assert.ok(calls[1].context.recentMessages.every(m => m.text.length <= 300));
  assert.equal(calls[1].text, calls[0].text); assert.equal(calls[1].confirmedFacts, undefined);
  console.log('PASS MV3 cloud round 1 -> scoped offscreen get_recent -> masked/sanitized round 2');
  const incomingBefore = calls.length;
  const incoming = await isolated(`(async () => {
    const bubble = document.createElement('div');
    bubble.id = 'synthetic-incoming'; bubble.textContent = 'Synthetic incoming message.';
    document.querySelector('[data-thread-id]').appendChild(bubble);
    const msg = await LHG_CONTEXT_RUNTIME.prepare({type:'lhg-check',text:bubble.textContent,
      platform:'gmail',direction:'incoming',forceRecheck:true}, bubble, true);
    const hold = document.createElement('div'); hold.className = 'lhg-hold';
    hold.innerHTML = '<span>Checking</span>'; bubble.appendChild(hold);
    const result = await new Promise(resolve => LHG_CONTEXT_RUNTIME.sendPrepared(msg, resolve));
    return {result, progress:hold.textContent};
  })()`);
  assert.equal(incoming.result.alert, 'warn'); assert.equal(calls.length, incomingBefore + 2);
  assert.match(incoming.progress, /round 2/);
  console.log('PASS MV3 queued incoming hold labels do not supersede their own check; round progress');
  await options.evaluate(() => chrome.storage.local.set({ lhgMemoryEnabled: false }));
  const before = calls.length, disabled = await begin();
  assert.equal(calls.length, before + 1); assert.equal(disabled.alert, 'unsure');
  assert.equal(disabled.loopStopped, 'memory_disabled'); assert.equal(disabled.rules.questions.length, 1);
  console.log('PASS MV3 memory disabled -> catalog questions, one billed request');
  await options.evaluate(() => chrome.storage.local.set({ lhgMemoryEnabled: true }));
  scenario = 'edited'; const start = calls.length, flight = begin();
  while (!release) await new Promise(r => setTimeout(r, 20));
  await mail.locator('#box').fill('Synthetic edited message.');
  release();
  const edited = await flight;
  assert.notEqual(edited.alert, 'none'); assert.equal(calls.length, start + 1);
  assert.equal(edited.loopStopped, 'superseded');
  console.log('PASS MV3 edited draft abandons follow-up before another charge');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
