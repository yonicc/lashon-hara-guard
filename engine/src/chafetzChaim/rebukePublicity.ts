// Primary source p1_prin10:7-9; these predicates affect publicity only.
// Fear in section 8 is a possible leniency requiring expert review, never a permit.
import { all, any, yes } from './shared.js';
export const PUBLICLY_ESTABLISHED_SPEAKER = all(
  yes('speaker.publicly_known_impartial'),
  yes('speaker.publicly_known_says_in_presence'),
  yes('speaker.publicly_known_fearless'),
  yes('speaker.publicly_known_truthful'),
);
export const REBUKE_PUBLICITY_EXCEPTIONS = [
  yes('speaker.fears_retaliation_from_subject'), PUBLICLY_ESTABLISHED_SPEAKER,
];
export const ESTABLISHED_REBUKE_ALTERNATIVE = all(
  yes('toelet.knows_subject_will_not_accept_rebuke'),
  any(yes('audience.size_at_least_three'), PUBLICLY_ESTABLISHED_SPEAKER),
);
