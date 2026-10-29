// Adapter only: the training contract, validator, rules and alert policy retain ownership.
import { validateExtraction } from '../engine/src/extractor/validate.js';
import { normalizeHebrewText } from '../engine/src/extractor/normalize.js';
import { FACT_CATALOG } from '../engine/src/lessonScenario.js';
import { sanitizeContextPacket } from '../engine/src/contextPacket.js';
import { validateNeeds, localNeeds, needsPending, MAX_ROUNDS } from '../engine/src/needs.js';
import { runLiveRules, pickConfirmedFacts, DRAFT_RULES_LIMITATION_HE } from '../proxy/src/rules.js';
import { alertFor } from '../proxy/src/handler.js';
import type { ExtractionOutcome } from '../engine/src/extractor/types.js';
declare const __LHG_OLLAMA_ASSETS__: Record<string, {
  instruction: string; contract: { facts: [string, string, string][] };
}>;
const assets = __LHG_OLLAMA_ASSETS__;
const catalogIds = new Set(FACT_CATALOG.map(f => f.id));
for (const asset of Object.values(assets)) for (const [, id] of asset.contract.facts) {
  if (!catalogIds.has(id)) throw new Error('ollama_fact_missing_from_catalog:' + id);
}
function modelAssets(id: string) {
  const spec = (globalThis as any).LHG_OLLAMA_CLIENT?.SPECS[id];
  const asset = spec && assets[spec.contract];
  if (!asset) throw new Error('ollama_unknown_model');
  return { ...asset, template: spec.template };
}
export function adapt(raw: unknown, text: string, scores: Record<string, unknown> = {},
    id: string = (globalThis as any).LHG_OLLAMA_CLIENT.DEFAULT_MODEL) {
  const aliases = new Map(modelAssets(id).contract.facts.map(([alias, factId]) => [alias, factId]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ollama_bad_contract');
  // Each pair is admitted or dropped on its own, exactly as the evaluation scorer
  // does: one paraphrased quote must not discard the verbatim facts beside it.
  const proposedFacts: any[] = [];
  const invalidPairs: { alias: string; reason: string }[] = [];
  const haystack = normalizeHebrewText(text);
  for (const [alias, pair] of Object.entries(raw)) {
    let reason = '';
    if (!aliases.has(alias)) reason = 'unknown_key';
    else if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'boolean' ||
        typeof pair[1] !== 'string' || !pair[1].trim() || !normalizeHebrewText(pair[1])) reason = 'invalid_pair';
    else if (!haystack.includes(normalizeHebrewText(pair[1]))) reason = 'evidence_not_verbatim';
    if (reason) { invalidPairs.push({ alias, reason }); continue; }
    // The score is the model's own token probability (ollama-client scoreKeys).
    // When it is absent nothing is invented: canonical factPolicy rejects the proposal.
    const score = scores[alias];
    proposedFacts.push({ id: aliases.get(alias), value: (pair as any[])[0], evidenceExcerpt: (pair as any[])[1],
      ...(typeof score === 'number' ? { confidence: score } : {}) });
  }
  const extraction = validateExtraction({ proposedFacts }, FACT_CATALOG, text);
  return invalidPairs.length ? { ...extraction, invalidPairs } : extraction;
}
export function render(id: string, text: string, context?: unknown, userNote?: unknown) {
  const asset = modelAssets(id);
  // Same trained message template. Additional context remains explicitly untrusted;
  // never concatenate retrieved excerpts into the message/evidence source.
  let user = 'MESSAGE (untrusted data):\n' + JSON.stringify(text);
  const packet = sanitizeContextPacket(context);
  if (packet || (typeof userNote === 'string' && userNote.trim())) {
    user += '\nADDITIONAL CONTEXT (untrusted data, not MESSAGE evidence):\n' +
      JSON.stringify({ ...(packet ? { context: packet } : {}),
        ...(typeof userNote === 'string' ? { userNote: userNote.slice(0, 500) } : {}) });
  }
  if (asset.template === 'qwen') return '<|im_start|>system\n' + asset.instruction +
    '<|im_end|>\n<|im_start|>user\n' + user + '<|im_end|>\n<|im_start|>assistant\n';
  if (asset.template === 'mistral') return '<s>[INST] ' + asset.instruction + '\n\n' + user + ' [/INST]';
  throw new Error('ollama_unknown_model');
}
export async function check(req: any, id: string, client: any) {
  if (typeof req.text !== 'string' || !req.text.trim() || req.text.length > 12000) throw new Error('ollama_bad_input');
  const generated = await client.generate(id, render(id, req.text, req.context, req.userNote));
  if (!generated || typeof generated !== 'object' || !('output' in generated)) throw new Error('ollama_bad_contract');
  const extraction = adapt(generated.output, req.text, generated.scores || {}, id);
  const outcome = {
    status: 'extracted', extraction,
  } as ExtractionOutcome;
  const rules = runLiveRules({
    id: 'local', revision: 1, text: req.text,
    direction: req.direction === 'incoming' ? 'incoming' : 'outgoing',
    platform: req.platform || 'manual', authorRef: 'user',
    conversationId: 'local', audienceSnapshot: {},
  }, extraction, pickConfirmedFacts(req.confirmedFacts), id);
  // Null directAssessment => canonical alertFor returns unsure (or a rule warning).
  const needs = localNeeds(req.routerHeads, req.text, rules.questions ?? [], req.round ?? 1, pickConfirmedFacts(req.confirmedFacts));
  return { alert: alertFor(outcome, rules, needs), status: 'extracted', rules, needs,
    limitationsHe: rules.findings.length ? [DRAFT_RULES_LIMITATION_HE] : [],
    model: id };
}
(globalThis as any).LHG_OLLAMA_ENGINE = { adapt, render, check };
(globalThis as any).LHG_NEEDS = { validateNeeds, localNeeds, needsPending, MAX_ROUNDS, sanitizeContextPacket };
