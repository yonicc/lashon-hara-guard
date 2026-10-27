import { FactStore } from './factStore.js';
import { buildMeaningFacts } from './meaning.js';
import type { FactCatalogEntry } from './types.js';
import type { ValidatedExtraction } from './extractor/types.js';

/** An explicit user answer to a clarification question: yes / no / "don't know" (null). */
export type ConfirmedFacts = Record<string, boolean | null>;

/**
 * The one home of "how an extraction (and the user's answers) become engine facts".
 * - Proposed facts enter via store.propose, so confirmedByUserOnly facts stay 'candidate'.
 * - Meaning facts are rebuilt deterministically by meaning.ts.
 * - User answers are applied last and win: true/false via confirmByUser (the only
 *   path that confirms a sensitive fact), null = "don't know" => explicitly unknown,
 *   never false.
 */
export function factStoreFromExtraction(
  extraction: ValidatedExtraction | undefined,
  catalog: FactCatalogEntry[],
  opts: { confirmed?: ConfirmedFacts; store?: FactStore } = {},
): FactStore {
  const store = opts.store ?? new FactStore(catalog);
  const allowed = new Set(catalog.map((entry) => entry.id));
  const propose: FactStore['propose'] = (id, value, provenance, options) => {
    // Once sources conflict, further model repetitions cannot resolve the dispute.
    const existing = store.facts.get(id);
    if (existing?.status === 'disputed') return existing;
    return store.propose(id, value, provenance, options);
  };
  if (extraction) {
    for (const f of extraction.proposedFacts) {
      if (allowed.has(f.id)) propose(f.id, f.value, 'model_extraction', { note: `confidence=${f.confidence}; evidence=${f.evidenceExcerpt}` });
    }
    if (extraction.meaning) {
      const built = buildMeaningFacts(extraction.meaning);
      for (const f of built.facts) if (allowed.has(f.id)) propose(f.id, f.value, f.provenance, f.note ? { note: f.note } : {});
    }
  }
  for (const [id, value] of Object.entries(opts.confirmed ?? {})) {
    if (!allowed.has(id)) continue;
    if (value === null) store.markUnknown(id);
    else if (typeof value === 'boolean') store.confirmByUser(id, value);
  }
  return store;
}
