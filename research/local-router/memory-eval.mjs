// Does the expansion the router asks for actually bring the RIGHT context out of the local memory?
//   node memory-eval.mjs <modelsDir> <run> <summary.json> <thresholdRun> <out.json>
// For every scenario (memory-scenarios.json) a fresh conversation scope gets 12 distractors plus one planted
// message; the router sees only the new message. Success = the needed head fired AND its getter returned the
// planted message (search_history top-3 / get_recent k=5). "retrieval_only" forces the needed head, to separate
// router misses from retrieval misses. A planted message from another scope must never be returned.
import fs from 'node:fs';
import { createGetters, runPlan } from './getters.mjs';
import { loadRouter, makeMemory, thresholdsFrom } from './harness.mjs';

const [dir, run, summary, thRun, out] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(new URL('./memory-scenarios.json', import.meta.url), 'utf8'));
const memory = await makeMemory();
const route = await loadRouter(dir, run, thresholdsFrom(summary, thRun));
const packet = { version: 1, platform: 'whatsapp', direction: 'outgoing', conversationRef: 'c', conversationKind: 'group',
  participants: [{ ref: 'self', isSelf: true }, { ref: 'p1' }], currentAuthorRef: 'self', recentMessages: [],
  facts: [], relationships: [] };
const now = Date.now(), H = 3600000;
const GETTER = { mem_search: 'search_history', mem_recent: 'get_recent' };
const rows = [];
for (const s of S.scenarios) {
  const scope = { platform: 'whatsapp-web', accountId: 'acct-synthetic', conversationId: 'conv-' + s.id };
  let n = 0;
  const put = (text, ageH) => memory.ingest({ enabled: true, type: 'message_observed', scope, sourceId: s.id + '-' + n++,
    direction: 'incoming', text, observedAt: now - ageH * H });
  for (const [i, d] of S.distractors.entries()) await put(d, 1 + i);           // 1h..12h old
  await put(s.planted, s.need === 'mem_search' ? 72 : 0.05);                    // old (search) or latest (recent)
  const tools = memory.tools(scope);
  const r = await route(s.message);
  const plan = await runPlan({ getters: createGetters({ packet, memory: tools }), labels: r.labels, messageText: s.message });
  const forced = await runPlan({ getters: createGetters({ packet, memory: tools }), labels: [s.need], messageText: s.message });
  const hit = (res) => JSON.stringify(res.results[GETTER[s.need]]?.value ?? []).includes(s.key);
  rows.push({ id: s.id, lang: s.lang, need: s.need, router_labels: r.labels, router_ms: Math.round(r.ms * 10) / 10,
    head_fired: r.labels.includes(s.need), end_to_end: r.labels.includes(s.need) && hit(plan),
    retrieval_only: hit(forced), plan_ms: plan.totalMs, forced_ms: forced.totalMs, stopped: plan.stopped });
}
const rate = (k, f = () => true) => { const xs = rows.filter(f); return `${xs.filter((x) => x[k]).length}/${xs.length}`; };
const res = { run, thresholds_from: thRun, scenarios: rows.length,
  head_fired: rate('head_fired'), end_to_end: rate('end_to_end'), retrieval_only: rate('retrieval_only'),
  by_need: Object.fromEntries(['mem_search', 'mem_recent'].map((n) => [n, { head_fired: rate('head_fired', (x) => x.need === n),
    end_to_end: rate('end_to_end', (x) => x.need === n), retrieval_only: rate('retrieval_only', (x) => x.need === n) }])),
  router_ms_max: Math.max(...rows.map((x) => x.router_ms)), plan_ms_max: Math.max(...rows.map((x) => x.plan_ms)),
  forced_ms_max: Math.max(...rows.map((x) => x.forced_ms)), rows };
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, rows: undefined }));
for (const x of rows) if (!x.end_to_end) console.log('MISS', JSON.stringify(x));
