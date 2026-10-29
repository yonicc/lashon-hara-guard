// The ONE home of the settings presets: the 2x3 grid on the options page
// (columns cloud | combined | local, rows fast | accurate). A preset is only a
// named combination of existing switches; the switches themselves stay in
// check-mode.js (lhgCheckMode, lhgCloudFallback) and settings.js
// (lhgMemoryEnabled, lhgRouterEnabled). Loaded by options.html and tests.
//
// Levels are 1..5, higher = better for the user on that axis (cost 5 = free).
// The numbers behind them: docs/45 (warm 7B ~5-6 s on BI-1), docs/40 (local
// union vs single model), docs/36/44 (memory + router excerpts sent with a
// cloud check). Local engines extract facts only; they do not assess meaning.
(() => {
  if (globalThis.LHG_CHECK_PRESETS) return;

  const COLS = ['cloud', 'combined', 'local'];
  const ROWS = ['fast', 'accurate'];

  // mode/fallback -> check-mode.js; memory/router -> settings.js. `memory:
  // undefined` leaves the user's memory switches untouched (local presets:
  // memory never leaves the computer there, except through the fallback, and
  // the user decides that in "Advanced").
  const PRESETS = Object.freeze([
    { id: 'A', col: 'cloud', row: 'fast', mode: 'cloud', fallback: false, memory: false,
      levels: { speed: 5, accuracy: 3, privacy: 2, cost: 2 } },
    { id: 'B', col: 'cloud', row: 'accurate', mode: 'cloud', fallback: false, memory: true,
      levels: { speed: 4, accuracy: 5, privacy: 1, cost: 2 } },
    { id: 'C', col: 'combined', row: 'fast', mode: 'local-fast', fallback: true,
      levels: { speed: 3, accuracy: 2, privacy: 4, cost: 4 } },
    { id: 'D', col: 'combined', row: 'accurate', mode: 'local-union', fallback: true,
      levels: { speed: 2, accuracy: 3, privacy: 4, cost: 4 } },
    { id: 'E', col: 'local', row: 'fast', mode: 'local-fast', fallback: false,
      levels: { speed: 3, accuracy: 2, privacy: 5, cost: 5 } },
    { id: 'F', col: 'local', row: 'accurate', mode: 'local-union', fallback: false,
      levels: { speed: 2, accuracy: 3, privacy: 5, cost: 5 } },
  ].map((p) => Object.freeze({ ...p, levels: Object.freeze(p.levels) })));
  const AXES = ['speed', 'accuracy', 'privacy', 'cost'];

  const byId = (id) => PRESETS.find((p) => p.id === id) || null;

  // Which preset the current settings are, or null ("custom").
  // modePrefs = LHG_CHECK_MODE.normalize(...); settings = LHG_SETTINGS.get().
  function presetOf(modePrefs, settings) {
    const m = modePrefs || {};
    const s = settings || {};
    const memoryOn = s.lhgMemoryEnabled === true && s.lhgRouterEnabled === true;
    const memoryOff = s.lhgMemoryEnabled !== true && s.lhgRouterEnabled !== true;
    for (const p of PRESETS) {
      if (m.lhgCheckMode !== p.mode || (m.lhgCloudFallback === true) !== p.fallback) continue;
      if (p.memory === true && !memoryOn) continue;
      if (p.memory === false && !memoryOff) continue;
      return p.id;
    }
    return null;
  }

  // The writes for one preset: { mode: patch for check-mode keys, settings:
  // patch for settings.js or null }. The cloud model is never touched.
  function patchFor(id) {
    const p = byId(id);
    if (!p) throw new RangeError('unknown preset');
    return {
      mode: { lhgCheckMode: p.mode, lhgCloudFallback: p.fallback },
      settings: p.memory === undefined ? null
        : { lhgMemoryEnabled: p.memory, lhgRouterEnabled: p.memory },
    };
  }

  // A preset whose local engines are not ready must open the setup wizard
  // instead of switching: switching would leave every message not checked (or
  // silently in the cloud). localReady = LHG_CHECK_MODE.status() result.
  function needsInstall(id, localReady) {
    const p = byId(id);
    if (!p || p.mode === 'cloud') return false;
    return !(localReady && localReady[p.mode] === true);
  }

  globalThis.LHG_CHECK_PRESETS = { COLS, ROWS, AXES, PRESETS, byId, presetOf, patchFor, needsInstall };
})();
