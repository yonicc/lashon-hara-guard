import type { FactCatalogEntry, FactMap, FactRecord, FactValue, ProvenanceKind } from './types.js';

export class FactStore {
  readonly facts: FactMap = new Map();

  constructor(private readonly catalog: FactCatalogEntry[] = []) {}

  private entry(factId: string): FactCatalogEntry | undefined {
    return this.catalog.find((c) => c.id === factId);
  }

  /**
   * Record a fact candidate. Sensitive persistent facts (confirmedByUserOnly)
   * stay 'candidate' unless provenance is an explicit user confirmation.
   */
  propose(
    factId: string,
    value: FactValue,
    provenance: ProvenanceKind,
    opts: { scope?: FactRecord['scope']; note?: string; userConfirmed?: boolean } = {},
  ): FactRecord {
    const e = this.entry(factId);
    const needsUser = Boolean(e?.confirmedByUserOnly);
    const known = !needsUser || (provenance === 'user' && opts.userConfirmed === true);
    const existing = this.facts.get(factId);
    const disputed =
      Boolean(existing && existing.status === 'known' && existing.value !== value && provenance !== 'user');
    const rec: FactRecord = {
      id: factId,
      value,
      status: disputed ? 'disputed' : known ? 'known' : 'candidate',
      provenance,
      scope: opts.scope ?? (e?.persistent ? 'relationship' : 'message'),
      updatedAt: new Date().toISOString(),
      ...(opts.note ? { note: opts.note } : {}),
    };
    this.facts.set(factId, rec);
    return rec;
  }

  /** Explicit user answer; the only path that confirms sensitive facts. */
  confirmByUser(factId: string, value: FactValue, scope?: FactRecord['scope']): FactRecord {
    return this.propose(factId, value, 'user', { userConfirmed: true, ...(scope ? { scope } : {}) });
  }

  markUnknown(factId: string): FactRecord {
    const rec: FactRecord = {
      id: factId,
      value: '',
      status: 'unknown',
      provenance: 'user',
      scope: 'message',
      updatedAt: new Date().toISOString(),
      note: 'user_declined_or_does_not_know',
    };
    this.facts.set(factId, rec);
    return rec;
  }

  delete(factId: string): void {
    this.facts.delete(factId);
  }

  snapshot(): FactMap {
    return new Map(this.facts);
  }
}
