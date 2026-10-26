// Hebrew text normalization — conservative, reversible-ish, no linguistic guessing.

const NIQUD = /[\u0591-\u05BD\u05BF-\u05C7]/g; // vowel points + accents (U+05BE maqaf handled below)
const TATWEEL = /ـ/g;
const CANTILLATION_OTHERS = /[\u05C1-\u05C7]/g;
const QUOTE_MAP: Record<string, string> = {
  '“': '"', '”': '"', '„': '"', '׳': "'", '’': "'", '״': '"', '‘': "'",
  '\u05BE': '-', // Hebrew maqaf -> plain hyphen for matching stability
};
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
const MULTISPACE = /[ \t\f\v]+/g;

export function normalizeHebrewText(input: string): string {
  let s = (input ?? '').normalize('NFC');
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(TATWEEL, '').replace(NIQUD, '').replace(CANTILLATION_OTHERS, '');
  // Unify quotes without touching content characters.
  s = [...s].map((ch) => QUOTE_MAP[ch] ?? ch).join('');
  // Unify whitespace (preserves line breaks, collapses runs).
  s = s.split('\n').map((line) => line.replace(MULTISPACE, ' ').trim()).join('\n');
  return s.trim();
}

export function stripPunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text.split(/\s+/).map(stripPunctuation).filter(Boolean);
}

/** Display form only — matching uses normalizeHebrewText output. */
export function normalizeForMatch(text: string): string {
  return normalizeHebrewText(text).toLowerCase();
}
