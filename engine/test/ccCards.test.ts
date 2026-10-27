// Guards the Chafetz Chaim rule-card layer (rules/chafetz-chaim/cards) against the source layer
// (sources/chafetz-chaim). Cards are model-drafted study material: they must cite exactly, quote
// verbatim, use only known fact ids, and never be anything but draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(REPO, 'sources', 'chafetz-chaim');
const RULES = join(REPO, 'rules', 'chafetz-chaim');
const KINDS = new Set(['prohibition', 'aggravation', 'definition', 'condition', 'exception',
  'listener_duty', 'repair', 'motivation', 'other']);

/** Same normalisation as gen_cards.py `norm` (niqqud-free, punctuation-light, single-spaced). */
const norm = (s: string) =>
  s.replace(/[֑-ׇ]/g, '').replace(/־/g, ' ')
    .replace(/["'׳״()[\],.:;!?-]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

interface Seif { n: number; ref: string; url: string; sha256: string }
interface Card {
  id: string; ref: string; url: string; textSha256: string; kind: string; reviewStatus: string;
  quotesHe: string[]; factsNeeded: string[]; titleHe: string; summaryHe: string;
}

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')) as {
  principles: { key: string; seifim: Seif[] }[];
};
const factIds = new Set(
  (JSON.parse(readFileSync(join(RULES, 'facts.json'), 'utf8')).facts as { id: string }[]).map((f) => f.id),
);

function seifText(key: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of readFileSync(join(SRC, 'text', `${key}.txt`), 'utf8').split(/\r?\n/)) {
    const m = /^\[(\d+)\] (.*)$/.exec(line);
    if (m) out.set(Number(m[1]), m[2] ?? '');
  }
  return out;
}

const cardFiles = readdirSync(join(RULES, 'cards')).filter((f) => f.endsWith('.json'));

function assertSourceHash(text: string | undefined, expected: string, label: string): void {
  assert.ok(text, `${label}: source section missing`);
  const actual = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  assert.equal(actual, expected, `${label}: actual source text differs from manifest`);
}
const cards = new Map<string, Card>();
for (const f of cardFiles) {
  for (const c of JSON.parse(readFileSync(join(RULES, 'cards', f), 'utf8')) as Card[]) {
    assert.ok(!cards.has(c.id), `duplicate card ${c.id}`);
    cards.set(c.id, c);
  }
}

test('CC-01 every se\'if in the source manifest has exactly one card, and no card is orphaned', () => {
  const expected = new Set<string>();
  for (const p of manifest.principles) for (const s of p.seifim) expected.add(`cc.${p.key}.${s.n}`);
  const missing = [...expected].filter((id) => !cards.has(id));
  const orphan = [...cards.keys()].filter((id) => !expected.has(id));
  assert.deepEqual(missing, []);
  assert.deepEqual(orphan, []);
});

test('CC-02 each card cites the exact Sefaria ref/url and the current text hash', () => {
  for (const p of manifest.principles) {
    const texts = seifText(p.key);
    for (const s of p.seifim) {
      assertSourceHash(texts.get(s.n), s.sha256, `${p.key}:${s.n}`);
      const c = cards.get(`cc.${p.key}.${s.n}`);
      if (!c) continue;
      assert.equal(c.ref, s.ref, c.id);
      assert.equal(c.url, s.url, c.id);
      assert.equal(c.textSha256, s.sha256, `${c.id}: source text changed since drafting - redraft and review`);
    }
  }
});

test('CC-03 every card is draft: no model-drafted card may be approved or reviewed', () => {
  for (const c of cards.values()) assert.equal(c.reviewStatus, 'draft', c.id);
});

test('CC-04 quotes occur verbatim in the se\'if (niqqud-insensitive)', () => {
  for (const p of manifest.principles) {
    const texts = seifText(p.key);
    for (const s of p.seifim) {
      const c = cards.get(`cc.${p.key}.${s.n}`);
      if (!c) continue;
      const t = norm(texts.get(s.n) ?? '');
      for (const q of c.quotesHe) assert.ok(t.includes(norm(q)), `${c.id}: quote not in source: ${q}`);
    }
  }
});

test('CC-05 cards use only vocabulary fact ids and a known kind, and are not empty', () => {
  for (const c of cards.values()) {
    for (const f of c.factsNeeded) assert.ok(factIds.has(f), `${c.id}: unknown fact ${f}`);
    assert.ok(KINDS.has(c.kind), `${c.id}: kind ${c.kind}`);
    assert.ok(c.titleHe && c.summaryHe, `${c.id}: empty title/summary`);
  }
});

test('CC-06 fact-merge-map targets exist in facts.json and vocabulary stays small', () => {
  const map = JSON.parse(readFileSync(join(RULES, 'fact-merge-map.json'), 'utf8')) as Record<string, { action: string; target?: string }>;
  // 61 preserved ids plus 18 source-specific distinctions (docs/19).
  assert.ok(factIds.size <= 79, `vocabulary too large: ${factIds.size}`);
  for (const [pid, d] of Object.entries(map)) {
    if (d.action === 'merge' || d.action === 'new') assert.ok(d.target && factIds.has(d.target), `${pid}: target ${d.target} not in facts.json`);
    else assert.equal(d.action, 'reject', `${pid}: unknown action ${d.action}`);
  }
});

test('CC-07 source mutation fails independently of unchanged manifest and card hashes', () => {
  const p = manifest.principles[0]!;
  const s = p.seifim[0]!;
  const text = seifText(p.key).get(s.n)!;
  assertSourceHash(text, s.sha256, 'original');
  assert.throws(() => assertSourceHash(text + ' changed', s.sha256, 'mutated'), /actual source text differs/);
});
