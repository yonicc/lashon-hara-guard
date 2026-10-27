# Multilingual dataset expansion v1 (2026-10-27)

Added 210 synthetic rows in 40 semantic families: 30 concern/benign contrast
families (six rows each) and 10 ambiguous families (three rows each).
Each language has 30 concern, 30 no_concern and 10 ambiguous rows.
Together with Phase A, the multilingual development pool now has 345 rows
(115 per language). The older 297-row Hebrew regression set remains separate.

Coverage includes indirect rumors, sarcasm, exclusion, private information,
safety/help-seeking, workplace/school reporting, product complaints, sincere
praise, negation, quotation, fiction, technical vocabulary, self-reference,
spelling noise, emoji and missing context. The examples are authored
individually; no combinatorial name/template multiplication is counted.

## Files and reproduction

- classifier/data/multilingual_expansion_v1.jsonl: canonical examples.
- classifier/validate_expansion.py: offline validation and review export.
- classifier/results/multilingual_expansion_v1_audit.json: counts and SHA-256.
- classifier/results/multilingual_expansion_v1_review.csv: human review queue.
- .claude/skills/lhg-gate-evaluation/SKILL.md: reusable evaluation procedure.

Run from the repository root on BI-1:

```powershell
py classifier/validate_expansion.py
```

Validation passed: unique IDs/texts, three-language coverage per family and
label, recognized provisional labels, single split per family, no replacement
characters, and no normalized exact overlap with the two training files,
Phase A or eval_codex_v2. Semantic similarity remains possible and requires
review. CSV output is UTF-8 with BOM for spreadsheet compatibility.

## Review and split policy

All 210 rows remain human_review_pending and development_candidate; none are
automatically selected for training or designated a final holdout. Reviewers
fill reviewer_label, reviewer and review_notes; preserve original gold as
provenance and resolve disagreements explicitly. Treat translated and
contrast siblings together, including when assigning future splits. Shared
failure categories mean this is development material, not independent proof
of improvement. Create a fresh independently reviewed final test set before
judging a new trained model.

Gold is a provisional linguistic routing judgment, not a religious/legal
verdict. Protective reporting and requests for help must remain supported.
No model scoring, model training, threshold adjustment, live application
change or paid Modal work was performed for this expansion.
