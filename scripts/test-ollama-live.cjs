// Live smoke against a REAL local Ollama (127.0.0.1:11434) with the published GGUF.
// Synthetic texts only. Usage: node scripts/test-ollama-live.cjs [extractor-7b-q4|dictalm-q4]
// Exits non-zero if the server returns no usable logprobs or any check fails closed unexpectedly.
const path = require('node:path');
const ext = path.join(__dirname, '..', 'extension');
require(path.join(ext, 'check-mode.js'));
require(path.join(ext, 'ollama-client.js'));
require(path.join(ext, 'ollama-engine.bundle.js'));
const id = process.argv[2] || 'extractor-7b-q4';
const C = globalThis.LHG_OLLAMA_CLIENT, E = globalThis.LHG_OLLAMA_ENGINE;
const cases = [
  'הנהג דילג על תחנה. אני רק מתלוצץ על חשבונו. אני לא מנסה להוציא לו שם רע.',
  'I checked the invoice myself before writing this, and I am telling only his manager so it can be fixed.',
  'שמעתי מחבר שהשכן שלנו גנב מהקופה, אבל לא ראיתי את זה במו עיניי.',
  'Reminder: the meeting moved to 4pm.',
];
(async () => {
  const client = C.create({ timeoutMs: 240000 });
  if (!(await client.available(id))) { console.error('model not installed:', C.MODELS[id]); process.exit(2); }
  let scored = 0, failed = 0;
  for (const text of cases) {
    const started = Date.now();
    try {
      const gen = await client.generate(id, E.render(id, text));
      const ex = E.adapt(gen.output, text, gen.scores);
      const r = await E.check({ text, platform: 'manual', direction: 'outgoing' }, id,
        { generate: async () => gen });
      if (Object.keys(gen.scores).length) scored++;
      console.log(JSON.stringify({ ms: Date.now() - started, text: text.slice(0, 40), output: gen.output,
        scores: gen.scores, accepted: ex.proposedFacts.map(f => [f.id, f.value, +f.confidence.toFixed(3)]),
        dropped: ex.droppedFacts, invalidPairs: ex.invalidPairs || [], alert: r.alert,
        questions: r.rules.questions.length }));
    } catch (e) {
      failed++; console.log(JSON.stringify({ ms: Date.now() - started, text: text.slice(0, 40), error: String(e.message || e) }));
    }
  }
  console.log(JSON.stringify({ model: id, cases: cases.length, withScores: scored, failed }));
  process.exit(failed || !scored ? 1 : 0);
})();
