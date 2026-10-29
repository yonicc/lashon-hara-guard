// Loopback-only Ollama transport. No credentials, redirects or remote fallback.
(() => {
  const BASE = 'http://127.0.0.1:11434';
  const DEFAULT_MODEL = 'extractor-7b-q4';
  const SPECS = Object.freeze({
    'extractor-7b-q4': Object.freeze({
      ref: 'hf.co/yonicc/lhg-extractor-qwen7b-v2-gguf:Q4_K_M', contract: 'v2', template: 'qwen',
    }),
    'dictalm-q4': Object.freeze({
      ref: 'hf.co/yonicc/lhg-extractor-dictalm-gguf:Q4_K_M', contract: 'v1', template: 'mistral',
    }),
  });
  const MODELS = Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([id, spec]) => [id, spec.ref])));
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
      async inspect() {
        const data = await request('/api/tags', undefined, 2000);
        if (!Array.isArray(data.models)) throw new Error('ollama_bad_models');
        return Object.fromEntries(Object.keys(MODELS).map(id => [id,
          data.models.some(m => m.name === MODELS[id] || m.model === MODELS[id])]));
      },
      async pull(id, onProgress, signal) {
        if (!MODELS[id]) throw new Error('ollama_unknown_model');
        const abort = new AbortController();
        const cancel = () => abort.abort();
        if (signal?.aborted) abort.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, 30 * 60 * 1000);
        let reader;
        try {
          const response = await fetchImpl(BASE + '/api/pull', {
            method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
            signal: abort.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODELS[id], stream: true }),
          });
          if (!response.ok) throw new Error('ollama_http_' + response.status);
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '', success = false;
          function line(text) {
            if (!text.trim()) return;
            const data = JSON.parse(text);
            if (data.error) throw new Error('ollama_pull_failed');
            if (data.status === 'success') success = true;
            const total = Number(data.total), completed = Number(data.completed);
            onProgress({ id, percent: Number.isFinite(total) && total > 0 &&
              Number.isFinite(completed) && completed >= 0
              ? Math.min(100, Math.floor(100 * completed / total)) : null });
          }
          while (true) {
            const part = await reader.read();
            pending += decoder.decode(part.value, { stream: !part.done });
            const lines = pending.split('\n'); pending = lines.pop();
            for (const text of lines) {
              if (text.length > 65536) throw new Error('ollama_progress_too_large');
              line(text);
            }
            if (pending.length > 65536) throw new Error('ollama_progress_too_large');
            if (part.done) { line(pending); break; }
          }
          if (!success) throw new Error('ollama_pull_incomplete');
        } finally {
          clearTimeout(timer); signal?.removeEventListener('abort', cancel);
          if (reader) { try { await reader.cancel(); } catch (_) {} }
        }
      },
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
          logprobs: true, options: { temperature: 0, num_predict: 256 },
        });
        if (data.done !== true || typeof data.response !== 'string') throw new Error('ollama_incomplete');
        // A truncated generation is not a complete extraction.
        if (data.done_reason === 'length') throw new Error('ollama_token_limit');
        const output = parse(data.response);
        return { output, scores: scoreKeys(data.response, data.logprobs) };
      },
    };
  }
  // Per-key model probability, read from the server's own token logprobs:
  // min(P(first token of the key), P(token deciding true/false)). Nothing is
  // invented: if logprobs are absent or do not line up with the response,
  // no score is returned and canonical factPolicy rejects the proposal.
  function scoreKeys(response, logprobs) {
    if (!Array.isArray(logprobs) || !logprobs.length) return {};
    const enc = new TextEncoder();
    const starts = []; let pos = 0;
    for (const t of logprobs) {
      if (!t || typeof t.logprob !== 'number' || !Number.isFinite(t.logprob) || t.logprob > 0) return {};
      const len = Array.isArray(t.bytes) ? t.bytes.length
        : typeof t.token === 'string' ? enc.encode(t.token).length : -1;
      if (len < 0) return {};
      starts.push(pos); pos += len;
    }
    const raw = enc.encode(response);
    // The tokens must reproduce the response byte for byte; otherwise offsets are unknown.
    if (pos !== raw.length) return {};
    const shift = 0;
    if (logprobs.every(t => Array.isArray(t.bytes))) {
      const all = new Uint8Array(pos); let o = 0;
      for (const t of logprobs) { all.set(t.bytes, o); o += t.bytes.length; }
      for (let i = 0; i < raw.length; i++) if (all[i] !== raw[i]) return {};
    } else if (logprobs.map(t => t.token).join('') !== response) {
      return {};
    }
    const tokenAt = byte => {
      const b = byte + shift; let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= b) lo = mid; else hi = mid - 1; }
      return Math.exp(logprobs[lo].logprob);
    };
    const byteOf = index => enc.encode(response.slice(0, index)).length;
    const scores = {};
    const re = /"([A-Za-z0-9_]+)"\s*:\s*\[\s*(true|false)/g;
    for (let m; (m = re.exec(response));) {
      const key = m[1];
      const keyAt = m.index + 1;
      const valueAt = m.index + m[0].length - m[2].length;
      const p = Math.min(tokenAt(byteOf(keyAt)), tokenAt(byteOf(valueAt)));
      // A duplicated key is ambiguous: keep no score for it.
      scores[key] = Object.prototype.hasOwnProperty.call(scores, key) ? NaN : p;
    }
    for (const k of Object.keys(scores)) if (!Number.isFinite(scores[k])) delete scores[k];
    return scores;
  }
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > 32768) throw new Error('ollama_bad_output');
    const text = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*\n?([\s\S]*?)\n?\x60\x60\x60$/i, '$1');
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('ollama_bad_output');
    return parsed;
  }
  globalThis.LHG_OLLAMA_CLIENT = { MODELS, SPECS, DEFAULT_MODEL, create, parse, scoreKeys };
})();
