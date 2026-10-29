# Independent LHG evaluation — Set A and Set B

The original sections below describe Set A (explicit/definitional). Set B and the joint validation procedure are documented at the end. Set A's two JSONL files are unchanged.

Status: **synthetic, generator-labelled, not human-reviewed**.
Created 2026-10-29 by the current Codex chat, independently of the Qwen2.5-32B / DictaLM / muse-spark training generators.
Generation and structural validation only: no training, evaluation, inference, model predictions, release, commit or push.

## Files and blind handoff

- `messages.jsonl`: 400 objects with exactly `id`, `lang`, `text`. This is the ONLY input to give a blind annotator.
- `sealed/gold_generator.jsonl`: author labels, keyed by the same IDs; do not give this file to the blind annotator.
- `validate.py`: standard-library validator. Run `py D:\lhg-independent-eval\validate.py`.
- `validation_report.json`: aggregate structural results and hashes; no message-level labels.

The sealed directory is a procedural separation, not encryption or an ACL. No labels were sent to another chat. No project files were edited.

## Method and limits

Only the project/host instructions, docs/37, docs/46, docs/35-local-router-evaluation.md and the two extractor contracts plus router labels were read. No training/dev/holdout files, existing evaluation examples, natural-data files, or generator templates were opened. Documentation contains historical aggregate metrics; no predictions were used in generation.

All messages were authored directly in their declared language by this chat. They are not translations of one another. They contain invented role descriptions, not names of real private people, phone numbers or addresses. Examples include informal chat, workplace email phrasing, colloquialisms, oral/written distinctions, mockery, indirect criticism, incomplete replies, neutral logistics, questions, conditionals and quoted fictional speech.

216 messages deliberately cover two specified fact polarities, with additional explicit facts labelled where present. The other 184 have no stated extractor facts; these include neutral messages, context-dependent criticism and hard near-misses. This deliberate balance creates correlated fact combinations and repeated kinds of scenario; the sample is not an estimate of production prevalence, and messages are not guaranteed semantically independent. It must remain evaluation-only. Once used for tuning or selecting data fixes, it becomes development data.

Message order was shuffled with a fixed author-side LCG seed 20261029 before assigning sequential opaque IDs. No fact, language or router label is encoded in the ID.

Each fact is `alias: [boolean, exact evidence quote]`. Evidence is the complete short message, which contains the supporting clause verbatim; spans are valid but not minimal. Missing facts are omitted, never set false by default. Gold is the author's interpretation, not adjudicated truth.

## Counts

| Language | Messages | Share |
|---|---:|---:|
| he | 180 | 45% |
| en | 160 | 40% |
| mixed | 60 | 15% |
| Total | 400 | 100% |

| Router decision | Messages |
|---|---:|
| none (empty heads) | 142 |
| mem_recent | 63 |
| mem_search | 135 |
| ask_user | 60 |

Heads are multilabel; counts sum to 400 here because this version uses single-head or none decisions. This is a limitation: combined-head routing is not tested.

| Fact alias | true | false |
|---|---:|---:|
| purpose | 23 | 24 |
| intent | 14 | 12 |
| revenge | 12 | 12 |
| firsthand | 12 | 24 |
| verified | 12 | 12 |
| rebuke | 12 | 12 |
| rejects | 12 | 12 |
| no_alternative | 12 | 12 |
| said_in_jest | 12 | 12 |
| is_hint | 12 | 12 |
| medium_written | 13 | 12 |
| same_self_disparagement | 12 | 12 |
| unverified_rumor | 12 | 12 |
| second_source | 12 | 12 |
| future_purpose | 12 | 12 |
| requested_disclosure | 12 | 12 |
| repeats_prior | 24 | 12 |
| subject_self_disclosed | 12 | 12 |

184 messages have an empty facts_v2 object. Every alias has at least 12 examples of EACH Boolean value.

## Contract interpretation decisions

- v2's first eight fact triples match v1 exactly: aliases, canonical IDs and descriptions. Thus facts_v1 is the exact eight-alias projection of facts_v2, preserving values and quotes.
- Router output is `{"heads": [...]}`, using only the three IDs in labels.json. `none` is `[]`, not an extra learned head. The definitions do not require a separate input context field; no invented memory or userNote was supplied.
- Recent replies, pronoun references and tone dependent on the immediately preceding exchange route to mem_recent. Named past incidents, old discussions, rumour/publicity and earlier disclosure route to mem_search. Explicit requests for help/resolution and relationship-dependent disclosure route to ask_user. A known nonconstructive intent does not, by itself, trigger a purpose question.
- Router definitions are broad and partly subjective: a relationship or purpose may matter even when partly stated. These labels describe a textual need for context, not proof that stored memory can answer it. Reviewers may reasonably disagree about marginal ask_user cases.
- medium_written is not inferred merely because the input is text. It is labelled only when the writer explicitly describes delivery of THIS criticism; an explicitly oral-only planned remark is false.
- Knowing an event firsthand does not establish verification. Acknowledged hearsay establishes firsthand=false when the writer explicitly describes their source; not every mention of a rumour does.
- A second-source confirmation is not treated as the writer having independently checked the facts. Subject disclosure to three or more requires an explicit listener count; an unsized group remains unknown.
- Writer intent is not copied from fictional quoted speech. Questions, hypotheticals, uncertainty and background text do not establish Boolean facts.
- Neither a constructive purpose nor any other fact is a religious verdict. This set evaluates narrow extraction and context routing only.

## Validation

The validator reads only these two new JSONL files. It checks strict JSON (including duplicate keys), exact allowed fields, 400 unique matching IDs, language-script consistency, Boolean pair shape, allowed aliases, nonempty verbatim evidence, exact v1 projection, router IDs, per-value and per-head counts, and normalized exact duplicates.

Near-duplicate screening uses Unicode NFKC/lowercase/alphanumeric normalization, token-set Jaccard >=0.65 OR character SequenceMatcher ratio >=0.88. No candidates were found. This operational lexical check does not prove absence of paraphrases or repeated semantic families; no embedding/model calls were made. There was no comparison with forbidden training files.

SHA-256:
- messages.jsonl: `9687f1717b8a7bb376f05c0de265d59e07ef110828fe678dfb278127ed714034`
- sealed/gold_generator.jsonl: `d0bf27e9f0d43fed4cec87a09e74af173b77e9767b549090b638121bc6819568`

All structural checks passed; 0 normalized duplicates and 0 lexical near-duplicate candidates.

## Set B — natural chat and email scenarios (2026-10-29)

Status: **synthetic, generator-labelled, not human-reviewed**.

Set A remains the original **explicit/definitional** set. Both original JSONL files are byte-identical to the recorded Set A hashes. The earlier method/count sections describe Set A only.

### Set B files and blind handoff

- `setB/messages.jsonl`: 300 messages, exactly `id`, `lang`, `text`; IDs begin `lhg-indB-`.
- `sealed/setB_gold_generator.jsonl`: exact matching IDs, `facts_v2`, exact `facts_v1` projection, and `router` as a list of head IDs. None is the empty list. Unlike Set A's legacy wrapper, there is no `heads` object around this list.
- `sealed/setB_author_audit.json`: author annotation of which zero-fact messages contain criticism. Do not give it to a blind annotator.
- `setB/validation_report.json`: counts, hashes and lexical checks.
- `validation_b.py`: standard-library extension called by `validate.py`. Run both sets with `py D:\lhg-independent-eval\validate.py`.

A blind second annotator receives **only setB/messages.jsonl**. No author labels were shared with any other chat.

### Method and interpretation

Written directly by this chat in Hebrew, English and mixed language; no training/dev/holdout/natural-data files or generator templates were opened. No model, embedding, inference, training, evaluation, Git commit or push was run. Only the contracts, router definitions, requested documentation, instructions and independent-set infrastructure were used. Set A message text was read programmatically for overlap checking.

Messages use synthetic role descriptions in parent groups, workplaces, households, tenancy, neighbourhood committees, matches and community activities. No real private names, phone numbers or addresses are used. Replies, quoted third-party motives, forwarded statements, conditions, questions, unsized groups and “everyone knows” are included as distractors. Recent conversational hooks remain part of the message text; no extra input/context fields are present.

Evidence spans support the writer's statements, not real-world truth. Direct quotation of another person's motive or claimed checking is not inherited by the writer. Questions and conditions remain unknown. Publicity and an unsized group do not establish an unverified rumour or a three-person disclosure. An independent eyewitness account does not automatically establish verification; self-originating narrative does not automatically establish eyewitness status. Writing is labelled only where delivery of this criticism is explicitly stated. Short evidence spans replace Set A's whole-message spans.

Router labels follow the same broad, partly subjective definitions: immediate answers/references use mem_recent; older discussions, specific underspecified events and prior/public reports use mem_search; help/relationship/purpose-dependent cases use ask_user. Multiple heads can coexist. Fully stated descriptions need not trigger memory simply because they describe a past event. These are author labels, pending independent and human review.

### Coverage

| Language | Messages | Share |
|---|---:|---:|
| he | 135 | 45% |
| en | 120 | 40% |
| mixed | 45 | 15% |

| Router head | Messages |
|---|---:|
| none (empty list) | 70 |
| mem_recent | 100 |
| mem_search | 124 |
| ask_user | 85 |

72 messages require multiple heads, so head counts are not mutually exclusive.

| Fact alias | true | false |
|---|---:|---:|
| purpose | 11 | 11 |
| intent | 8 | 14 |
| revenge | 9 | 11 |
| firsthand | 12 | 10 |
| verified | 11 | 12 |
| rebuke | 13 | 10 |
| rejects | 10 | 12 |
| no_alternative | 10 | 10 |
| said_in_jest | 11 | 11 |
| is_hint | 10 | 12 |
| medium_written | 11 | 11 |
| same_self_disparagement | 11 | 9 |
| unverified_rumor | 10 | 10 |
| second_source | 10 | 11 |
| future_purpose | 13 | 9 |
| requested_disclosure | 12 | 9 |
| repeats_prior | 11 | 10 |
| subject_self_disclosed | 11 | 10 |

| Explicit facts per message | Messages | Share |
|---|---:|---:|
| 0 | 120 | 40.00% |
| 1 | 12 | 4.00% |
| 2 | 142 | 47.33% |
| 3 | 14 | 4.67% |
| 4 | 12 | 4.00% |

All 120 zero-fact messages contain negative talk about a person according to the author's annotation (40% of Set B, above the requested 35%). The validator checks that these annotated IDs exist, have no extractor facts, and meet the quota; it does not independently judge negativity.

### Validation and limitations

The single entry point checks both sets' JSON, unique IDs, strict fields, verbatim evidence, exact v1 projection, fact/value/language/head counts, and unchanged Set A hashes. Set B also checks 1–5 orthographic sentences and 0–4 facts per message. The old Set A router wrapper and new Set B list are validated separately.

Near-duplicate screening uses normalized token-set Jaccard >=0.65 OR character SequenceMatcher >=0.88, exhaustively within B and between B and A, in addition to the original A/A check. There are **zero candidates**. This is a lexical screen, not proof of semantic uniqueness.

Contract overlap uses every consecutive four-word window in each fact description (`facts[][2]`) in both v1 and v2 contracts, after Unicode NFKC/casefold/alphanumeric tokenization. Any exact run of four or more words necessarily contains such a window. Results: **Set B: 0 messages; Set A: 5 messages**. Set A is preserved. The test detects literal overlap, not close paraphrases or translated definitions; zero is not a naturalness score.

Coverage was deliberately planned, with varying partners rather than fixed fact pairs: every alias co-occurs with 16 or 17 different other aliases. This does not make combinations random or production-representative. Most labelled messages still contain two facts; rare negative polarities inherently need explicit speaker wording. Topic repetition and author style remain possible. Human naturalness and completeness review is still needed before relying on this set for a replacement decision.

Durable methodological limitation recorded here: lexical de-duplication and zero definition n-grams cannot establish naturalness or independence of semantic families. Reusing a set after it guides tuning makes it development data.

SHA-256:
- `setB/messages.jsonl`: `b1db40e4d7233c417bcb360cbf9142d7b297732d714b963b2ca99b88634e2029`
- `sealed/setB_gold_generator.jsonl`: `e05b7d093b0968d6e08df3c6da2f43ad1d4355c66cba132bddb8ed9937107dc0`

