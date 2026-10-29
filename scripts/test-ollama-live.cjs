// Live smoke against a REAL local Ollama (127.0.0.1:11434) with the published GGUF.
// Synthetic texts only. Usage: node scripts/test-ollama-live.cjs [extractor-7b-q4|dictalm-q4]
// Exits non-zero if the server returns no usable logprobs or any check fails closed unexpectedly.
const path = require('node:path');
const assert = require('node:assert/strict');
const { run } = require('../extension/context-loop.js');
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
  'I am only joking about his late arrival. I am putting this criticism in writing.',
  'This is a rumor I have not checked. I am passing on what a colleague told me.',
  'My rabbi asked me to pass this on. This inquiry concerns a future business partnership.',
  'He told this himself in front of five listeners. I am confirming the report you already heard.',
  'I have the same bad habit myself. I am only hinting at his conduct.',
];
(async () => {
  const client = C.create({ timeoutMs: 240000 });
  if (!(await client.available(id))) { console.error('model not installed:', C.MODELS[id]); process.exit(2); }
  let scored = 0, failed = 0, expandedAccepted = 0;
  for (const text of cases) {
    const started = Date.now();
    try {
      const gen = await client.generate(id, E.render(id, text));
      for (const key of Object.keys(gen.output)) {
        assert.ok(Number.isFinite(gen.scores[key]), 'missing/misaligned token score: ' + key);
      }
      const ex = E.adapt(gen.output, text, gen.scores, id);
      const r = await E.check({ text, platform: 'manual', direction: 'outgoing' }, id,
        { generate: async () => gen });
      if (r.alert === 'none') throw new Error('narrow_extractor_must_remain_unresolved');
      expandedAccepted += ex.proposedFacts.filter(f => f.id.startsWith('message.') || f.id.startsWith('context.')).length;
      if (Object.keys(gen.scores).length) scored++;
      console.log(JSON.stringify({ ms: Date.now() - started, text: text.slice(0, 40), output: gen.output,
        scores: gen.scores, accepted: ex.proposedFacts.map(f => [f.id, f.value, +f.confidence.toFixed(3)]),
        dropped: ex.droppedFacts, invalidPairs: ex.invalidPairs || [], alert: r.alert,
        questions: r.rules.questions.length }));
    } catch (e) {
      failed++; console.log(JSON.stringify({ ms: Date.now() - started, text: text.slice(0, 40), error: String(e.message || e) }));
    }
  }
  // Exercise the shared executor with this real engine, including a second inference
  // with untrusted context. Synthetic retrieval is injected; model output is live.
  try {
    const checks = [], prompts = [];
    const text = 'I checked the invoice myself before writing this.';
    const result = await run({ request: { text, platform: 'gmail', direction: 'outgoing', routerHeads: ['mem_recent'] },
      schema: globalThis.LHG_NEEDS,
      check: async req => { checks.push(req); return E.check(req, id, {
        generate: async (model, prompt) => { prompts.push(prompt); return client.generate(model, prompt); }
      }); },
      retrieve: async () => [{ text: 'Synthetic maintenance record from earlier.' }],
      exchange: async rows => ({ version: 1, platform: 'gmail', direction: 'outgoing',
        conversationRef: 'synthetic', currentAuthorRef: 'self', recentMessages: [
          { text: rows[0].text, authorRef: 'unknown', direction: 'incoming' }
        ] }) });
    assert.equal(checks.length, 2);
    assert.equal(checks[1].round, 2);
    assert.equal(checks[1].confirmedFacts, undefined);
    assert.match(prompts[1], /ADDITIONAL CONTEXT/);
    assert.match(prompts[1], /Synthetic maintenance record/);
    assert.equal(result.loopStopped, 'no_new_information');
    assert.notEqual(result.alert, 'none');
    console.log(JSON.stringify({ localNeeds: 'PASS', rounds: checks.length,
      stopped: result.loopStopped, alert: result.alert, questions: result.rules.questions.length }));
  } catch (e) { failed++; console.log(JSON.stringify({ localNeeds: 'FAIL', error: String(e.message || e) })); }
  console.log(JSON.stringify({ model: id, cases: cases.length, withScores: scored, expandedAccepted, failed }));
  const expandedRequired = C.SPECS[id].contract === 'v2';
  process.exit(failed || !scored || (expandedRequired && !expandedAccepted) ? 1 : 0);
})();
