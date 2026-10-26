# LAP personal access

The account portal is https://lap.ysho.uk; local token/pricing admin is /admin.
The TZ repository owns the portal and central LAP policy (docs/lap.md there).
Existing account login, UPAY funding and wallet are reused, no second balance.

proxy/src/accountAccess.ts recognizes lap_ personal keys, validates current
central access/funding and reserves the configured check cost before execution.
It settles extracted/skipped_local_gate as completed, otherwise releases.
Stable user ids feed the rate limiter so multiple tokens share the same limit.
Daily quotas live centrally. Message text is never sent to the account API.
The existing owner shared key remains supported for the current installation.

Set LHG_ACCOUNT_KEY as a Worker secret, matching central PARTNER_KEYS.lap.
LHG_ACCOUNT_BASE is https://tz.ysho.uk. Never expose either the partner key
or LHG_BRAIN_TOKEN to browsers or logs. Tokens are managed in the portal,
shown once, stored as hashes centrally, and pasted in extension options.
The extension's existing default proxy URL works; no extension update needed.

Regression: npm run typecheck && npm test in proxy/. Unit tests verify
authorization ordering, release on failures, account-wide limiting identity,
malformed-request rejection, nonbillable warm-up and failed-settlement handling.
