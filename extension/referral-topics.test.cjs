// Owner 2026-11-01: the Simple referral line in English must name the real
// topic ("Answering gossip about you (10:16)"), never a generic "Ask a rabbi".
// Every group-D section the engine can refer must have a short English topic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const ctx = vm.createContext({});
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'referral-topics.js'), 'utf8'), ctx);
  return ctx.LHG_REFERRAL_TOPICS;
}

function groupDKeys() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'src', 'chafetzChaim', 'referralData.ts'), 'utf8');
  const data = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  return data.filter((s) => s.disposition === 'blocked' || s.chatFeasibility === 'external_evidence').map((s) => s.key);
}

test('every group-D section has a short English topic with no Hebrew', () => {
  const T = load();
  const keys = groupDKeys();
  assert.equal(keys.length, 73);
  for (const k of keys) {
    const en = T.topic(k, 'en');
    assert.ok(en, 'English topic for ' + k);
    assert.ok(!/[֐-׿]/.test(en), 'no Hebrew in English topic ' + k);
    assert.ok(en.split(/\s+/).length <= 7, 'kid-simple (short) topic ' + k + ': ' + en);
    assert.ok(!/ask a rabbi/i.test(en), 'not a generic phrase ' + k);
  }
});

test('sections without a server Hebrew topic get a Hebrew topic from the table', () => {
  const T = load();
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'src', 'chafetzChaim', 'referralData.ts'), 'utf8');
  const data = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  for (const s of data.filter((x) => x.disposition === 'blocked' || x.chatFeasibility === 'external_evidence')) {
    const cat = (s.blocker && s.blocker.category) || 'external_evidence_partial';
    const scope = s.implementedScopeHe || '';
    const serverTopicUsable = cat === 'external_evidence_partial' && scope && !scope.startsWith('אין כלל');
    if (!serverTopicUsable) assert.ok(T.topic(s.key, 'he'), 'Hebrew topic for ' + s.key);
  }
});
