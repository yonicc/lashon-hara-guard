'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('actual incoming scanner keeps baseline local and sends new packet snapshot once', async () => {
  const sent = [];
  const captures = [];
  const rows = [];
  const el = () => ({
    querySelector: () => null, appendChild() {},
  });
  const sb = {
    setTimeout: fn => setTimeout(fn, 0), clearTimeout,
    document: { createElement: () => ({ setAttribute() {} }) },
    chrome: { runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb({ alert: 'none' }); } } },
    LHG_SELECTORS: { weakId: (_platform, _el, text) => text },
    LHG_LOCAL_CONTEXT: { attach: () => ({ authorDisplayName: 'Synthetic Secret' }) },
    LHG_CONTEXT_RUNTIME: {
      prepare: async (payload, _el, remember) => {
        captures.push({ payload, remember });
        return { ...payload, context: { version: 1, currentAuthorRef: 'p1' } };
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'incoming.js'), 'utf8'), sb);
  rows.push({ el: el(), text: 'baseline synthetic message' });
  const scanner = sb.LHG_INCOMING.createScanner({ platform: 'whatsapp-web', findRows: () => rows, root: {} });
  scanner.scan();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sent.length, 0);
  assert.equal(captures.length, 1);
  rows.push({ el: el(), text: 'new synthetic message' });
  scanner.scan();
  scanner.scan();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  assert.equal(captures.length, 2);
  assert.equal(captures[1].remember, true);
  assert.equal(sent[0].context.currentAuthorRef, 'p1');
  assert.equal(JSON.stringify(sent[0]).includes('Synthetic Secret'), false);
});

test('builder scrubs newly discovered current author before truncation and preserves false facts', async () => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'context-builder.js'), 'utf8'), sb);
  const b = sb.LHG_CONTEXT_BUILDER.createContextBuilder({ store: {} });
  await b.ingestConversation({ id: 'c-test', platform: 'test' });
  await b.ingestMessage('c-test', { text: 'x'.repeat(290) + 'Synthetic Long Name', timestamp: 1 });
  await b.proposeFact('c-test', { id: 'topic', value: false });
  const p = await b.buildPacket('c-test', { authorDisplayName: 'Synthetic Long Name', direction: 'incoming', timestamp: 2 });
  assert.equal(p.recentMessages[0].text.includes('Synthetic'), false);
  assert.equal(p.facts[0].value, false);
  assert.equal(p.facts[0].status, 'candidate');
  assert.equal(typeof p.contextVersion, 'string');
  const hints = b.readDomHints(null);
  assert.equal(hints.forwarded, undefined);
});
