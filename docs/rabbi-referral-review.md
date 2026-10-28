# Rabbi referral merge review

Reviewed 2026-10-28: research/rabbi-referral, eedfef5c77abc4647c13d0015013c56767ab507d,
temporarily merged without committing into origin/main 23e3bb6 in an isolated worktree.
Decision: do not merge this implementation.

## Blocking findings

1. Worker runtime failure: engine/src/chafetzChaim/referral.ts reads sourceCoverage.json
   and the cards through node:fs at runtime. Wrangler's bundle retains filesystem
   reads but does not include those files. A bundled synthetic runLiveRules probe
   in Miniflare/workerd with the project's compatibility date and nodejs_compat
   returns {"mode":"live_draft","notChecked":true,"findings":[]}.
   Thus the change disables all rule evaluation in the deployed environment,
   rather than adding referrals. Bundle referral data as static runtime-safe data
   and add a Worker-runtime regression, not only Node tests.

2. All 12 blocked sections have zero rules in CC_ALL_DRAFT_PACK (verified by joining
   coverageKeyOfSource(rule.source) to groupDSections). Referral emission for these
   sections is inside the rule loop and is therefore unreachable. The new blocked
   red-line test only checks absence of findings; it never asserts a referral exists.
   Add explicit deterministic relevance routing for sections without executable rules
   and positive tests that each blocked section can actually produce a referral.

3. The 61 partial group-D sections still pass through ordinary finding generation.
   This includes approved rules if a pack later changes reviewStatus. The strict
   prohibition is not enforced for all 73 sections. The subsequent referral pass
   considers only findings/missing facts, so it also omits matched internal draft
   observations and other paths. Define and test referral-only behavior for every
   relevant group-D section and every rule mode, including approved-rule fixtures.

4. extension/rules.js silently truncates referrals to eight and gatheredFacts to
   twenty. The referral can lose relevant sections or collected details without
   indicating omission. Preserve the full bounded catalog/section set or explicitly
   provide a complete referral view/export with an omission notice in previews.

## Validation

- Engine typecheck passed; 279 tests passed, one skipped.
- Proxy typecheck passed; 63 tests passed.
- Extension: 129 tests passed.
- Wrangler deploy --dry-run succeeded, which did not detect the runtime failure.
- Synthetic workerd probe returned notChecked:true.
- No production deployment; no push to main; temporary integration merge aborted.

## Durable project lesson

Node tests and a successful Wrangler dry-run do not prove Worker execution.
Keep engine runtime modules independent of the checkout filesystem. Test the
bundled runLiveRules code in workerd with the same compatibility settings, and
assert successful rule/referral output instead of merely a successful HTTP status.
