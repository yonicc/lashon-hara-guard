'use strict';
// Send-time chrome ("59 דקות", an author + send-time header) must never be
// sampled as message text. Regression for the Google Chat header seen
// 2026-10-27: "יעקב שוהם 59 דקות" was checked and tagged as a message.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSelectors() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'selectors.js'), 'utf8'), context);
  return context.LHG_SELECTORS;
}

test('time-only stamps are recognised (relative, clock, date)', () => {
  const S = loadSelectors();
  assert.equal(S.isTimeOnly('59 דקות'), true);
  assert.equal(S.isTimeOnly('לפני שעה'), true);
  assert.equal(S.isTimeOnly('59 minutes ago'), true);
  assert.equal(S.isTimeOnly('10:23'), true);
  assert.equal(S.isTimeOnly('היום'), true);
  assert.equal(S.isTimeOnly('הודעה אמיתית'), false);
  assert.equal(S.isTimeOnly('חיכיתי 59 דקות ליד הדלת'), false);
});

test('author + send-time header line is recognised as chrome', () => {
  const S = loadSelectors();
  assert.equal(S.isMessageHeader('יעקב שוהם 59 דקות'), true);
  assert.equal(S.isMessageHeader('יעקב שוהם 10:23'), true);
  assert.equal(S.isMessageHeader('Yaakov Shoham 59 minutes ago'), true);
  assert.equal(S.isMessageHeader('הודעה אמיתית בלי זמן'), false);
  assert.equal(S.isMessageHeader('שורה ראשונה\nיעקב שוהם 59 דקות'), false);
});

test('cleanText drops send-time chrome but keeps the body', () => {
  const S = loadSelectors();
  assert.equal(S.cleanText('59 דקות\nתוכן ההודעה האמיתי'), 'תוכן ההודעה האמיתי');
  assert.equal(S.cleanText('יעקב שוהם 59 דקות\nתוכן ההודעה האמיתי'), 'תוכן ההודעה האמיתי');
  assert.equal(S.cleanText('היום\nיעקב שוהם 10:23\nתוכן ההודעה האמיתי'), 'תוכן ההודעה האמיתי');
  assert.equal(S.cleanText('תוכן ההודעה האמיתי\n14:59'), 'תוכן ההודעה האמיתי');
  assert.equal(S.cleanText('59 דקות'), '');
});

test('cleanText keeps a time phrase inside a real sentence', () => {
  const S = loadSelectors();
  assert.equal(S.cleanText('חיכיתי 59 דקות ליד הדלת'), 'חיכיתי 59 דקות ליד הדלת');
  assert.equal(S.cleanText('נפגש מחר ב-10:30 בבית שלי'), 'נפגש מחר ב-10:30 בבית שלי');
  assert.equal(S.cleanText('שלום לכולם\nמה נשמע אצלכם'), 'שלום לכולם\nמה נשמע אצלכם');
});
