import { FACT_BY_ID } from './lessonScenario.js';

/** Shared cloud/local clarification protocol. Scope is application-owned, never model input. */
export const MAX_ROUNDS = 3;
export const MAX_NEEDS_QUESTIONS = 5;
export const ANSWER_LABELS_HE: ReadonlyArray<{ value: boolean | null; labelHe: string }> = [
  { value: true, labelHe: 'כן' }, { value: false, labelHe: 'לא' }, { value: null, labelHe: 'לא יודע' },
];
export interface NeedsQuestion {
  factId: string; textHe: string; answers: Array<{ value: boolean | null; labelHe: string }>;
}
export type ContextRequest =
  | { id: string; kind: 'get_recent'; args: { n: number } }
  | { id: string; kind: 'search_history'; args: { query: string; top_k: number } };
export interface Needs {
  round: number; maxRounds: 3; requests: ContextRequest[]; questions: NeedsQuestion[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function validRound(v: unknown): number | null {
  return v === undefined ? 1 : Number.isInteger(v) && Number(v) >= 1 && Number(v) <= MAX_ROUNDS ? Number(v) : null;
}
const bound = (v: unknown, fallback: number, max: number) =>
  v === undefined ? fallback : Number.isInteger(v) && Number(v) >= 1 ? Math.min(Number(v), max) : null;
/** Rebuild question wording/answers from the catalog; provider wording is never trusted. */
export function catalogQuestions(raw: unknown, confirmed: Record<string, unknown> = {}): NeedsQuestion[] {
  const out: NeedsQuestion[] = [], seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = typeof item === 'string' ? item : record(item) ? item.factId : null;
    if (typeof id !== 'string' || Object.hasOwn(confirmed, id) || seen.has(id)) continue;
    const fact = FACT_BY_ID.get(id);
    if (!fact) continue;
    seen.add(id);
    out.push({ factId: id, textHe: fact.questionHe, answers: ANSWER_LABELS_HE.map(a => ({ ...a })) });
    if (out.length === MAX_NEEDS_QUESTIONS) break;
  }
  return out;
}
export function validateNeeds(raw: unknown, round = 1, questions: unknown[] = [],
  confirmed: Record<string, unknown> = {}): Needs {
  const source = record(raw) ? raw : {};
  const requests: ContextRequest[] = [], seen = new Set<string>();
  for (const item of Array.isArray(source.requests) ? source.requests.slice(0, 20) : []) {
    if (!record(item) || !record(item.args) || typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || seen.has(item.id)) continue;
    const a = item.args;
    if (item.kind === 'get_recent') {
      const n = bound(a.n, 5, 20);
      if (n !== null) requests.push({ id: item.id, kind: 'get_recent', args: { n } });
    } else if (item.kind === 'search_history' && typeof a.query === 'string' && a.query.trim()) {
      const top_k = bound(a.top_k, 3, 5);
      if (top_k !== null) requests.push({ id: item.id, kind: 'search_history',
        args: { query: a.query.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300), top_k } });
    }
    if (requests.at(-1)?.id === item.id) seen.add(item.id);
    if (requests.length === 2) break;
  }
  return { round: validRound(round) ?? MAX_ROUNDS, maxRounds: MAX_ROUNDS, requests,
    questions: catalogQuestions([...questions, ...(Array.isArray(source.questions) ? source.questions : [])], confirmed) };
}
export function localNeeds(heads: unknown, text: string, questions: unknown[], round = 1,
  confirmed: Record<string, unknown> = {}): Needs {
  const labels = Array.isArray(heads) ? heads : [];
  return validateNeeds({ requests: [
    ...(labels.includes('mem_search') ? [{ id: 'local-search', kind: 'search_history', args: { query: text, top_k: 3 } }] : []),
    ...(labels.includes('mem_recent') ? [{ id: 'local-recent', kind: 'get_recent', args: { n: 5 } }] : []),
  ], questions: labels.includes('ask_user') ? questions : [] }, round, questions, confirmed);
}
export function needsPending(needs: Needs | undefined): boolean {
  return !!needs && !!(needs.requests.length || needs.questions.length);
}
