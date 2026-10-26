import type { FactCatalogEntry, PlannedQuestion, Rule } from './types.js';

interface Candidate {
  factId: string;
  unlocks: Set<string>;
  bestSeverity: number;
  priority: number;
}

const SEVERITY_RANK: Record<Rule['outcome']['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Pick at most maxQuestions questions (default 1) from missing facts.
 * Ranking: unlocks more/higher-severity rules first, then catalog priority.
 * Fixed order only — no value-of-information optimisation in v1.
 */
export function planQuestions(
  missingByRule: Map<string, { rule: Rule; missing: string[] }>,
  catalog: FactCatalogEntry[],
  maxQuestions = 1,
): PlannedQuestion[] {
  const byFact = new Map<string, Candidate>();
  for (const { rule, missing } of missingByRule.values()) {
    for (const factId of missing) {
      const entry = catalog.find((c) => c.id === factId);
      if (!entry) continue; // never invent a question that is not in the catalog
      const cur =
        byFact.get(factId) ??
        ({ factId, unlocks: new Set<string>(), bestSeverity: 0, priority: entry.priority } satisfies Candidate);
      cur.unlocks.add(rule.id);
      cur.bestSeverity = Math.max(cur.bestSeverity, SEVERITY_RANK[rule.outcome.severity]);
      byFact.set(factId, cur);
    }
  }
  const ranked = [...byFact.values()].sort(
    (a, b) =>
      b.unlocks.size - a.unlocks.size ||
      b.bestSeverity - a.bestSeverity ||
      a.priority - b.priority ||
      a.factId.localeCompare(b.factId),
  );
  return ranked.slice(0, Math.max(0, maxQuestions)).map((c) => {
    const entry = catalog.find((x) => x.id === c.factId)!;
    return {
      factId: c.factId,
      questionHe: entry.questionHe,
      whyHe: `המידע חסר להשלמת בדיקה (${[...c.unlocks].join(', ')})`,
      unlocksRuleIds: [...c.unlocks].sort(),
    };
  });
}
