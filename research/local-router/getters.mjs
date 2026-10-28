// Local context-router getters + bounded executor (docs/34 §4, docs/35). Research module:
// not loaded by extension/, the Worker, the gate or /check.
//
// Contract
//  * Every getter answers {status:'ok', value} or {status:'unknown', reason}. A fact the getter cannot
//    establish is 'unknown' - never false, never an empty "nobody/none" answer.
//  * Budget: at most maxCalls getter calls, each raced against perCallMs, all inside totalMs. A timeout or
//    an exception is 'unknown' for that getter; the executor never throws - on failure the caller runs the
//    normal /check without expansion (same rule as a gate failure).
//  * No text leakage: getters see only a sanitized ContextPacket (refs self/p1.., engine/src/contextPacket.ts)
//    and the scope-bound read tools of LocalMemory (research/local-memory/memory.mjs `tools(scope)`); returned
//    snippets are clipped to 300 chars and carry pseudonymous refs, never the memory sourceId. The `trace`
//    is the only thing meant for logs and holds no text, refs or queries - names, counts, status and ms only.
//  * propose_question only QUEUES catalog facts (up to MAX_QUESTIONS, the multi-question budget of
//    docs/18 as updated 2026-10-29, docs/40 §A / docs/41); it never asks, and it ends expansion.
//    Relationship/purpose labels can never be answered by inference.

export const BUDGET = Object.freeze({ perCallMs: 50, totalMs: 400, maxCalls: 3 });
export const MAX_SNIPPET = 300;
export const MAX_RECENT = 5;
export const MAX_TOP_K = 3;
// Up to 5 clarifying questions per check (owner's decision 2026-10-29, docs/40 §A).
export const MAX_QUESTIONS = 5;

// The router decides only 3 heads (classifier/router/labels.json "heads"): context is enough (none fires) /
// expand from local memory (mem_recent, mem_search) / ask the user (ask_user -> up to MAX_QUESTIONS questions).
export const LABEL_GETTER = Object.freeze({
  mem_recent: 'get_recent',
  mem_search: 'search_history',
  ask_user: 'propose_question',
});
const THREAD_FROM = new Set(['mem_recent', 'mem_search']);
// Deterministic packet reads: no model decision, no memory call, outside the call budget. They run whenever
// any head fires (thread identity gates stored lookups; participants/event are metadata, never facts).
export const PACKET_READS = Object.freeze(['get_thread', 'get_participants', 'get_event']);
// Budgeted calls, in order: memory first, the question last (it ends expansion).
const ORDER = ['get_thread', 'get_participants', 'get_event', 'get_recent', 'search_history', 'propose_question'];

const unknown = (reason) => ({ status: 'unknown', reason });
const ok = (value) => ({ status: 'ok', value });
const clip = (t) => (typeof t === 'string' ? t.slice(0, MAX_SNIPPET) : '');

export function createGetters({ packet, memory = null, questionFacts = {}, now = () => Date.now() }) {
  const questionsQueued = [];
  const refOf = new Map(); // memory sourceId -> m1, m2 ... (sourceIds never leave this closure)
  const neutralRef = (id) => { if (!refOf.has(id)) refOf.set(id, 'm' + (refOf.size + 1)); return refOf.get(id); };

  return Object.freeze({
    async get_recent({ k = MAX_RECENT } = {}) {
      if (!Number.isInteger(k) || k < 1 || k > MAX_RECENT) return unknown('invalid-budget');
      if (memory?.get_recent) {
        const rows = await memory.get_recent({ k });
        if (rows.length) {
          return ok(rows.map((r) => ({ ref: neutralRef(r.ref), direction: r.direction ?? 'unknown', text: clip(r.text),
            ageMin: Number.isFinite(r.observedAt) ? Math.max(0, Math.round((now() - r.observedAt) / 60000)) : undefined,
            status: 'candidate' })));
        }
      }
      const rec = packet?.recentMessages ?? [];
      if (!rec.length) return unknown('no-recent-messages');
      return ok(rec.slice(-k).map((m) => ({ ref: m.authorRef, direction: m.direction, text: clip(m.text),
        ageMin: m.ageMinutes, status: 'candidate' })));
    },
    async get_participants() {
      const ps = packet?.participants ?? [];
      if (!ps.length) return unknown('no-participants');
      // Visible authors do not establish audience size (AGENTS.md): count only when independently known.
      return ok({ kind: packet.conversationKind ?? 'unknown', refs: ps.map((p) => p.ref),
        count: Number.isInteger(packet.participantCount) ? packet.participantCount : 'unknown' });
    },
    async get_thread() {
      const known = typeof packet?.conversationRef === 'string' && packet.conversationRef.length > 0 &&
        packet.conversationKind && packet.conversationKind !== 'unknown';
      return known ? ok({ threadIdKnown: true }) : unknown('no-thread-identity');
    },
    async search_history({ query, top_k = MAX_TOP_K } = {}) {
      if (!memory?.search_history) return unknown('memory-unavailable');
      if (!Number.isInteger(top_k) || top_k < 1 || top_k > MAX_TOP_K) return unknown('invalid-budget');
      const q = clip(query).trim();
      if (!q) return unknown('empty-query');
      const hits = await memory.search_history({ query: q, top_k });
      if (!hits.length) return unknown('no-history');
      return ok(hits.map((h) => ({ ref: neutralRef(h.ref), snippet: clip(h.text),
        score: Math.round((h.score ?? 0) * 1000) / 1000, status: 'candidate' })));
    },
    async get_event() {
      const e = packet?.event;
      if (!e || !e.kind) return unknown('no-event');
      return ok({ eventKnown: true, kind: e.kind, teacherRef: e.teacherRef });
    },
    async propose_question({ label } = {}) {
      // The engine supplies candidates in priority order; the router only opens
      // the ask_user route. One budgeted call queues the complete bounded batch.
      const candidates = questionFacts[label];
      if (Array.isArray(candidates)) {
        const factIds = [];
        for (const id of candidates) {
          if (typeof id !== 'string' || !id || questionsQueued.includes(id)) continue;
          if (questionsQueued.length >= MAX_QUESTIONS) break;
          questionsQueued.push(id);
          factIds.push(id);
        }
        return factIds.length
          ? ok({ queued: true, factId: factIds[0], factIds, queuedCount: questionsQueued.length })
          : unknown('no-unanswered-catalog-candidates');
      }
      const factId = candidates;
      if (!factId) return unknown('no-catalog-fact-for-label');
      if (questionsQueued.includes(factId)) return ok({ queued: false, reason: 'question-already-queued', factId });
      if (questionsQueued.length >= MAX_QUESTIONS) {
        return ok({ queued: false, reason: 'question-budget-used', factId: questionsQueued[0], queuedCount: questionsQueued.length });
      }
      questionsQueued.push(factId);
      return ok({ queued: true, factId, queuedCount: questionsQueued.length });
    },
  });
}

/** Labels above threshold -> ordered, de-duplicated getter plan (pure; no I/O). */
export function planFromLabels(labels) {
  const set = new Set(labels);
  const calls = new Map();
  for (const l of set) {
    const g = LABEL_GETTER[l];
    if (g && !calls.has(g)) calls.set(g, g === 'propose_question' ? { label: l } : {});
  }
  if (!calls.size) return [];
  for (const g of PACKET_READS) calls.set(g, {});
  if (![...set].some((l) => THREAD_FROM.has(l))) calls.delete('get_thread');
  return [...calls.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([name, args]) => ({ name, args }));
}

const timeout = (ms) => new Promise((r) => setTimeout(() => r(unknown('timeout')), ms));

/**
 * Execute a plan under the hard budget. Never throws. `messageText` is used only as the local query of
 * search_history and is never copied into the trace.
 */
export async function runPlan({ getters, labels, messageText = '', budget = BUDGET, clock = () => performance.now() }) {
  const t0 = clock();
  const results = {};
  const trace = [];
  let plan;
  try { plan = planFromLabels(labels); } catch { return { results, trace, stopped: 'plan-error', expanded: false }; }
  let stopped = 'done';
  let calls = 0;
  for (const step of plan) {
    const left = budget.totalMs - (clock() - t0);
    const budgeted = !PACKET_READS.includes(step.name);
    if (budgeted && calls >= budget.maxCalls) { stopped = 'max-calls'; results[step.name] = unknown('budget'); continue; }
    if (left <= 0) { stopped = 'total-budget'; results[step.name] = unknown('budget'); continue; }
    if (['get_recent', 'search_history'].includes(step.name) &&
        results.get_thread?.status === 'unknown') {
      results[step.name] = unknown('no-thread-identity'); continue; // no scope -> no stored lookup
    }
    const s = clock();
    let r;
    try {
      const args = step.name === 'search_history' ? { query: messageText, top_k: MAX_TOP_K } : step.args;
      r = await Promise.race([getters[step.name](args), timeout(Math.min(budget.perCallMs, left))]);
    } catch { r = unknown('error'); }
    if (!r || (r.status !== 'ok' && r.status !== 'unknown')) r = unknown('malformed');
    if (budgeted) calls += 1;
    results[step.name] = r;
    trace.push({ getter: step.name, status: r.status, reason: r.reason, ms: Math.round(clock() - s) });
    if (step.name === 'propose_question' && r.value?.queued) { stopped = 'question-queued'; break; }
  }
  const totalMs = Math.round(clock() - t0);
  return { results, trace, stopped, totalMs, expanded: Object.values(results).some((r) => r.status === 'ok') };
}
