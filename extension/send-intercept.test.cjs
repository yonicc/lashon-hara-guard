const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('send interception: typing is silent, stale approval rejected, current safe result sends once', () => {
  const listeners = {}, calls = [];
  let sends = 0;
  const box = { innerText: 'original draft' };
  const button = { textContent: 'Send', setAttribute() {}, removeAttribute() {} };
  const c = vm.createContext({
    document: { addEventListener: (k, f) => { listeners[k] = f; } },
    chrome: { runtime: { sendMessage() {} } }, setTimeout, clearTimeout, Date,
    LHG_PANEL: { show() {}, hide() {}, check: (p, b, o) => calls.push({ p, b, o }) }
  });
  c.globalThis = c;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'compose-watch.js'), 'utf8'), c);
  c.LHG_COMPOSE.createComposeWatcher({
    platform: 'gmail', composeBox: x => x === box ? box : null, findCompose: () => box,
    sendAction: () => ({ box, button, send: () => sends++ })
  });
  const event = () => ({ target: box, preventDefault() { this.blocked = true; }, stopImmediatePropagation() {} });
  listeners.input(event());
  assert.equal(calls.length, 0);
  const e = event(); listeners.click(e);
  assert.equal(e.blocked, true);
  assert.equal(calls.length, 1);
  assert.equal(button.textContent, 'Send');
  box.innerText = 'changed draft';
  listeners.input(event());
  calls[0].o.onResult({ alert: 'none' });
  assert.equal(sends, 0);
  listeners.keydown(event());
  assert.equal(calls[1].p.text, 'changed draft');
  calls[1].o.onResult({ alert: 'none' });
  calls[1].o.onResult({ alert: 'none' });
  assert.equal(sends, 1);
  assert.equal(button.textContent, 'Send');
  box.innerText = 'warning draft';
  listeners.click(event());
  calls[2].o.onResult({ alert: 'warn' });
  assert.equal(sends, 1, 'a warning never sends automatically');
  calls[2].o.onApprove();
  calls[2].o.onApprove();
  assert.equal(sends, 2, 'explicit approval sends once');
  box.innerText = 'another warning draft';
  listeners.click(event());
  calls[3].o.onResult({ alert: 'warn' });
  box.innerText = 'edited after warning';
  listeners.input(event());
  calls[3].o.onApprove();
  assert.equal(sends, 2, 'an edit revokes warning approval');
  listeners.click(event());
  calls[4].o.onResult({ alert: 'none', rules: { notChecked: true } });
  assert.equal(sends, 2, 'a failed rules check cannot release native send');
});
