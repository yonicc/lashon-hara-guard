const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument } = require('./mini-dom.testlib.cjs');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function storage(initial = {}) {
  const data = { ...initial }, listeners = [];
  return {
    local: {
      get(keys, cb) {
        const ks = Array.isArray(keys) ? keys : [keys];
        const out = Object.fromEntries(ks.filter(k => k in data).map(k => [k, data[k]]));
        if (cb) cb(out); else return Promise.resolve(out);
      },
      set(patch, cb) {
        Object.assign(data, patch);
        for (const fn of listeners) fn(Object.fromEntries(Object.entries(patch).map(([k,v]) => [k,{newValue:v}])), 'local');
        cb?.();
        return Promise.resolve();
      }
    },
    onChanged: { addListener: fn => listeners.push(fn) }
  };
}
function scanner() {
  const st = storage({ lhgIncomingManual: false, hideIncoming: false });
  const timers = [], sent = [], document = createDocument();
  const c = vm.createContext({
    document, Date, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    addEventListener() {},
    chrome: { storage: st, runtime: { sendMessage: (m, cb) => sent.push({m, cb}) } },
    LHG_SELECTORS: { weakId: (p, el, text) => p + text }
  });
  for (const f of ['settings.js','incoming.js']) vm.runInContext(read(f), c);
  let rows = [];
  const sc = c.LHG_INCOMING.createScanner({ platform: 'google-chat', findRows: () => rows, hold: () => false });
  return { c, st, sc, sent, timers, add(text) {
    const el = document.createElement('div'); el.textContent = text; document.body.appendChild(el);
    rows.push({el, text}); return el;
  }};
}
test('disable cancels queued checks even if switched back on before the pacing timer fires', async () => {
  const e = scanner(); await settle(); e.sc.scan();
  const first = e.add('First synthetic incoming message'); e.sc.scan();
  e.add('Second synthetic incoming message'); e.sc.scan();
  assert.ok(first.querySelector('.lhg-tag'));
  e.st.local.set({lhgEnabled:false});
  assert.equal(first.querySelector('.lhg-tag'), null);
  e.add('Synthetic message arriving while disabled');
  // No scan runs while disabled: the switch itself must reset the baseline.
  e.st.local.set({lhgEnabled:true});
  await settle();
  while (e.timers.length) { e.timers.shift()(); await settle(); }
  assert.equal(e.sent.length, 0, 'cancelled jobs and disabled-period history never send');
  e.add('New synthetic live message after enabling'); e.sc.scan();
  while (e.timers.length) { e.timers.shift()(); await settle(); }
  assert.equal(e.sent.length, 1, 'new live checks still work');
});
function worker(initial) {
  const st = storage({accessKey:'synthetic-key', ...initial}), calls = [];
  let listener;
  const c = vm.createContext({
    setTimeout, clearTimeout, AbortController,
    chrome:{storage:st, runtime:{onMessage:{addListener:fn => listener=fn}}},
    fetch: async (url) => { calls.push(url); return {ok:true,status:200,json:async()=>({alert:'none'})}; }
  });
  for (const f of ['settings.js','background.js']) vm.runInContext(read(f), c);
  return {c, st, calls,
    ask: platform => new Promise(resolve => listener({type:'lhg-check',text:'Synthetic test message',platform}, {}, resolve)),
    warm: platform => listener({type:'lhg-warm',platform}, {}, ()=>{})
  };
}
test('background refuses checks and warmups for master or platform disable', async () => {
  for (const switches of [{lhgEnabled:false},{lhgPlatforms:{gmail:false}}]) {
    const e=worker(switches);
    assert.equal((await e.ask('gmail')).error,'disabled');
    e.warm('gmail'); await settle();
    assert.equal(e.calls.length,0);
    await e.st.local.set({lhgEnabled:true,lhgPlatforms:{gmail:true}});
    assert.equal((await e.ask('gmail')).alert,'none');
    assert.equal(e.calls.length,1);
  }
});
test('turning off during a response suppresses further context rounds and late approval', async () => {
  const e=worker({});
  let finish;
  e.c.fetch=async()=>new Promise(resolve=>{finish=resolve; e.calls.push('check');});
  e.c.LHG_NEEDS={};
  e.c.LHG_CONTEXT_LOOP={run:async({request,check,current})=>{
    const result=await check(request);
    if(await current(2)) await check(request);
    return result;
  }};
  const result=e.ask('gmail'); await settle();
  assert.ok(finish);
  await e.st.local.set({lhgEnabled:false});
  finish({ok:true,status:200,json:async()=>({alert:'none'})});
  assert.equal((await result).error,'disabled');
  assert.equal(e.calls.length,1);
});
