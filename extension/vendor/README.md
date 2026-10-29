# Packaged local inference runtime

The separately versioned meaning decider uses vendor/decider/: Transformers.js 3.8.1
(@huggingface/transformers dist/transformers.min.js renamed transformers.min.mjs;
the web.min build has bare external ORT imports and is not the standalone bundle)
and its pinned ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4 JSEP WASM/mjs pair.
Its env/cache is independent of the 2.17 memory/router runtime. Copy all three
dist files plus the Apache-2.0/MIT licenses. Model data is explicitly imported,
SHA-256 pinned by decider-manifest.mjs, and inference is cached-only. No CDN.

Transformers.js 2.17.2 (`@xenova/transformers/dist/transformers.min.js`, renamed to .mjs)
and ONNX Runtime Web 1.14.0 non-threaded WASM binaries from that package's dist/.
No runtime CDN imports. Reproduce with npm install --prefix <assets> @xenova/transformers@2.17.2,
then copy the named files from dist/. Retain the Apache-2.0 and MIT licenses beside them.
Sources: https://github.com/huggingface/transformers.js/tree/2.17.2
and https://github.com/microsoft/onnxruntime/tree/v1.14.0 .
Model weights and tokenizer are not packaged: explicit options-page install downloads the pinned
Xenova/multilingual-e5-small revision specified by memory-embedding.mjs to extension Cache Storage.
No conversation text is sent to the download host.
