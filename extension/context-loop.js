// One executor for cloud and local needs. Dependencies are injected for Node/MV3 tests.
(() => {
  async function run({ request, check, retrieve, exchange, schema, current = async () => true, timeoutMs = 5000 }) {
    async function bounded(work) {
      let timer;
      try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('memory-timeout')), timeoutMs);
      })]); } finally { clearTimeout(timer); }
    }
    let req = { ...request, round: 1 }, last, stopped;
    const seen = new Set((req.context?.recentMessages || []).map(m => m.text));
    const safe = r => r?.alert === 'none' ? { ...r, alert: 'unsure' } : r;
    for (let round = 1; round <= schema.MAX_ROUNDS; round++) {
      if (!await current(round)) return safe(last || { alert: 'not_checked', error: 'superseded' });
      let result;
      try { result = await check(req); } catch { result = { alert: 'not_checked', error: 'context_loop_failed' }; }
      if (!await current(round)) return { ...safe(last || result || { alert: 'not_checked' }), loopStopped: 'superseded' };
      if (result?.error || !result || result.alert === 'not_checked' || result.rules?.notChecked) {
        return last ? { ...safe(last), loopStopped: 'error' } : result;
      }
      const needs = schema.validateNeeds(result.needs, round, result.rules?.questions || [], req.confirmedFacts || {});
      last = { ...result, needs };
      if (schema.needsPending(needs)) last = safe(last);
      // Same UI question structure; keep the panel's batch+explicit-submit behaviour.
      if (needs.questions.length) last.rules = { ...(last.rules || { mode: 'live_draft', findings: [] }),
        questions: needs.questions, question: needs.questions[0] };
      if (!needs.requests.length) return last;
      if (round === schema.MAX_ROUNDS) { stopped = 'max_rounds'; break; }
      try {
        if (!await current(round)) { stopped = 'superseded'; break; }
        const candidates = [];
        for (const r of needs.requests) {
          const rows = await bounded(() => retrieve(r));
          if (!Array.isArray(rows)) throw Error('memory-unavailable');
          candidates.push(...rows.filter(row => row?.text && row.text !== req.text.slice(0, 300)));
        }
        if (!await current(round)) { stopped = 'superseded'; break; }
        // Content bridge applies the existing builder's local-name/email/phone masking.
        // It returns a packet, never facts or evidence from a tool result.
        const packet = schema.sanitizeContextPacket(await bounded(() => exchange(candidates, req.context)));
        const fresh = (packet?.recentMessages || []).filter(m => m.text && !seen.has(m.text));
        if (!fresh.length) { stopped = 'no_new_information'; break; }
        for (const m of fresh) seen.add(m.text);
        req = { ...req, round: round + 1, context: packet };
      } catch (e) { stopped = e?.message === 'disabled' ? 'memory_disabled' : 'error'; break; }
    }
    return { ...safe(last), loopStopped: stopped };
  }
  globalThis.LHG_CONTEXT_LOOP = { run };
  if (typeof module !== 'undefined') module.exports = { run };
})();
