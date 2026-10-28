// Router latency in Node with transformers.js (the same library the browser memory POC uses).
//   node bench-router.mjs <modelsDir> <modelName> <holdout.jsonl> [threads]
// <modelsDir>/<modelName>/{config.json,tokenizer.json,tokenizer_config.json,onnx/model_quantized.onnx}
// Prints JSON: load ms, per-message p50/p95 (tokenize + forward + sigmoid), and the probabilities so they
// can be compared with the PyTorch probabilities of the same run. Local files only; no network.
import fs from 'node:fs';
import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@xenova/transformers';

const [dir, name, holdout, threads = '1'] = process.argv.slice(2);
env.allowRemoteModels = false;
env.localModelPath = dir.endsWith('/') ? dir : dir + '/';
env.backends.onnx.wasm.numThreads = Number(threads);

const rows = fs.readFileSync(holdout, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const t0 = performance.now();
const tok = await AutoTokenizer.from_pretrained(name);
const model = await AutoModelForSequenceClassification.from_pretrained(name, { quantized: true });
const loadMs = performance.now() - t0;
const sig = (x) => 1 / (1 + Math.exp(-x));
const times = [];
const probs = [];
for (let i = 0; i < rows.length; i++) {
  const s = performance.now();
  const enc = tok(rows[i].text, { truncation: true, max_length: 96 });
  const { logits } = await model(enc);
  probs.push(Array.from(logits.data, sig));
  if (i >= 3) times.push(performance.now() - s); // warm-up excluded
}
times.sort((a, b) => a - b);
const pct = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] * 10) / 10;
console.log(JSON.stringify({ model: name, runtime: 'transformers.js 2.17.2 (Node ' + process.version + ')',
  threads: Number(threads), n: times.length, load_ms: Math.round(loadMs), p50_ms: pct(0.5), p95_ms: pct(0.95),
  max_ms: Math.round(times.at(-1) * 10) / 10, ids: rows.map((r) => r.id), probs }));
