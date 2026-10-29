// Settings presets grid (check-presets.js) over check-mode.js + settings.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load() {
  const c = vm.createContext({});
  c.globalThis = c;
  vm.runInContext(src('check-mode.js'), c);
  vm.runInContext(src('check-presets.js'), c);
  return { M: c.LHG_CHECK_MODE, P: c.LHG_CHECK_PRESETS };
}

test('presets: six cells, one per column x row, every mode is a real check mode', () => {
  const { M, P } = load();
  assert.equal(P.PRESETS.length, 6);
  const cells = new Set(P.PRESETS.map((p) => p.col + '/' + p.row));
  assert.equal(cells.size, 6);
  for (const p of P.PRESETS) {
    assert.ok(P.COLS.includes(p.col) && P.ROWS.includes(p.row), p.id);
    assert.ok(M.MODES.includes(p.mode), p.id);
    for (const a of P.AXES) assert.ok(p.levels[a] >= 1 && p.levels[a] <= 5, p.id + a);
    // Only the combined column may fall back to the cloud.
    assert.equal(p.fallback, p.col === 'combined', p.id);
    assert.equal(p.mode === 'cloud', p.col === 'cloud', p.id);
  }
});

test('presets: applying each preset is recognized back as that preset', () => {
  const { M, P } = load();
  for (const p of P.PRESETS) {
    const patch = P.patchFor(p.id);
    const mode = M.normalize({ lhgCloudModel: 'claude-haiku-5.5', ...patch.mode });
    const settings = { lhgMemoryEnabled: false, lhgRouterEnabled: false, ...(patch.settings || {}) };
    assert.equal(P.presetOf(mode, settings), p.id);
    assert.equal(mode.lhgCloudModel, 'claude-haiku-5.5', 'a preset never changes the cloud model');
  }
});

test('presets: default settings are A; mixed or unknown settings are custom (null)', () => {
  const { M, P } = load();
  assert.equal(P.presetOf(M.normalize({}), {}), 'A');
  assert.equal(P.presetOf(M.normalize({}), { lhgMemoryEnabled: true }), null); // memory without router
  assert.equal(P.presetOf(M.normalize({ lhgCheckMode: 'local-hebrew' }), {}), null);
  assert.equal(P.presetOf(M.normalize({ lhgCheckMode: 'cloud', lhgCloudFallback: true }), {}), null);
  // Local presets ignore the memory switches.
  assert.equal(P.presetOf(M.normalize({ lhgCheckMode: 'local-union' }), { lhgMemoryEnabled: true, lhgRouterEnabled: true }), 'F');
  assert.throws(() => P.patchFor('Z'), { name: 'RangeError' }); // vm realm: compare by name
});

test('presets: B turns memory + router on, A turns both off, local presets leave them alone', () => {
  const { P } = load();
  assert.deepEqual(plain(P.patchFor('B').settings), { lhgMemoryEnabled: true, lhgRouterEnabled: true });
  assert.deepEqual(plain(P.patchFor('A').settings), { lhgMemoryEnabled: false, lhgRouterEnabled: false });
  for (const id of ['C', 'D', 'E', 'F']) assert.equal(P.patchFor(id).settings, null, id);
});

test('presets: a local preset whose engines are not ready needs install; cloud never does', () => {
  const { P } = load();
  const none = {};
  const fastOnly = { 'local-fast': true, 'local-union': false };
  for (const id of ['A', 'B']) assert.equal(P.needsInstall(id, none), false);
  for (const id of ['C', 'D', 'E', 'F']) assert.equal(P.needsInstall(id, none), true, id);
  assert.equal(P.needsInstall('E', fastOnly), false);
  assert.equal(P.needsInstall('C', fastOnly), false);
  assert.equal(P.needsInstall('F', fastOnly), true);
});
