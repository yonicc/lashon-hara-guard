import type { RulePack } from '../types.js';
import { CC_TOELET_DRAFT_PACK } from './toeletPack.js';
import { CC_SPEECH_DRAFT_PACK, CC_PUBLICATION_DRAFT_PACK, CC_REPUTATION_DRAFT_PACK } from './speechPacks.js';
import { CC_LISTENER_DRAFT_PACK } from './listenerPack.js';
import { CC_RECHILUT_DRAFT_PACK, CC_PREVENTION_DRAFT_PACK } from './rechilutPack.js';
import { CC_CONTEXT_DRAFT_PACK } from './contextPack.js';
export { CC_SPEECH_DRAFT_PACK, CC_PUBLICATION_DRAFT_PACK, CC_REPUTATION_DRAFT_PACK, CC_LISTENER_DRAFT_PACK, CC_RECHILUT_DRAFT_PACK, CC_PREVENTION_DRAFT_PACK };
export { CC_CONTEXT_DRAFT_PACK };
export const CC_DRAFT_PACKS = [CC_TOELET_DRAFT_PACK, CC_SPEECH_DRAFT_PACK, CC_PUBLICATION_DRAFT_PACK, CC_REPUTATION_DRAFT_PACK, CC_LISTENER_DRAFT_PACK, CC_RECHILUT_DRAFT_PACK, CC_PREVENTION_DRAFT_PACK, CC_CONTEXT_DRAFT_PACK] as const;
/** The integration owner selects this pack; changing /check is intentionally outside this module. */
export const CC_ALL_DRAFT_PACK: RulePack = {
  id: 'cc-all-draft', version: '0.2.0',
  rules: CC_DRAFT_PACKS.flatMap(p => p.rules),
};
