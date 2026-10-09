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
  9-question decision prompt/schema (questions a-h, plus a dedicated decomposition question i —
  see "Decomposition quality" below). This is the ONLY file the default eval path reads.
- **`reference.json`** — the real human decision, structured into 8 fields (selected concern,
  selected slice, why now, why not others, risk, scope discipline, acceptance evidence,
  stop/abandon condition), a `granularity_rationale` block (why THIS slice is the
  minimal-sufficient granularity, not a bigger or smaller one — see below), plus
  `leakage_markers` — exact strings that must never appear in that case's `input.json`.
- **`outcome.json`** — real post-execution mechanical readings (merge commit sha, AC results,
  ArchGuard before/after). GOAL-033 is honestly marked `"status": "in-progress"` — it had not
  merged as of this corpus's creation, and this file does not fabricate a completed result.

## Decomposition quality — what this corpus is really testing

Recovering the final slice a human chose is NOT the point of this corpus — the point is whether
a candidate can **decompose** an open-ended architecture concern the way the real decision did:
compress it into a small number of semantically coherent slices, pick the minimal-SUFFICIENT
granularity (not a mechanical micro-fragment, not a whole-subsystem rewrite), tell which
sub-problems are already checkable by an existing instrument/harness versus which still need
investigation, name the stable mechanisms it's reusing rather than reinventing, and reason about
coordination cost rather than splitting further for no reason.

Question (i) in `decision_prompt_schema` asks for this explicitly, and `response_schema` requires
a `decomposition_rationale` object (`granularity_assessment`, `why_not_broader`, `why_not_finer`,
`harnessable_subproblems`, `investigation_required_subproblems`, `primitives_reused`,
`coordination_cost_note`). Every `reference.json`'s `granularity_rationale` answers the same
structure for the real historical decision, so a candidate's decomposition reasoning can be
compared against it, not just its final pick.

`scoreResponse` reports (all rule-assisted, deliberately NOT folded into one pretend-precise
score — see "Evaluation is deliberately weak" below):

- `decomposition_quality` — structured-field coverage + text-overlap against the reference's
  `why_not_broader`/`why_not_finer` reasoning.
- `slice_semantic_coherence` — a crude heuristic (counts "and also"/"as well as"/`;` joins in the
  recommended text) flagging a possibly-bundled, non-coherent slice. Weak signal, not a semantic
  check.
- `granularity` — exact-match comparison of the candidate's self-assessed
  `too-broad`/`sufficient`/`too-fragmented` against the reference's `granularity_label`.
- `harnessability` / `harnessability_components` — whether the candidate's own answer gives
  enough to actually build a harness from (non-goals, a negative control, a numeric expected
  delta) — this metric itself reuses the pre-existing per-field presence checks rather than
  inventing a new "harnessability" detector, which is the harness practicing the same
  primitive-reuse discipline it's scoring for.
- `primitive_reuse` — whether the candidate named any reused mechanism at all, and how much it
  overlaps the reference's own `primitives_reused` list.
- `unnecessary_decomposition_flag` — fires when a narrow in-scope slice is proposed with no
  coordination-cost or why-not-finer reasoning at all (a cheap, not a semantic, check).

## Running an eval

```
node plugin/test/helpers/meta-driver-replay-harness.mjs --case GOAL-030 --print-prompt
# ...hand the printed prompt to a candidate system, save its JSON answer to a file, then:
node plugin/test/helpers/meta-driver-replay-harness.mjs --case GOAL-030 --response /path/to/answer.json --score
```

There is no `--auto` / automatic-LLM-call mode implemented in this v1 — filling in a response is
always a manual step. The default path and the integrity test suite
(`plugin/test/meta-driver-replay-corpus.test.mjs`) never depend on any external model call.

## Evaluation is deliberately weak (do not over-read any single metric)

Every `scoreResponse` field is a rule-assisted heuristic (keyword/token overlap, presence/length
thresholds, exact-match on a self-reported category) pinned against known-true and known-false
hand-written samples in the test suite — not a learned or calibrated model of "good
architectural judgment." A high score on one case says nothing about a candidate's general
decomposition ability; see "What this is NOT" below.

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
