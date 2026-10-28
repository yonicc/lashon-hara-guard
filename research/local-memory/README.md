# Local memory lab — synthetic browser POC

Isolated from `extension/`, the Worker, gate and `/check`. No automatic DOM collectors are attached.
The model-facing read interface works today in real Chrome; a trained router is not included.
See [docs/35](../../docs/35-local-memory-ingestion-and-browser-test.md) for ownership, triggers and limitations.

## Reproduce on Windows / PowerShell

Install Node, Chrome, and the pinned Playwright dependency:

```powershell
cd research/local-memory
npm ci
```

Prepare a separate asset directory once (do not commit models or node_modules):

```powershell
npm install --prefix C:\lhg-memory-assets --no-audit --no-fund @xenova/transformers@2.17.2
cd C:\lhg-memory-assets
node --input-type=module -e "import { pipeline } from '@xenova/transformers'; await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {quantized:true});"
```

The preparation downloads model files from Hugging Face. It sends no messages. Subsequent browser tests
serve model assets from disk through an ephemeral loopback HTTP server and deny external browser requests.

```powershell
cd <checkout>\research\local-memory
$env:LHG_TRANSFORMERS_DIR='C:\lhg-memory-assets\node_modules\@xenova\transformers'
npm test
```

In a Brain runner, put commands containing PowerShell variables in a byte-exact `.ps1` file.
The runner used the already cached assets in the prior research worktree instead of downloading again.
`browser-results.json` contains the measured result. A new run overwrites it.
The browser uses a disposable profile; the test closes and reopens the real browser to test persistence,
then removes that profile. This does not touch the owner's browser or supported-site data.

## Application / local model interface

Serve `memory.mjs`, `embedding.mjs`, local vendor bundle/WASM and model files using the route map
in `browser-test.mjs`. The same modules are suitable for a later extension-owned document;
that MV3 packaging/lifecycle has NOT been tested by this lab.

```javascript
import { LocalMemory } from './memory.mjs';
import { loadLocalEmbed } from './embedding.mjs';
const memory = new LocalMemory({embed: await loadLocalEmbed()});
const scope = {platform:'gmail',accountId:'synthetic-account',conversationId:'synthetic-thread'};

// Trusted application collector, not a model tool.
await memory.ingest({
  type:'message_observed', scope, sourceId:'stable-message-id',
  enabled:true, observedAt:Date.now(), direction:'incoming',
  text:'הרכב במוסך בגלל תקלה במנוע.'
});

// Bind account/conversation from trusted application state before model invocation.
const tools = memory.tools(scope);
await tools.search_history({query:'מה קרה למכונית?',top_k:3});
await tools.get_recent({k:5});
```

No model-generated scope, SQL, mutation, arbitrary URL, or executable code is accepted.
The application must expose ONLY the two methods returned by `tools()`, not the `memory` instance.
Querying is read-only. Snippets are untrusted data with `status:'candidate'` and
`provenance:'dom_observed'`, never confirmed facts. Results contain at most 300 characters each.
This is a callable API for a future local router; no autonomous model/router was trained or run.

The trusted collector supplies identity and ordering; this library does not authenticate DOM events.
Owner decision: ingest all text entered in diagnosed fields on selected sites, including unsent input,
plus any additional context collected from mail/conversations. Use `input_observed` for draft snapshots
(same source ID on updates) and `context_observed` for collected context; returned `kind` distinguishes
draft, context and message. Actual DOM event hooks and migration from draft to sent message remain integration work.
An unavailable stable message/account/thread identity must stop persistence, not fall back to a display name.
`message_edited` uses the same source ID and replaces text/vector atomically.
Call `deleteMessage`, `deleteConversation`, `clear`, `purge` from application controls.
Call `purge` on startup and periodically; reads independently exclude expired rows.
A rejected embedding leaves the previous record untouched. Callers must handle errors and continue
a normal check with unavailable context, never infer false/permission.
Writes are serialized within one owner instance. Do not run multiple independent writers against the
same database; later MV3 integration must enforce a single owner.

Maximum 1,000 characters per record, 20,000 records globally, 14 days from first observation.
Longer inputs are rejected explicitly in this POC; a chunking adapter is required before connecting full emails.
Do not silently truncate or claim complete email ingestion with this API.
Replay and edits do not extend expiry. Oldest records are evicted at capacity.
Text and vectors are a single record: no detached index survives deletion.
No disk encryption is supplied. Browser/site storage is still locally accessible.
The model namespace must change/reindex if encoder/pooling/tokenization changes.

## Measurement limits

Real multilingual-e5-small q8 inference runs in Chrome CPU/WASM, single thread. Network is loopback only.
The Hebrew smoke test contains three distinct synthetic passages and one paraphrase query; this is
not an independent retrieval-quality benchmark. The 2,000-record latency fixture repeats genuine vectors
from those passages via a batch IndexedDB insert: it measures storage, scoring and query embedding,
not corpus diversity or ingestion throughput. Thirty repeated queries report warm p50/p95.
No WebGPU, cold model download, live Gmail/Chat/WhatsApp DOM integration, MV3 offscreen lifetime,
multi-writer races, disk encryption, or trained local model tool selection was tested.
