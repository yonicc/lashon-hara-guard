// LHG vector POC bench — synthetic data only. Run: node bench.mjs [N]
// Compares: brute-force cosine (ground truth), Voy (HNSW wasm), Orama (lexical BM25 baseline).
import { pipeline } from '@xenova/transformers';
import { Voy } from './node_modules/voy-search/voy_search.js';
import { create, insertMultiple, search } from '@orama/orama';

const N = parseInt(process.argv[2] || '2000', 10);
const TOPICS = ['תשלום לספק', 'פגישה במשרד', 'תיקון רכב', 'שיעור תורה', 'הזמנת ציוד', 'בעיה בחשבון', 'משלוח מסמכים', 'קביעת תור'];
const PEOPLE = Array.from({ length: 40 }, (_, i) => 'אדם-' + (i + 1));
function docText(i) {
  const t = TOPICS[i % TOPICS.length], p = PEOPLE[i % PEOPLE.length];
  return 'בהקשר של ' + t + ', ' + p + ' ביקש לעדכן את הפרטים ולבדוק מה חסר לפני שליחה. מספר ' + i;
}
const docs = Array.from({ length: N }, (_, i) => ({ id: String(i), text: docText(i) }));
const queries = Array.from({ length: 30 }, (_, i) => 'מה נאמר על ' + TOPICS[i % TOPICS.length] + ' עם ' + PEOPLE[(i * 7) % PEOPLE.length] + '?');

const t0 = Date.now();
const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true });
console.log('model_load_ms=' + (Date.now() - t0));

async function embedAll(texts, prefix) {
  const out = [];
  const start = Date.now();
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32).map((t) => prefix + t);
    const r = await extractor(batch, { pooling: 'mean', normalize: true });
    const arr = r.tolist();
    for (const v of arr) out.push(Float32Array.from(v));
  }
  return { vecs: out, ms: Date.now() - start };
}
const de = await embedAll(docs.map((d) => d.text), 'passage: ');
const qe = await embedAll(queries, 'query: ');
const dim = de.vecs[0].length;
console.log('N=' + N + ' dim=' + dim + ' embed_docs_ms=' + de.ms + ' per_doc_ms=' + (de.ms / N).toFixed(2) + ' embed_queries_ms=' + qe.ms);

// brute force
function brute(q, k) {
  const scored = de.vecs.map((v, i) => { let s = 0; for (let j = 0; j < dim; j++) s += v[j] * q[j]; return [s, i]; });
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, k).map((x) => String(x[1]));
}
function benchQuery(fn) {
  const times = [];
  for (const q of qe.vecs) { const s = performance.now(); fn(q); times.push(performance.now() - s); }
  times.sort((a, b) => a - b);
  return { p50: times[Math.floor(times.length / 2)].toFixed(2), p95: times[Math.floor(times.length * 0.95)].toFixed(2) };
}
console.log('brute_query=' + JSON.stringify(benchQuery((q) => brute(q, 10))));

// Voy
const tb = Date.now();
const voy = new Voy({ embeddings: docs.map((d, i) => ({ id: d.id, title: d.text, url: '', embeddings: Array.from(de.vecs[i]) })) });
console.log('voy_build_ms=' + (Date.now() - tb));
let voyHits = 0, voyTotal = 0;
console.log('voy_query=' + JSON.stringify(benchQuery((q) => voy.search(Array.from(q), 10))));
for (let qi = 0; qi < qe.vecs.length; qi++) {
  const truth = new Set(brute(qe.vecs[qi], 10));
  const got = voy.search(Array.from(qe.vecs[qi]), 10).neighbors.map((n) => n.id);
  voyTotal += 10; voyHits += got.filter((g) => truth.has(g)).length;
}
console.log('voy_recall@10=' + (voyHits / voyTotal).toFixed(3));

// Orama lexical baseline (Hebrew tokenization is naive; this is a latency floor, not quality)
const to = Date.now();
const db = await create({ schema: { text: 'string' } });
await insertMultiple(db, docs.map((d) => ({ text: d.text })));
console.log('orama_build_ms=' + (Date.now() - to));
const oTimes = [];
for (const q of queries) { const s = performance.now(); await search(db, { term: q, limit: 10 }); oTimes.push(performance.now() - s); }
oTimes.sort((a, b) => a - b);
console.log('orama_bm25_query_p50=' + oTimes[Math.floor(oTimes.length / 2)].toFixed(2) + ' p95=' + oTimes[Math.floor(oTimes.length * 0.95)].toFixed(2));
console.log('float32_index_bytes=' + (N * dim * 4));



