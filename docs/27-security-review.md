# Pre-launch security review — 2026-10-27

Scope: LHG public download v0.8.2 (e9702c6), proxy live build header bec6a832, current TZ source on Oracle and account/LHG public endpoints. Read-only review and low-volume probes; no real charges, promo redemptions, load tests or credential disclosure. No security fixes deployed by this review.

## Findings

### Remediation verified — 2026-10-27

- Finding 1: deployed proxy code 4192b16680007b7d1c5a5b4d0d58744e9bdf5b06.
  Both POST routes pass IP admission (120/minute) before central calls,
  then current-identity validation and full-account admission (30/minute)
  before reservations/quota increments or classifier calls. Legacy keys pass
  the same authenticated limiter. Refusals return 429/Retry-After; limiter
  exceptions fail closed with 503. Cloudflare counters are approximate and
  per location, so they do not replace the central daily/financial caps.
- Finding 5: deployed account-worker code ba251b0 sets DENY and an additional
  enforced CSP frame-ancestors 'none', preserving any upstream policy, on
  normal pages, API, redirects, 404 and upstream errors.
- Validation: 59 proxy tests and typecheck, 221 TZ tests passed. Live build
  header matched; login/admin/404 carried both anti-framing headers; a fresh
  headless Chrome reported an enforced framing violation from a local foreign
  origin. Bounded sequential requests with an invalid key across /check and
  /warm eventually returned rate_limited/429 with Retry-After 60, without
  account lookup, paid work or model invocation. The first 130-request probe
  did not reject; a second bounded probe rejected on request 113, consistent
  with approximate enforcement rather than an exact 121st-request guarantee.
- Account-limit ordering and shared-token/device budget were verified with
  isolated fixtures; no production personal token, credit or quota was used.
  Other findings below remain open.

1. **High: unmetered warm route / rate limit ordering.** proxy/src/handler.ts handles /warm BEFORE LIMITER. accountAccess.ts validates personal tokens but does not reserve quota/funds for warm. An eligible user can repeatedly invoke Oracle and, on failure, Modal without that rate limit. /check calls account begin (JSON database load/save, quota increment, reservation) before LIMITER, so requests rejected later still consume account quota and hit storage. Apply edge throttling before account calls plus per-account throttling to both routes. Exploit volume/cost was not tested.

2. **High if legacy key remains enabled: unbilled shared-key path.** accountAccess.ts delegates non-lap_ keys directly to handleAuthorized; LHG_ACCESS_KEY authorizes without a personal wallet or daily account quota. The accepted legacy key itself was neither retrieved nor tested. Remove this path or bind the owner's exemption to a normal revocable account token. Do not treat this as an unauthenticated bypass: the shared secret is required.

3. **High: wallet-drain exposure from automatic checks.** extension/incoming.js sends new incoming messages automatically; compose-watch.js checks changed drafts after 1.2 seconds, not just sent messages. Each successful request receives a new random billing ref. Someone able to send a user messages can consume that user's credit; a draft edited over several pauses can also incur several charges. Balance and 500/day bound exposure but do not provide informed spending control. Add explicit disclosure/opt-in, account spending caps and clear controls for automatic incoming checks. Disabling hideIncoming changes visibility, not scanning.

4. **Medium: session lifetime enforced only by browser cookie.** Oracle server.js sessions Map and user() have no expiresAt check. Center/LAP callbacks likewise store no server expiry. Max-Age=2592000 does not expire a stolen cookie submitted manually. Sessions last until logout, deletion or process restart. Implement server TTL, revoke-all and admin reauthentication.

5. **Medium: account clickjacking protection missing.** Live GET account.ysho.uk/account/login has neither X-Frame-Options nor CSP frame-ancestors; current account worker does not add them. LHG itself has DENY. Apply anti-framing headers to account/admin pages and verify in a browser. Sensitive-action exploitation was not attempted.

6. **Promo abuse: account is not person.** redeemPromo enforces one redemption per account and a locked global use cap, but has no person/device/phone uniqueness rule. Multiple genuine Google identities can take multiple grants and exhaust the launch allocation. The monetary grant ceiling remains 100 x 500 agorot = ILS 500, assuming the configured cap is unchanged; other identity creation or concurrent-process scenarios were not exercised. Add campaign abuse monitoring and consider verified-phone/invite eligibility. This is an abuse risk, not evidence that the 101st redemption succeeds.

7. **Privacy disclosure gap.** Browser scripts send message text and bounded prior-message context through the proxy to classifier/model infrastructure. Names in metadata are excluded, but names/secrets inside free text are not thereby anonymized. The public landing page lacks an explicit privacy/processing consent explanation. Verify provider and Brain logging/retention before making no-storage claims. This review did not audit those systems' retention.

8. **Operational: nightly backup broken.** Oracle backup.log reports bash\\r interpreter failure. A recent manual promo backup exists; scheduled recovery coverage is still broken. Repair line endings in source/redeploy, run backup and perform an isolated restore check.

## Positive evidence

- Unauthenticated /check returns 401; LHG /api/lap/me returns 401; center admin users returns 403.
- Public /.env and /.git/config probes returned 404.
- Download archive has 16 files and no suspicious secret/env/key filenames (filename check only, not a complete secret scan).
- Personal token hashes are server-side; revocation/current grants/balance checked centrally; settlement is idempotent.
- Panel uses textContent for page/model strings; no direct innerHTML sink found in reviewed extension scripts.
- Proxy production dependency audit: npm audit --omit=dev reported zero vulnerabilities; this is not a complete application audit.
- Oracle exposes api mapping on 0.0.0.0:3080, but external HTTP probes from yoni-pc timed out. Public reachability/bypass NOT established. Restrict binding/firewall as defense in depth.

Recommendation: address warm throttling, shared-key bypass policy, spending/privacy controls and backup failure before a broad launch; then retest sessions and account anti-framing. Cloudflare WAF rules, provider retention, full dependency tree, real Google login/payment and browser exploit validation remain outside verified coverage.
