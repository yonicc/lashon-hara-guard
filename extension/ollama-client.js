// Loopback-only Ollama transport. No credentials, redirects or remote fallback.
(() => {
  const BASE = 'http://127.0.0.1:11434';
  const MODELS = Object.freeze({
    'extractor-7b-q4': 'hf.co/yonicc/lhg-extractor-qwen7b-gguf:Q4_K_M',
    'dictalm-q4': 'hf.co/yonicc/lhg-extractor-dictalm-gguf:Q4_K_M',
  });
  function create({ fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
    async function request(path, body, budget = timeoutMs) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), budget);
      try {
        const response = await fetchImpl(BASE + path, {
          method: body ? 'POST' : 'GET', redirect: 'error',
          credentials: 'omit', cache: 'no-store', signal: abort.signal,
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error('ollama_http_' + response.status);
        const text = await response.text();
        if (text.length > 262144) throw new Error('ollama_response_too_large');
        return JSON.parse(text);
      } finally { clearTimeout(timer); }
    }
    return {
      async available(id) {
        if (!MODELS[id]) return false;
        try {
          const data = await request('/api/tags', undefined, Math.min(timeoutMs, 2000));
          return Array.isArray(data.models) && data.models.some(m => m.name === MODELS[id] || m.model === MODELS[id]);
        } catch (_) { return false; }
      },
      async generate(id, prompt) {
        if (!MODELS[id]) throw new Error('ollama_unknown_model');
        if (typeof prompt !== 'string' || prompt.length > 65536) throw new Error('ollama_bad_prompt');
        const data = await request('/api/generate', {
          model: MODELS[id], prompt, raw: true, stream: false,
          options: { temperature: 0, num_predict: 256 },
        });
        if (data.done !== true || typeof data.response !== 'string') throw new Error('ollama_incomplete');
        return parse(data.response);
      },
    };
  }
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > 32768) throw new Error('ollama_bad_output');
    const text = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*\n?([\s\S]*?)\n?\x60\x60\x60$/i, '$1');
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('ollama_bad_output');
    return parsed;
  }
  globalThis.LHG_OLLAMA_CLIENT = { MODELS, create, parse };
})();
