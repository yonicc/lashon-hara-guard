const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
function worker(store, network) {
  let handler;
  const c = vm.createContext({
    crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, AbortController,
    chrome: { storage: { local: {
      get: async key => Array.isArray(key) ? { accessKey: 'synthetic-key', lhgDeciderArtifact: store.lhgDeciderArtifact } : { [key]: store[key] },
      set: async value => Object.assign(store, value)
    } }, runtime: { onMessage: { addListener: fn => handler = fn } } },
    fetch: async (url, init) => ({ ok: true, status: 200, json: async () => network(JSON.parse(init.body)) })
  });
  c.globalThis = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), c);
  return extra => new Promise(resolve => handler({
    type: 'lhg-check', platform: 'gmail', direction: 'incoming', text: 'synthetic message',
    cacheIdentity: { accountId: 'one@example.test', conversationId: 'thread-a' },
    context: { recentMessages: [{ text: 'earlier message' }] }, ...extra
  }, {}, resolve));
}
test('cache: persists across worker restart; changed text/context/account/thread and forced recheck miss', async () => {
  const store = {}; let count = 0;
  const network = () => { count++; return { alert: 'none' }; };
  await worker(store, network)({});
  const ask = worker(store, network);
  await ask({}); assert.equal(count, 1);
  await ask({ text: 'changed message' });
  await ask({ context: { recentMessages: [{ text: 'changed history' }] } });
  await ask({ cacheIdentity: { accountId: 'two@example.test', conversationId: 'thread-a' } });
  await ask({ cacheIdentity: { accountId: 'one@example.test', conversationId: 'thread-b' } });
  await ask({ forceRecheck: true });
  assert.equal(count, 6);
  assert.ok(Object.keys(store).every(k => /^lhg-check-v1-[a-f0-9]{64}$/.test(k)));
  assert.doesNotMatch(JSON.stringify(store), /synthetic-key|synthetic message|example.test/);
});
test('cache: identical concurrent checks share one request; errors are not persisted', { timeout: 2000 }, async () => {
  const store = {}; let count = 0, finish;
  const ask = worker(store, () => { count++; return new Promise(resolve => { finish = resolve; }); });
  const first = ask({}), second = ask({});
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  finish({ alert: 'not_checked', error: 'network' });
  await Promise.all([first, second]);
  assert.equal(count, 1); assert.equal(Object.keys(store).length, 0);
  let retried = 0;
  await worker(store, () => { retried++; return { alert: 'warn' }; })({});
  assert.equal(retried, 1); assert.equal(Object.keys(store).length, 1);
});
test('cache: unknown account does not persist an approval', async () => {
  const store = {}; let count = 0;
  const ask = worker(store, () => { count++; return { alert: 'none' }; });
  await ask({ cacheIdentity: null }); await ask({ cacheIdentity: null });
  assert.equal(count, 2); assert.equal(Object.keys(store).length, 0);
});
test('cache: importing a decider invalidates a fact-only result; transient meaning failure is retried', async () => {
 const store={};let count=0;
 const ask=worker(store,()=>{count++;return {alert:'unsure'};});
 await ask({});await ask({});assert.equal(count,1);
 store.lhgDeciderArtifact='synthetic-decider-v1';
 await ask({});assert.equal(count,2);
 const failed=worker(store,()=>{count++;return {alert:'unsure',meaning:{status:'unavailable'}};});
 await failed({text:'new synthetic'});await failed({text:'new synthetic'});assert.equal(count,4);
});
