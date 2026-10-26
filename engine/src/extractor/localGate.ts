import { normalizeForMatch, tokenize } from './normalize.js';

export interface LocalGateResult {
  /** True only means: cheap cues warrant (optional) provider extraction. Never "clean". */
  shouldExtract: boolean;
  cues: string[];
  cuesHe: string[];
  costHint: 'skip' | 'extract';
}

// Synthetic, non-exhaustive cue lexicon — triage only, not a rule and not evidence of a verdict.
export const DISPARAGEMENT_CUES: Record<string, string> = {
  'טיפש': 'מילת גנאי מפורשת',
  'אידיוט': 'מילת גנאי מפורשת',
  'חמור': 'מילת גנאי מפורשת',
  'גרוע': 'מילת הערכה שלילית',
  'מזעזע': 'מילת הערכה שלילית',
  'מבזבז': 'מילת הערכה שלילית',
  'משעמם': 'מילת הערכה שלילית',
  'נורא': 'מילת הערכה שלילית',
  'עלוב': 'מילת גנאי מפורשת',
  'כישלון': 'מילת הערכה שלילית',
  'אפס': 'מילת גנאי מפורשת',
  'לא שווה': 'מילת הערכה שלילית',
  'בושה': 'מילת גנאי/בושה',
};

const THIRD_PERSON = new Set(['הוא', 'היא', 'הם', 'הן', 'ההוא', 'ההיא', 'זה', 'זאת']);
const IRONY_MARKERS = ['באמת', 'יופי', 'נהדר', 'מצוין', 'כל הכבוד', 'איזה יופי'];
const HINT_MARKERS = ['ההוא', 'ההיא', 'מהשיעור', 'של אתמול', 'אתם יודעים מי', 'הבחור ההוא'];
const LESSON_WORDS = ['שיעור', 'מוסר השיעור', 'הרב', 'לימד'];

function wordSuffixForms(token: string): string[] {
  // Minimal Hebrew prefix stripping for cue matching (ה/ב/ל/מ/ו/כ/ש...) — triage only.
  const forms = [token];
  const stripped = token.replace(/^[הבלמוכש]+/, '');
  if (stripped && stripped !== token) forms.push(stripped);
  return forms;
}

export function localGate(rawText: string): LocalGateResult {
  const text = normalizeForMatch(rawText);
  const cues: string[] = [];
  const cuesHe: string[] = [];
  if (!text) return { shouldExtract: false, cues: [], cuesHe: [], costHint: 'skip' };

  const tokens = tokenize(text);
  const tokenSet = new Set<string>();
  for (const t of tokens) for (const f of wordSuffixForms(t)) tokenSet.add(f);

  // Disparagement cue words.
  for (const [cue, labelHe] of Object.entries(DISPARAGEMENT_CUES)) {
    if (text.includes(cue) || tokenSet.has(cue)) {
      cues.push(`cue:${cue}`);
      cuesHe.push(labelHe);
    }
  }
  // Third-person reference.
  if (tokens.some((t) => THIRD_PERSON.has(t) || wordSuffixForms(t).some((f) => THIRD_PERSON.has(f)))) {
    cues.push('cue:third_person');
    cuesHe.push('התייחסות בגוף שלישי');
  }
  // Lesson context.
  if (LESSON_WORDS.some((w) => text.includes(w))) {
    cues.push('cue:lesson_context');
    cuesHe.push('הקשר שיעור');
  }
  // Irony / mock praise markers + punctuation.
  if (IRONY_MARKERS.some((m) => text.includes(m)) || /\.\.\.|…/.test(text)) {
    cues.push('cue:possible_irony');
    cuesHe.push('סימן אפשרי לאירוניה/שבח מלעיג');
  }
  // Hint-based identification.
  if (HINT_MARKERS.some((m) => text.includes(m))) {
    cues.push('cue:hint_reference');
    cuesHe.push('התייחסות מרומזת לאדם');
  }
  // Quoted/reported speech often carries third-party content.
  if (text.includes('"') || text.includes("'")) {
    cues.push('cue:quoted');
    cuesHe.push('ציטוט/דיבור מדווח');
  }

  const shouldExtract = cues.length > 0;
  return { shouldExtract, cues: [...new Set(cues)], cuesHe: [...new Set(cuesHe)], costHint: shouldExtract ? 'extract' : 'skip' };
}
