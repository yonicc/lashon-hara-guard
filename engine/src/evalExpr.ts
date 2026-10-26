import type { Expr, FactMap, Tri } from './types.js';

function lookup(facts: FactMap, id: string): { known: boolean; value?: unknown; disputed: boolean } {
  const f = facts.get(id);
  if (!f || f.status === 'unknown' || f.status === 'candidate') return { known: false, disputed: false };
  if (f.status === 'disputed') return { known: false, disputed: true };
  return { known: true, value: f.value, disputed: false };
}

/** Three-valued evaluation: unknown stays unknown, never collapses to false. */
export function evalExpr(expr: Expr, facts: FactMap): Tri {
  if ('eq' in expr) {
    const [id, expected] = expr.eq;
    const r = lookup(facts, id);
    if (!r.known) return 'unknown';
    return r.value === expected;
  }
  if ('neq' in expr) {
    const [id, expected] = expr.neq;
    const r = lookup(facts, id);
    if (!r.known) return 'unknown';
    return r.value !== expected;
  }
  if ('in' in expr) {
    const [id, options] = expr.in;
    const r = lookup(facts, id);
    if (!r.known) return 'unknown';
    return (options as unknown[]).includes(r.value);
  }
  if ('exists' in expr) return lookup(facts, expr.exists).known;
  if ('missing' in expr) return !lookup(facts, expr.missing).known;
  if ('gte' in expr) {
    const [id, n] = expr.gte;
    const r = lookup(facts, id);
    if (!r.known || typeof r.value !== 'number') return 'unknown';
    return r.value >= n;
  }
  if ('and' in expr) {
    let sawUnknown = false;
    for (const sub of expr.and) {
      const v = evalExpr(sub, facts);
      if (v === false) return false;
      if (v === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : true;
  }
  if ('or' in expr) {
    let sawUnknown = false;
    for (const sub of expr.or) {
      const v = evalExpr(sub, facts);
      if (v === true) return true;
      if (v === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : false;
  }
  if ('not' in expr) {
    const v = evalExpr(expr.not, facts);
    return v === 'unknown' ? 'unknown' : !v;
  }
  return 'unknown';
}

/** Collect fact ids referenced by an expression. */
export function exprFactIds(expr: Expr, out = new Set<string>()): Set<string> {
  if ('eq' in expr) out.add(expr.eq[0]);
  else if ('neq' in expr) out.add(expr.neq[0]);
  else if ('in' in expr) out.add(expr.in[0]);
  else if ('exists' in expr) out.add(expr.exists);
  else if ('missing' in expr) out.add(expr.missing);
  else if ('gte' in expr) out.add(expr.gte[0]);
  else if ('and' in expr) expr.and.forEach((e) => exprFactIds(e, out));
  else if ('or' in expr) expr.or.forEach((e) => exprFactIds(e, out));
  else if ('not' in expr) exprFactIds(expr.not, out);
  return out;
}

export function isFactKnown(facts: FactMap, id: string): boolean {
  return lookup(facts, id).known;
}
