const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture() {
  const listeners = {}, calls = [], views = [];
  let sends = 0;
  const box = { innerText: 'Synthetic outgoing message.' };
  const c = vm.createContext({
    document: { addEventListener: (k,f) => listeners[k] = f },
    chrome: { runtime: { sendMessage() {} } }, Date,
    LHG_PANEL: { show: (...args) => views.push(args), hide() {},
      check: (p,b,o) => calls.push({p,b,o}) }
  });
  c.globalThis = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'compose-watch.js'),'utf8'),c);
  c.LHG_COMPOSE.createComposeWatcher({ platform:'gmail',
    composeBox: el => el === box ? box : null, findCompose: () => box,
    sendAction: () => ({box, send: () => sends++}) });
  const send = () => { const e = {preventDefault(){this.blocked=true},stopImmediatePropagation(){}};
    listeners.click(e); if (!e.blocked) sends++; return e; };
  return {c,box,calls,views,send,sends:()=>sends};
}
test('second native send bypasses an unresolved request and invalidates late results', () => {
  const f=fixture();
  assert.equal(f.send().blocked,true);
  assert.equal(f.calls.length,1);
  assert.equal(f.send().blocked,undefined);
  assert.equal(f.sends(),1);
  assert.equal(f.calls[0].o.isCurrent(),false);
  f.calls[0].o.onResult({alert:'none'});
  assert.equal(f.sends(),1);
  assert.equal(f.c.LHG_COMPOSE.recentlySent(f.box.innerText),true);
});
test('checking panel offers immediate bypass; late result and repeated bypass cannot send twice', () => {
  const f=fixture(); f.send();
  const bypass=f.views.at(-1)[3][0].onClick;
  bypass(); bypass();
  f.calls[0].o.onResult({alert:'none'});
  assert.equal(f.sends(),1);
  assert.equal(f.calls[0].o.isCurrent(),false);
});
test('error retains explicit bypass without automatically sending', () => {
  const f=fixture(); f.send();
  f.calls[0].o.onResult({alert:'not_checked',error:'offline'});
  assert.equal(f.sends(),0);
  f.calls[0].o.onBypass();
  assert.equal(f.sends(),1);
});
test('editing revokes a pending panel bypass', () => {
  const f=fixture(); f.send(); f.box.innerText='Different synthetic draft.';
  f.calls[0].o.onBypass();
  assert.equal(f.sends(),0);
});
