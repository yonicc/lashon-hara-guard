# Public and personal distribution (2026-10-29)

Owner approved: public cloud checks use only Baseten meta-models/muse-spark-open-1026, directly from the proxy. Personal installation retains its existing private legacy access key and model picker. Never bundle either credential. Public account identity and billing continue through existing LAP partner begin/finish APIs; every new check/clarification round is charged.

The server derives LHG_PUBLIC_CHECK only after validating a lap_ token; request bodies/headers cannot choose this privilege. No Baseten key means fail closed, never fallback to Brain. Public ZIP prepends LHG_PUBLIC_BUILD=true to check-mode.js, giving one model choice; repository extension remains personal. Public package must omit test files, fixtures, hidden files, credentials and Git metadata. Open source does not grant access: the server credential is the authority.

## Technical debt: retry idempotency (owner explicitly deferred)
Each /check currently creates a fresh crypto.randomUUID() reservation ref in proxy/src/accountAccess.ts. A transport retry after a lost response can charge twice, even though finish of a single ref is idempotent.
Future fix: stable client operation ID per logical check (new ID per clarification round), unique server-side binding to authenticated account and request digest; atomic in-flight claim and replay of terminal result. Reject key reuse with different content, preserve holds across timeouts, define bounded replay retention. Validate parallel duplicate requests, lost responses, mismatched bodies and separate billed rounds. Do not implement request-body-only deduplication (intentional repeat checks are billable).
