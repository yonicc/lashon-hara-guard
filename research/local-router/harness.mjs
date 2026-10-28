// Shared Node harness: the REAL extension LocalMemory (extension/memory.mjs, byte-identical to the copy installed
// on YONI-PC, verified 2026-10-28) with the extension's pinned e5-small revision, and a trained router loaded with
// transformers.js exactly as a browser offscreen document would. IndexedDB = fake-indexeddb. Synthetic data only.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { AutoTokenizer, AutoModelForSequenceClassification, pipeline, env } from '@xenova/transformers';
import { LocalMemory } from '../../extension/memory.mjs';
import { MODEL_REVISION } from '../../extension/memory-embedding.mjs';

export const HEADS = JSON.parse(fs.readFileSync(new URL('../../classifier/router/labels.json', import.meta.url))).heads.map((h) => h.id);

export async function makeMemory() {
  env.allowRemoteModels = true; // one-time download of the pinned e5 revision (model files only; no message text)
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true, revision: MODEL_REVISION });
  const embed = async (t) => Array.from((await extractor(t, { pooling: 'mean', normalize: true })).data);
  await embed('query: warm-up');
  return new LocalMemory({ embed, name: 'lhg-router-eval-' + Date.now() });
}

/** thresholds: {head: t} frozen on dev (evaluate.py summary). Returns route(text) -> {labels, probs, ms}. */
export async function loadRouter(dir, name, thresholds) {
  env.allowRemoteModels = false;
  env.localModelPath = /[\\/]$/.test(dir) ? dir : dir + '/';
  const tok = await AutoTokenizer.from_pretrained(name);
  const model = await AutoModelForSequenceClassification.from_pretrained(name, { quantized: true });
  const route = async (text) => {
    const t0 = performance.now();
    const { logits } = await model(tok(text, { truncation: true, max_length: 96 }));
    const probs = Array.from(logits.data, (x) => 1 / (1 + Math.exp(-x)));
    return { labels: HEADS.filter((h, i) => probs[i] >= thresholds[h]), probs, ms: performance.now() - t0 };
  };
  await route('warm-up');
  return route;
}

export function thresholdsFrom(summaryPath, run) {
  return JSON.parse(fs.readFileSync(summaryPath, 'utf8')).candidates[run].thresholds;
}
