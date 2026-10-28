// Chafetz Chaim draft rules (live_draft, owner 2026-10-27; docs/18) — the
// extension side of the wire contract with the proxy:
//   request  confirmedFacts?: Record<factId, boolean|null>   (<= 20)
//   response rules?: { mode:'live_draft', notChecked?, findings[], questions?, question? }
// Question budget 1 -> up to 5 (owner 2026-10-29, docs/40 §A, docs/41): the
// proxy sends `questions[]`; `question` (singular) is the back-compat mirror
// of questions[0]. We read both, preferring the array.
// This file owns the user's ANSWERS: stored locally per conversation (the key
// is a hash of the local conversation identity, never the name itself),
// cumulative, at most MAX_FACTS (the most recent answers win). null = "don't
// know" and stays unknown. Display lives in panel.js. Nothing here ever
// turns an answer into "permitted": the proxy only asks/flags.
(() => {
  const R = (globalThis.LHG_RULES = globalThis.LHG_RULES || {});
  const MAX_FACTS = 20;
  // Free-text note sent beside the checked text (POST /check `userNote`).
  // The proxy enforces the same cap (proxy/src/limits.ts MAX_USER_NOTE_CHARS).
  // A note is context for the explanation only: it is never a confirmedFact.
  const USER_NOTE_MAX = 500;
  const MAX_CONVERSATIONS = 200;
  const STORE_KEY = 'lhgConfirmedFacts';
  const FACT_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + ':' + s.length;
  }

  // Local conversation identity -> opaque storage key; null when unknown.
  function conversationKey(platform, el) {
    try {
      const k = globalThis.LHG_CONTEXT_RUNTIME && globalThis.LHG_CONTEXT_RUNTIME.conversationKey
        ? globalThis.LHG_CONTEXT_RUNTIME.conversationKey(platform, el)
        : null;
      return k ? 'c' + hash(String(k)) : null;
    } catch (_e) {
      return null;
    }
  }

  // Untrusted -> { factId: true|false|null }, at most MAX_FACTS, later entries win.
  function sanitize(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const entries = Object.entries(raw).filter(([id, v]) => FACT_ID.test(id) && (v === true || v === false || v === null));
    for (const [id, v] of entries.slice(-MAX_FACTS)) out[id] = v;
    return out;
  }

  function storage() {
    try { return chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (_e) { return null; }
  }
  function readAll() {
    const st = storage();
    if (!st) return Promise.resolve({});
    return new Promise((resolve) => {
      try { st.get([STORE_KEY], (s) => resolve((s && s[STORE_KEY]) || {})); } catch (_e) { resolve({}); }
    });
  }
  function writeAll(all) {
    const st = storage();
    if (!st) return Promise.resolve();
    return new Promise((resolve) => {
      try { st.set({ [STORE_KEY]: all }, () => resolve()); } catch (_e) { resolve(); }
    });
  }

  // Answers for a conversation (already sanitized). Never rejects.
  // Unknown conversation (no stable identity): nothing is kept across checks,
  // so answers can never leak from one conversation into another.
  function loadAnswers(conv) {
    if (!conv) return Promise.resolve({});
    return readAll().then((all) => sanitize(all[conv] && all[conv].facts), () => ({}));
  }

  // Record one answer; resolves with the cumulative answers (<= MAX_FACTS).
  // prev: the answers already sent in this check (used when conv is unknown).
  let answerWrites = Promise.resolve();
  function saveAnswer(conv, factId, value, prev) {
    const result = answerWrites.then(() => persistAnswer(conv, factId, value, prev));
    answerWrites = result.catch(() => {});
    return result;
  }
  function persistAnswer(conv, factId, value, prev) {
    if (!FACT_ID.test(String(factId)) || !(value === true || value === false || value === null)) {
      return conv ? loadAnswers(conv) : Promise.resolve(sanitize(prev));
    }
    const merge = (prev) => {
      const facts = { ...sanitize(prev) };
      delete facts[factId]; // re-insert last: the newest answer survives the cap
      facts[factId] = value;
      return sanitize(facts);
    };
    if (!conv) {
      return Promise.resolve(merge(prev));
    }
    return readAll().then((all) => {
      const facts = merge(all[conv] && all[conv].facts);
      const next = { ...all, [conv]: { facts, at: Date.now() } };
      const keys = Object.keys(next);
      if (keys.length > MAX_CONVERSATIONS) {
        keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
        for (const k of keys.slice(0, keys.length - MAX_CONVERSATIONS)) delete next[k];
      }
      return writeAll(next).then(() => facts);
    }, () => merge({}));
  }

  // Payload + the conversation's cumulative answers (only when there are any).
  function withAnswers(payload, facts) {
    const f = sanitize(facts);
    return Object.keys(f).length ? { ...payload, confirmedFacts: f } : payload;
  }

  // The rules block of a /check response, normalised for display; null when
  // absent or not the live_draft mode (an old proxy or rules off).
  function readRules(r) {
    const rules = r && r.rules;
    if (!rules || typeof rules !== 'object' || rules.mode !== 'live_draft') return null;
    const findings = (Array.isArray(rules.findings) ? rules.findings : [])
      .filter((f) => f && typeof f.messageHe === 'string' && f.messageHe.trim())
      .map((f) => ({
        messageHe: f.messageHe,
        sourceRef: typeof f.sourceRef === 'string' ? f.sourceRef : '',
        sourceUrl: typeof f.sourceUrl === 'string' && /^https:\/\//.test(f.sourceUrl) ? f.sourceUrl : '',
      }));
    const pickQ = (q) => q && typeof q.factId === 'string' && FACT_ID.test(q.factId) && typeof q.textHe === 'string'
      ? {
          factId: q.factId,
          textHe: q.textHe,
          answers: (Array.isArray(q.answers) ? q.answers : [])
            .filter((a) => a && typeof a.labelHe === 'string' && (a.value === true || a.value === false || a.value === null)),
        }
      : null;
    // Prefer the new questions[] array; fall back to the singular mirror so an
    // older one-question proxy still yields a single question. Cap at 5.
    let questions = (Array.isArray(rules.questions) ? rules.questions : (rules.question ? [rules.question] : []))
      .map(pickQ)
      .filter((q) => q && q.answers.length)
      .slice(0, 5);
    const question = questions[0] || null;
    return { notChecked: rules.notChecked === true, findings, questions, question };
  }

  function limitations(r) {
    const l = r && r.limitationsHe;
    if (typeof l === 'string') return l.trim() ? [l] : [];
    return Array.isArray(l) ? l.filter((x) => typeof x === 'string' && x.trim()) : [];
  }

  // Untrusted -> one-line note of <= USER_NOTE_MAX chars, or null.
  function userNote(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, USER_NOTE_MAX);
    return s || null;
  }

  Object.assign(R, { MAX_FACTS, USER_NOTE_MAX, STORE_KEY, conversationKey, sanitize, userNote, loadAnswers, saveAnswer, withAnswers, readRules, limitations });
})();
