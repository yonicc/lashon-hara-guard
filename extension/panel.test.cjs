const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
  return {
    className: '',
    children: [],
    textContent: '',
    title: '',
    setAttribute() {},
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    addEventListener() {},
  };
}

function harness() {
  const listeners = {};
  const sent = [];
  const document = {
    body: { children: [], contains(el) { return this.children.includes(el); }, appendChild(el) { this.children.push(el); return el; } },
    createElement: element,
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  const context = {
    console,
    document,
    window: { getSelection: () => ({ toString: () => '', anchorNode: null }) },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          callback({ alert: 'warn', mechanism: 'irony', evidence: 'טקסט סינתטי' });
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8'), context);
  return { context, listeners, sent };
}

test('panel: Ctrl+Shift+plus opens manual status without sending a check', () => {
  const { context, listeners, sent } = harness();
  context.LHG_PANEL.bindManualShortcut({ platform: 'gmail', direction: 'incoming' });
  assert.equal(typeof listeners.keydown, 'function');
  listeners.keydown({
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: '+',
    code: 'Equal',
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(context.LHG_PANEL.isVisible(), true);
  assert.equal(sent.length, 0);
});

test('panel: Ctrl+Shift+plus with selected text sends one incoming check', () => {
  const { context, listeners, sent } = harness();
  context.window.getSelection = () => ({ toString: () => 'טקסט סינתטי קצר', anchorNode: null });
  context.LHG_PANEL.bindManualShortcut({ platform: 'gmail', direction: 'incoming' });
  listeners.keydown({
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: '+',
    code: 'NumpadAdd',
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { text: sent[0].text, platform: sent[0].platform, direction: sent[0].direction },
    { text: 'טקסט סינתטי קצר', platform: 'gmail', direction: 'incoming' },
  );
  assert.equal(context.LHG_PANEL.isVisible(), true);
});
