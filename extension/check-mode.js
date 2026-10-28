// The ONE home of the check mode (cloud or local) and of the cloud model
// choice. Loaded by background.js (routing), options/popup (UI) and tests.
//
// chrome.storage.local keys:
//   lhgCheckMode      'cloud' (default) | 'local-fast' | 'local-hebrew' | 'local-union'
//   lhgCloudFallback  boolean, default false: a local mode that cannot run goes to the cloud
//   lhgCloudModel     an id from CLOUD_MODELS, default DEFAULT_CLOUD_MODEL
//
// background.js registers loopback Ollama engines (docs/45). A
// local mode that cannot run is NOT CHECKED (error 'local_unavailable'), and
// it reaches the cloud only when the user turned on lhgCloudFallback. It
// never becomes 'none', and it never silently replaces the user's choice.
//
// The cloud model id list must equal the proxy's allow-list
// (proxy/src/cloudModels.ts, the real gate); proxy/test/cloudModels.test.ts
// fails when the two differ. The default model sends NO `model` field, so the
// request stays byte-identical to what older extensions send.
(() => {
  if (globalThis.LHG_CHECK_MODE) return;

  const MODES = ['cloud', 'local-fast', 'local-hebrew', 'local-union'];
  const DEFAULT_MODE = 'cloud';
  const KEYS = ['lhgCheckMode', 'lhgCloudFallback', 'lhgCloudModel'];

  // Local engine ids per mode (docs/40 GGUF Q4_K_M measurements).
  const LOCAL_ENGINES = {
    'local-fast': ['extractor-7b-q4'],
    'local-hebrew': ['dictalm-q4'],
    'local-union': ['extractor-7b-q4', 'dictalm-q4'],
  };

  // Product names, not translated (i18n.js holds the surrounding texts).
  const DEFAULT_CLOUD_MODEL = 'muse-spark-1.3';
  const CLOUD_MODELS = [
    { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 (Meta)' },
    { id: 'muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor (Meta)' },
    { id: 'muse-spark-1.2', label: 'Muse Spark 1.2 (Meta)' },
    { id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (OpenRouter)' },
    { id: 'claude-haiku-5.5', label: 'Claude Haiku 5.5 (OpenRouter)' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini (OpenRouter)' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano (OpenRouter)' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (OpenRouter)' },
    { id: 'mistral-medium-3.5', label: 'Mistral Medium 3.5 (OpenRouter)' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (OpenRouter)' },
    { id: 'kimi-k3-modal', label: 'Kimi K3 (Modal)' },
    { id: 'muse-spark-open-1026', label: 'Muse Spark Open 1026 (Baseten)' },
  ];
  const MODEL_IDS = CLOUD_MODELS.map((m) => m.id);

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      lhgCheckMode: MODES.includes(s.lhgCheckMode) ? s.lhgCheckMode : DEFAULT_MODE,
      lhgCloudFallback: s.lhgCloudFallback === true,
      lhgCloudModel: MODEL_IDS.includes(s.lhgCloudModel) ? s.lhgCloudModel : DEFAULT_CLOUD_MODEL,
    };
  }

  // The `model` value for POST /check: null (field omitted) for the default.
  function modelParam(prefs) {
    const m = normalize(prefs).lhgCloudModel;
    return m === DEFAULT_CLOUD_MODEL ? null : m;
  }

  // --- the interface the future local implementation plugs into -------------
  // engine = {
  //   id:          one of the LOCAL_ENGINES ids,
  //   available(): Promise<boolean>  — model file present and loadable,
  //   check(req):  Promise<CheckResponse> — the /check response shape (docs/18):
  //                { alert: 'warn'|'unsure'|'none'|'not_checked', ... }.
  //                A failure must be 'not_checked' or a throw, never 'none'.
  // }
  // req = { text, platform, direction, context, confirmedFacts, userNote, lang }.
  const engines = new Map();
  function registerLocalEngine(engine) {
    if (!engine || typeof engine.id !== 'string' || typeof engine.check !== 'function' ||
        typeof engine.available !== 'function') throw new TypeError('bad local engine');
    engines.set(engine.id, engine);
  }
  const unregisterLocalEngine = (id) => engines.delete(id);

  async function engineReady(id) {
    const e = engines.get(id);
    if (!e) return false;
    try { return (await e.available()) === true; } catch (_e) { return false; }
  }

  // Availability per local mode, for the options UI.
  async function status() {
    const out = {};
    for (const [mode, ids] of Object.entries(LOCAL_ENGINES)) {
      out[mode] = (await Promise.all(ids.map(engineReady))).every(Boolean);
    }
    return out;
  }

  // Union of several engines: the most cautious alert wins. A failed engine
  // makes the union not_checked unless another engine already warns.
  const RANK = { warn: 4, not_checked: 3, unsure: 2, none: 1 };
  function combine(results) {
    let best = null;
    for (const r0 of results) {
      const r = r0 && RANK[r0.alert] ? r0 : { alert: 'not_checked', error: 'local_bad_result' };
      if (!best || RANK[r.alert] > RANK[best.alert]) best = r;
    }
    return best || { alert: 'not_checked', error: 'local_unavailable' };
  }

  // Route one check. cloudCheck(model) performs POST /check (model = null for
  // the default) and resolves to its response.
  async function route(req, prefs, cloudCheck) {
    const p = normalize(prefs);
    if (p.lhgCheckMode === 'cloud') return cloudCheck(modelParam(p));
    const localMode = p.lhgCheckMode;
    const ids = LOCAL_ENGINES[localMode];
    const ready = (await Promise.all(ids.map(engineReady))).every(Boolean);
    let error = 'local_unavailable';
    if (ready) {
      const results = await Promise.all(ids.map(async (id) => {
        try { return await engines.get(id).check(req); } catch (_e) { return { alert: 'not_checked', error: 'local_failed' }; }
      }));
      const out = combine(results);
      if (out.alert !== 'not_checked') return { ...out, checkedBy: 'local', localMode };
      error = out.error || 'local_failed';
    }
    if (!p.lhgCloudFallback) return { alert: 'not_checked', error, checkedBy: 'none', localMode };
    const r = await cloudCheck(modelParam(p));
    return { ...r, checkedBy: 'cloud-fallback', localMode };
  }

  globalThis.LHG_CHECK_MODE = {
    MODES, DEFAULT_MODE, KEYS, LOCAL_ENGINES, CLOUD_MODELS, DEFAULT_CLOUD_MODEL,
    normalize, modelParam, registerLocalEngine, unregisterLocalEngine, status, combine, route,
  };
})();
