import { FactStore } from '../factStore.js';
import { factStoreFromExtraction } from '../liveFacts.js';
import type { FactCatalogEntry, MessageEnvelope } from '../types.js';
import type { ExtractorProvider } from './types.js';
import { runExtraction, type ExtractionOutcome } from './index.js';

export interface PipelineResult {
  outcome: ExtractionOutcome;
  store: FactStore;
}

/**
 * Feed a validated extraction into the FactStore the engine consumes.
 * Proposed facts enter via store.propose (so confirmedByUserOnly facts stay
 * 'candidate'), and meaning facts are rebuilt deterministically by meaning.ts.
 */
export async function extractToFactStore(
  message: MessageEnvelope,
  catalog: FactCatalogEntry[],
  provider: ExtractorProvider,
  existingStore?: FactStore,
): Promise<PipelineResult> {
  const store = existingStore ?? new FactStore(catalog);
  const outcome = await runExtraction(message, { provider, catalog });
  factStoreFromExtraction(outcome.extraction, catalog, { store });
  return { outcome, store };
}
