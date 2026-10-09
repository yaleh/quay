# Ownership shadow proposer — offline contract + deterministic gate + replay over GOAL-030..033

Task: `tasks/gap-ownership-shadow-proposer-contract-and-replay.md`.

This records the offline half of the "specialized proposer + deterministic policy + sandbox carrier"
experiment: a project-local proposer contract (`docs/analysis/ownership-shadow-proposer.mjs`), a pure
deterministic gate, and a replay over the real `plugin/fixtures/meta-driver-replay/` corpus
(`docs/analysis/ownership-shadow-replay.mjs` → `docs/analysis/ownership-shadow-replay.results.json`).

**Scope of this task, stated up front:** no live shadow is registered, no work item or goal branch is
created or activated, no lifecycle status is written, and `plugin/scripts/meta-driver.ts` is not
touched. The proposer's only write surface is the gitignored sandbox carrier
`.quay/ownership-shadow-proposals.jsonl`.

## What was built

| piece | file | what it is |
|---|---|---|
| proposer + gate | `docs/analysis/ownership-shadow-proposer.mjs` | `propose(evidence) -> envelope` (fixed 10-field envelope) + `deterministicGate(envelope, opts)` (pure, no model) |
| replay runner | `docs/analysis/ownership-shadow-replay.mjs` | per-case `buildDefaultPrompt` → envelope → gate → `scoreResponse` → aggregate |
| results | `docs/analysis/ownership-shadow-replay.results.json` | per-case + aggregate readings (byte-reproducible: no timestamps) |
| tests | `plugin/test/ownership-shadow-proposer.test.mjs` | the contract, the four rejection arms, the accept arm, the CLI end-to-end, the anti-leak control |

Reuse, not reinvent: scoring is the existing harness (`scoreResponse`), the default prompt is the
existing `buildDefaultPrompt` (input-only path), and the gate's dedup key is the same shape as
`routine-file-gate.ts`'s concern key. There is deliberately **no second evaluator**.

Reproduce (identical output — the results file carries no timestamp):

```
node docs/analysis/ownership-shadow-replay.mjs --out docs/analysis/ownership-shadow-replay.results.json
```

## The deterministic gate

`deterministicGate` is a pure function. It checks, in order: schema completeness →
forbidden-action scan of the **actionable surface** (`recommended_next_action` plus the intervention
titles/rationales and `scope.in_scope`; `scope.non_goals` is the explicitly-not-doing surface and is
excluded) → concern-class membership in the ownership domain → `evidence_refs` resolvability against
the supplied evidence universe → the ≤3 intervention cap → dedup by normalized concern key.

Two design points that the tests pin:

- **The four refusal causes do not share an output shape** (硬规则 3b). `schema_incomplete`,
  `evidence_ref_unresolvable`, `scope_out_of_bounds` and `forbidden_action` are four codes with four
  distinct reasons, asserted pairwise-distinct. In particular, a *missing* `recommended_next_action`
  (schema) and a *present-but-outside-the-enum* one (forbidden action) are different codes on purpose.
- **"Could not evaluate" is its own value.** With no evidence universe supplied, the gate returns
  `not-evaluated` — it does not silently accept, and it does not share a value with `accepted`.

## Replay readings (the real corpus, deterministic stub proposer)

`summary` from `results.json`:

| case | derived concern class | concern_recall | concern_precision | slice agreement | inv-vs-goal agrees | scope violation | harnessability | hindsight leak |
|---|---|---|---|---|---|---|---|---|
| GOAL-030 | ownership-placement | 1 | 1.00 | no_match (0.235) | yes | no | harness_ready | no |
| GOAL-031 | canonicalization | 1 | 1.00 | near_match (0.326) | yes | no | harness_ready | no |
| GOAL-032 | duplication | 0 | 0.00 | no_match (0.186) | yes | no | harness_ready | no |
| GOAL-033 | dependency-boundary | 1 | 1.00 | no_match (0.140) | yes | no | harness_ready | no |

Gate: **4/4 accepted** (`gate_code_counts: {accepted: 4}`). Aggregate: `concern_recall_mean 0.75`,
`concern_precision_mean 0.75`, `harnessability_ready 4/4`, `negative_control_present 4/4`,
`expected_delta_numeric 4/4`, `granularity_agreement 4/4`, `scope_expansion_violation 0/4`,
`hindsight_leakage_flagged 0/4`, `chosen_slice_near_match 1/4`.

## What these numbers do and do not measure

**They do NOT measure proposer judgment.** The stub's `concern.statement` is an *extract* of the
evidence (the case's mechanical summary + the reading text) — it summarizes, it does not reason. So
`concern_recall` reads whether **the corpus's own readings localize the concern class**, not whether
a proposer understands it. Two consequences worth stating plainly rather than hiding:

1. **The single miss (GOAL-032) is a lexical artifact, not a classification error.** The stub derived
   the correct class (`duplication` — the reading is `detect_duplicates`), but the token overlap
   between its evidence-extract statement and the reference concern fell to 0.186, under the harness's
   declared 0.25 rule-of-thumb threshold. The harness metrics are, by their own README, rule-assisted
   heuristics — this case is the concrete demonstration of that.
2. **`harnessability 4/4`, `negative_control 4/4` and `numeric delta 4/4` are near-construction
   invariants.** The envelope schema *requires* non-empty `scope.non_goals`, a `negative_control`
   field and a numeric `expected_mechanical_delta`, and the stub fills them. These readings validate
   the **contract's completeness** (an envelope that reaches the gate is already harness-shaped), not
   the quality of any judgment behind it.

**`chosen_slice_agreement 1/4` is expected and is not a defect.** The corpus README says recovering
the final slice is not the point; moreover the reference slices name exactly the strings the corpus
declares as hindsight markers (e.g. `task-transition.ts`, `verdict-parse.ts`), which by construction
cannot appear in the pre-cutoff input. A proposer scoring well on slice agreement here would be
evidence of leakage, not skill.

**Real negative controls that could have failed and did not:** `scope_expansion_violation 0/4` and
`hindsight_leakage_flagged 0/4`. The latter is not left to this run — the test suite asserts, per
case, that the stub's envelope contains none of that case's `leakage_markers`, so a future change
that made the proposer read `reference.json` would go red.

## Boundary declaration (read before citing this)

- **4 cases, one domain.** All four are "good decision, landed cleanly" ownership-first refactors from
  one project's recent history. There is no negative ground truth (no case where the human's decision
  was later reversed), no second domain, and no sample of a *model-backed* proposer.
- **n = 4 is not a benchmark.** With a 0.25 overlap threshold, 3/4 recall has a confidence interval
  wide enough to be consistent with almost anything. Nothing here licenses a claim that the proposer
  "generalizes".
- **The stub is not the proposal mechanism.** The replay proves the plumbing (contract, gate, metric
  wiring, sandbox containment, determinism, anti-leak) works end-to-end over real data. It does not
  prove a specialized proposer would beat a monolithic meta-driver — that comparison needs a candidate
  whose judgment is not a transcription of the evidence.

## Verdict: worth entering a *limited-proposal* stage? — conditional yes, as a shadow only

**Recommendation (a judgment with its basis, not an automatic advance):**

Proceed to a limited-proposal stage, **but only** with all three of these properties, and re-evaluate
before widening:

1. **Shadow only, no authority.** The proposer may append envelopes to the gitignored sandbox
   carrier; it may not create a task, activate a goal, or write status. The gate already enforces the
   forbidden-action arm, and the sandbox containment is proof-carrying (the test asserts the import
   graph reaches only `node:` builtins and that the source names no work-item/goal write surface).
2. **A pre-registered exit criterion.** Before the stage starts, name the reading that would stop it:
   e.g. after N real rounds, count the sandbox proposals a human judges *in-domain and actionable*;
   if that count is not distinguishable from the deterministic stub's baseline (which this replay
   establishes), stop — do not keep running a shadow that produces the same proposals a grep would.
3. **Keep the replay as the regression harness.** Any change to the proposer or the gate must re-run
   `node docs/analysis/ownership-shadow-replay.mjs --out ...` and be compared before/after — it is
   cheap, deterministic, and byte-reproducible.

**Evidence for:** the contract plus gate are cheap, pure, and structurally sandboxed; the cost of a
shadow is bounded to one gitignored JSONL; and on real envelopes the gate neither always-accepts nor
always-rejects (it accepts all 4 valid ones and rejects all 4 planted bad ones with distinct causes).

**Evidence against over-reading this as validation:** the corpus is 4 single-domain cases; the stub is
not a model; and the one metric that could genuinely fail (concern_recall) is confounded with lexical
overlap, as the GOAL-032 miss shows. A limited-proposal stage is therefore justified as **mechanism
validation with a stop condition**, not as evidence that the proposer's decisions are good.

## Explicit non-goals (unchanged from the task)

No live shadow registration, no automatic activation, no writes to any non-sandbox carrier, no
`meta-driver.ts` change, no new driver kind, no task/goal/AC creation.
