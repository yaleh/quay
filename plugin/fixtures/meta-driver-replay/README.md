# meta-driver offline replay corpus (v1)

Implements `tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md`. Four real,
human-driven architectural decisions (GOAL-030/031/032/033) turned into decision-replay cases
for offline evaluation of meta-driver (or any candidate "architecture concern triage" system):
given only what was knowable before the human's decision, can a candidate recover a comparable
decision?

## Layout (mirrors the existing `plugin/fixtures/workflow-replay/<scenario>/` convention)

```
GOAL-030/{input.json, reference.json, outcome.json}
GOAL-031/{input.json, reference.json, outcome.json}
GOAL-032/{input.json, reference.json, outcome.json}
GOAL-033/{input.json, reference.json, outcome.json}
```

- **`input.json`** — everything knowable strictly before the real decision (`cutoff`), plus the
  8-question decision prompt/schema. This is the ONLY file the default eval path reads.
- **`reference.json`** — the real human decision, structured into 8 fields (selected concern,
  selected slice, why now, why not others, risk, scope discipline, acceptance evidence,
  stop/abandon condition), plus `leakage_markers` — exact strings that must never appear in that
  case's `input.json`.
- **`outcome.json`** — real post-execution mechanical readings (merge commit sha, AC results,
  ArchGuard before/after). GOAL-033 is honestly marked `"status": "in-progress"` — it had not
  merged as of this corpus's creation, and this file does not fabricate a completed result.

## Running an eval

```
node plugin/test/helpers/meta-driver-replay-harness.mjs --case GOAL-030 --print-prompt
# ...hand the printed prompt to a candidate system, save its JSON answer to a file, then:
node plugin/test/helpers/meta-driver-replay-harness.mjs --case GOAL-030 --response /path/to/answer.json --score
```

An optional `--auto <cmd>` mode can shell out to a locally-configured LLM CLI to generate the
response automatically, but this is never required — the default path and the integrity test
suite (`plugin/test/meta-driver-replay-corpus.test.mjs`) never depend on any external model call.

## What this is NOT (read before extending or citing this corpus)

- **Not a validated statistical benchmark.** Four samples, one domain (ownership-first
  architecture refactors), all from one project's recent history. A candidate system scoring
  well here says nothing calibrated about general architectural judgment.
- **Not to be over-fit as universal truth.** The `reference.json` decisions are real and good
  historical samples, not a definition of "correct" that should be mechanically enforced as a
  production gate.
- **Future extensions this v1 deliberately does not attempt**: non-architectural human decisions
  (process/methodology rulings, not code-ownership slices), and deliberately-wrong or
  ambiguous-ground-truth negative examples (this v1 is 4 "good decision, mostly landed cleanly"
  samples — it has no case where the human's own decision was later reversed or judged wrong).
