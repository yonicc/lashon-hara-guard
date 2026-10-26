# Context Builder integration

The extension loads context-dom, context-store, context-builder and context-runtime
before its adapters. Incoming scans observe baseline messages locally without
sending checks; subsequent checks carry at most five preceding messages.
Outgoing WhatsApp drafts and manual checks use the same context bridge.
The background forwards only the optional packet alongside the original check fields.
The proxy bounds the packet and invokes the engine sanitizer before extraction.

The canonical TypeScript packet is engine/src/contextPacket.ts. Extractor types
reference it rather than maintaining a second schema. Candidate facts remain
candidate; sensitive known facts require explicit user confirmation. Missing
authors and forwarding indicators remain unknown. Observed authors are not used
to infer total audience size.

Runtime conversation keys are local and mapped to session-scoped opaque refs.
Packets are captured before queue delays. A WhatsApp title change starts a fresh
scope. Google mail/chat requires an explicit DOM thread/space ID; an unidentified
view falls back to checking the current message without context.

Limits: DOM identity detection is conservative and still needs real-browser
validation; this integration's tests use synthetic DOM and a mock extraction
provider. Runtime context is session-scoped and is not rehydrated after reload.
The existing store receives local message writes and retention cleanup. The
confirmation methods are programmatic; this change adds no confirmation UI.
No production deployment or active unpacked-extension update is part of this branch.

Verification:
- Root: node --test extension/*.test.cjs
- engine/: npm run typecheck; npm test
- proxy/: npm run typecheck; npm test
- The proxy integration suite runs the actual builder/runtime/background scripts,
  Worker handler and prompt renderer, including redaction, queue snapshots,
  conversation switches, missing context and user-confirmation policy.
