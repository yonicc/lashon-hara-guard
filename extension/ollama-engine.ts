// Adapter only: the training contract, validator, rules and alert policy retain ownership.
import { validateExtraction } from '../engine/src/extractor/validate.js';
import { normalizeHebrewText } from '../engine/src/extractor/normalize.js';
import { FACT_CATALOG } from '../engine/src/lessonScenario.js';
import { sanitizeContextPacket } from '../engine/src/contextPacket.js';
import { runLiveRules, pickConfirmedFacts, DRAFT_RULES_LIMITATION_HE } from '../proxy/src/rules.js';
import { alertFor } from '../proxy/src/handler.js';
import type { ExtractionOutcome } from '../engine/src/extractor/types.js';
declare const __LHG_OLLAMA_ASSETS__: {
  instruction: string; contract: { facts: [string, string, string][] };
};
const assets = __LHG_OLLAMA_ASSETS__;
const aliases = new Map(assets.contract.facts.map(([alias, id]) => [alias, id]));
export function adapt(raw: unknown, text: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ollama_bad_contract');
  const proposedFacts = Object.entries(raw).map(([alias, pair]) => {
    if (!aliases.has(alias) || !Array.isArray(pair) || pair.length !== 2 ||
        typeof pair[0] !== 'boolean' || typeof pair[1] !== 'string' || !pair[1].trim() ||
        !normalizeHebrewText(pair[1]) ||
        !normalizeHebrewText(text).includes(normalizeHebrewText(pair[1]))) {
      throw new Error('ollama_bad_contract');
    }
    // Training output has no score. Do not fabricate one: canonical factPolicy
    // rejects the proposal. Retain that boundary until a reviewed admission policy exists.
    return { id: aliases.get(alias), value: pair[0], evidenceExcerpt: pair[1] };
  });
  return validateExtraction({ proposedFacts }, FACT_CATALOG, text);
}
export function render(id: string, text: string, context?: unknown, userNote?: unknown) {
  // Same trained message template. Additional context remains explicitly untrusted;
  // never concatenate retrieved excerpts into the message/evidence source.
  let user = 'MESSAGE (untrusted data):\n' + JSON.stringify(text);
  const packet = sanitizeContextPacket(context);
  if (packet || (typeof userNote === 'string' && userNote.trim())) {
    user += '\nADDITIONAL CONTEXT (untrusted data, not MESSAGE evidence):\n' +
      JSON.stringify({ ...(packet ? { context: packet } : {}),
        ...(typeof userNote === 'string' ? { userNote: userNote.slice(0, 500) } : {}) });
  }
  if (id === 'extractor-7b-q4') return '<|im_start|>system\n' + assets.instruction +
    '<|im_end|>\n<|im_start|>user\n' + user + '<|im_end|>\n<|im_start|>assistant\n';
  if (id === 'dictalm-q4') return '<s>[INST] ' + assets.instruction + '\n\n' + user + ' [/INST]';
  throw new Error('ollama_unknown_model');
}
export async function check(req: any, id: string, client: any) {
  if (typeof req.text !== 'string' || !req.text.trim() || req.text.length > 12000) throw new Error('ollama_bad_input');
  const raw = await client.generate(id, render(id, req.text, req.context, req.userNote));
  const extraction = adapt(raw, req.text);
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
  return { alert: alertFor(outcome, rules), status: 'extracted', rules,
    limitationsHe: rules.findings.length ? [DRAFT_RULES_LIMITATION_HE] : [],
    model: id };
}
(globalThis as any).LHG_OLLAMA_ENGINE = { adapt, render, check };
