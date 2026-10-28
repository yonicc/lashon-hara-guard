import {
  CC_ALL_DRAFT_PACK,
  evaluate,
  FACT_BY_ID,
  FACT_CATALOG,
  factStoreFromExtraction,
  type ConfirmedFacts,
  type EvaluationInput,
  type EvaluationResult,
  type MessageEnvelope,
  type SourceRef,
  type ValidatedExtraction,
} from '../../engine/src/index.js';

/**
 * Live Chafetz Chaim draft rules in POST /check (owner's decision 2026-10-27,
 * mode "live_draft"; see docs/18). Wire contract is fixed — the extension is
 * built against it:
 *   request  confirmedFacts?: Record<factId, boolean|null>  (catalog ids, <= 20)
 *   response rules?: RulesResult
 * Boundaries: a finding can only raise the alert to 'warn' (alertFor) or ask;
 * nothing here ever says "permitted"; unknown stays unknown; an engine failure is
 * `notChecked: true` and leaves the alert untouched. No message text is logged.
 */
export type RulesMode = 'live' | 'off';

export const MAX_CONFIRMED_FACTS = 20;

/** Added to limitationsHe whenever at least one draft finding is returned. */
export const DRAFT_RULES_LIMITATION_HE =
  'לפי כללי טיוטה מספר חפץ חיים — לא נבדקו בידי מומחה; אינו פסק הלכה.';

export const ANSWER_LABELS_HE: ReadonlyArray<{ value: boolean | null; labelHe: string }> = [
  { value: true, labelHe: 'כן' },
  { value: false, labelHe: 'לא' },
  { value: null, labelHe: 'לא יודע' },
];

export interface RulesFinding {
  ruleId: string;
  code: string;
  messageHe: string;
  sourceRef: string;
  sourceUrl: string;
}

export interface RulesQuestion {
  factId: string;
  textHe: string;
  answers: Array<{ value: boolean | null; labelHe: string }>;
}

/**
 * A group-D rabbi referral (docs/32, docs/40 §B, owner 2026-10-29): a
 * structured question to a qualified rabbi, never a ruling. Additive to the
 * fixed /check contract — the extension renders it only when present.
 */
export interface RulesReferral {
  sectionKey: string;
  sourceRef: string;
  sourceUrl: string;
  category: string;
  questionHe: string;
  howToAskHe: string;
  backgroundHe: string;
  quotesHe: string[];
  gatheredFacts: Array<{ id: string; questionHe: string; valueHe: string; provenanceHe: string }>;
  uncertainHe: string[];
  whyNotCheckedHe: string;
}

export interface RulesResult {
  mode: 'live_draft';
  notChecked?: boolean;
  findings: RulesFinding[];
  question?: RulesQuestion;
  referrals?: RulesReferral[];
}

/** `LHG_CC_RULES`: 'off' disables; anything else (incl. unset) = 'live'. */
export function rulesModeFromEnv(env: { LHG_CC_RULES?: string }): RulesMode {
  return (env.LHG_CC_RULES ?? '').trim().toLowerCase() === 'off' ? 'off' : 'live';
}

/**
 * Untrusted wire value -> user answers. Silently drops anything that is not a
 * plain object, any id outside FACT_CATALOG, any value other than true/false/null,
 * and everything after the first MAX_CONFIRMED_FACTS valid entries.
 */
export function pickConfirmedFacts(raw: unknown): ConfirmedFacts {
  const out: ConfirmedFacts = Object.create(null) as ConfirmedFacts;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_CONFIRMED_FACTS) break;
    if (!FACT_BY_ID.has(id)) continue;
    if (value !== true && value !== false && value !== null) continue;
    out[id] = value;
    n++;
  }
  return out;
}

export function notCheckedRules(): RulesResult {
  return { mode: 'live_draft', notChecked: true, findings: [] };
}

function sourceRefOf(s: SourceRef | undefined): string {
  if (!s) return '';
  return [s.work, s.part, s.section].filter(Boolean).join(', ');
}

/**
 * Run the draft pack on the validated extraction plus the user's answers.
 * Never throws: any failure (or a pack the engine refuses) is notChecked.
 */
export function runLiveRules(
  message: MessageEnvelope,
  extraction: ValidatedExtraction | undefined,
  confirmed: ConfirmedFacts,
  modelVersion: string,
  evaluateImpl: (input: EvaluationInput) => EvaluationResult = evaluate,
): RulesResult {
  try {
    const store = factStoreFromExtraction(extraction, FACT_CATALOG, { confirmed });
    const r = evaluateImpl({
      message,
      facts: store.snapshot(),
      rulePack: CC_ALL_DRAFT_PACK,
      catalog: FACT_CATALOG,
      // One question reaches the user. Facts already answered ("don't know" stays
      // unknown and would be planned again) are skipped, so plan that many extra.
      maxQuestions: 1 + Object.keys(confirmed).length,
      ruleMode: 'live_draft',
      contextVersion: 'proxy-check',
      modelVersion,
    });
    if (r.status === 'not_checked') return notCheckedRules();
    const findings: RulesFinding[] = r.findings.map((f) => ({
      ruleId: f.ruleId,
      code: f.code,
      messageHe: f.messageHe,
      sourceRef: sourceRefOf(f.source),
      sourceUrl: f.source?.url ?? '',
    }));
    const q = r.questions.find((x) => !(x.factId in confirmed));
    const question: RulesQuestion | undefined = q
      ? { factId: q.factId, textHe: q.questionHe, answers: ANSWER_LABELS_HE.map((a) => ({ ...a })) }
      : undefined;
    // Group-D referrals are additive: findings stay draft reminders; a
    // referral is the only artifact for a section the device cannot rule on.
    const referrals: RulesReferral[] | undefined = r.referrals.length
      ? r.referrals.map((x) => ({
          sectionKey: x.sectionKey,
          sourceRef: x.sourceRef,
          sourceUrl: x.sourceUrl,
          category: x.category,
          questionHe: x.questionHe,
          howToAskHe: x.howToAskHe,
          backgroundHe: x.backgroundHe,
          quotesHe: x.quotesHe,
          gatheredFacts: x.gatheredFacts,
          uncertainHe: x.uncertainHe,
          whyNotCheckedHe: x.whyNotCheckedHe,
        }))
      : undefined;
    return {
      mode: 'live_draft',
      findings,
      ...(question ? { question } : {}),
      ...(referrals ? { referrals } : {}),
    };
  } catch {
    return notCheckedRules();
  }
}
