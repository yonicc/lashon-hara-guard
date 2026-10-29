# Technical debt

## Local extractor meaning assessment

Status: approved future work; not implemented in the shipped extractor.
Extend the local extractor contract with a `meaning` field: concern yes/no,
mechanism, and a verbatim evidence quote. Distil cloud meaning output on
synthetic data using the generation/translation pipeline in docs/37–40
(DictaLM translation; Qwen for mixed text). Train on Modal like e10-v2,
with checkpointing and `--detach`; export GGUF Q4 for Ollama.
Gate release on the independent evaluation in [docs/47](47-independent-eval-20261029.md)
and the 0.02 parity rule in [docs/49](49-extractor-v2-ollama.md); never train or calibrate on independent sets.
Estimate: several days plus Modal credits. Longer outputs mean slower local checks.
A separate local meaning classifier is being implemented; it does not complete
this extractor-contract work or authorize missing facts as false.

## DictaLM union model remains old-generation

The DictaLM extractor in local-union is still the previous generation.
Union with e10-v2 has not been re-measured. Do not advertise the old union
measurement as an evaluation of the new pair. Re-measure on the independent
evaluation before changing comparative claims.

## Retry double-charge idempotency

Canonical scope and acceptance criteria: [docs/50 — retry idempotency](50-public-distribution.md#technical-debt-retry-idempotency-owner-explicitly-deferred).
