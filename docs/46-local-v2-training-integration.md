# Local v2 training and integration — supervisor
Started 2026-10-28 UTC. Worktree: integration/local-v2-20261029, based on origin/main 967c3db.
Data source: research/data-expansion-v2-20261028-215713 through 360c01d.
Runtime sources: memory 6ee8de2, Ollama b474ac9 + setup 49a6a3f. UI already released in 0.11.3.

## Verified before launch
- test_v2_pipeline.py: deterministic source; rerun byte-identical; no reported family/unit/text/evidence overlap.
- validate_v2.py: zero structural errors, 6151 train / 999 dev / 1124 holdout.
- Router concatenation: 19198 rows / 8687 families, sha256 170f5b6509a0b8ba549057e4047506060f3a5f4e660269910159855e27828857.
- All data synthetic; no human review. Development evaluation only; no independent 18-fact benchmark.
- Integrated extension tests: 181/181 passed. Remaining engine/proxy/browser checks pending.

## Launched by supervisor, not data child
Modal profile yonicc, detached. No serving endpoints changed.
- Extractor Qwen2.5-7B, tag e10-v2-7b-20261029-supervisor, app ap-PPWIUBBMo7HxtjPYFqCd5L.
- Router xlmr/e5s/e5lr, tag r3-20261029-supervisor, app ap-SdOn8nKGNzf413IEjFXNV4.
- Host launchers D:\lhg-v2-training-20261029.ps1 and D:\lhg-v3-router-training-20261029.ps1; logs D:\lhg-v2-extractor-20261029.log and D:\lhg-v3-router-20261029.log.
- Bound: extractor one H100 function <=7200s; router three A10G functions <=3600s each. Estimated GPU ceiling under $15 for this launch, not an invoice; monitor exact app IDs and stop if repeated startup failures or unbounded restarts.
- Preserve tag/input hashes; checkpoint every 100 extractor steps. No automatic relaunch. Results pending.
- Runtime still rejects scoreless extractor candidates via canonical factPolicy; training does not resolve confidence admission or add meaning assessment.
- No merge to main, release or live-model inference verified yet.
