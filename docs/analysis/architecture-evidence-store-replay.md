# Architecture evidence store + decision memory — phase A+B of the end-to-end architecture self-bootstrap

Task: `gap-architecture-evidence-store-and-decision-memory`. Raw data: `architecture-evidence-store-replay-results.json`.
Code: `architecture-{evidence-store,decision-memory,metrics}.mjs` + the wiring in `ownership-active-loop.mjs`.
Tests: `plugin/test/architecture-evidence-store.test.mjs` (13) + `architecture-decision-memory.test.mjs` (12) +
`architecture-metrics.test.mjs` (12) + the extended `ownership-active-loop.test.mjs` (53).

## 0. Why this task exists

`gap-ownership-active-investigation-loop-shadow` (done) proved the *mechanism* prerequisites are met, and its own
DoD recorded that the **evidence** prerequisites are not. Two of the three recorded gaps are this task's scope:

1. **No decision memory.** A production live shadow run re-proposed canonicalising
   `packages/quay-github/src/github-client.ts` status literals — an item `gap-abi-status-lifecycle-vocab-scattered-no-named-type`
   (AC2) had **explicitly exempted** (`docs/analysis/ownership-active-replay.md` §3).
2. **No quantitative reading.** The loop recorded exactly one terminal object per run (a proposal envelope) and
   nothing that separates *evidence* from *hypothesis* from *experiment* from *outcome*, and no measure of
   discovery quality, evidence cost, false positives, locality or recovery.

The third recorded gap — production live runs producing no computed slice (0/3) — is **not** closed here, and §6
reports where this task's own runs land on it. This task writes only to shadow carriers: no Goal and no task is
created, activated or steered.

## 1. What was built

| module | role | purity |
|---|---|---|
| `architecture-evidence-store.mjs` | four record kinds (`evidence` / `hypothesis` / `experiment` / `outcome`) with fail-closed field validation; the only sink is append-only `.quay/architecture-evidence-store.jsonl` | one append site + one `mkdir` site; the rest is pure |
| `architecture-decision-memory.mjs` | `isKnownExemption(candidate)` over a source-cited seed list; returns a **status enum** (`exempted` / `known-not-yet-filed` / `not-known`) + the matched entry | pure (classifies only; no write surface) |
| `architecture-metrics.mjs` | `computeRunMetrics(runRecord, holdoutGroundTruth?)` → `{evidenceCost, falsePositiveRate, locality, recoveryRounds}` | pure arithmetic + path sets |

`ownership-active-loop.mjs` consults the memory **before** a terminal proposal becomes an envelope, and projects each
run onto the four record kinds. The old proposal carrier is untouched and still written — the two carriers coexist,
so the existing `ownership-shadow-proposer.mjs` consumption chain keeps working.

Three decisions worth naming, because each one is a place where a weaker implementation would have looked fine:

- **Fail-closed, no defaulting (硬规则 3b).** A record missing a required field is refused with a *distinct* reason
  code (`SCHEMA_MISSING:ref` vs `FIELD_INVALID:tool` vs `EVIDENCE_LOCATION_MISSING:…`) and nothing is appended.
  "I could not write a valid record" cannot be shaped like "I wrote one".
- **`not-evaluated` is a shape, not an absence (硬规则 6).** A production run has no ground truth, so
  `falsePositiveRate` / `locality` / `recoveryRounds` come back as exactly `{state:"not-evaluated"}`. A `0` there
  would read as *measured, and it was perfect* — the most dangerous available lie.
- **Matching is by LOCATION, not by keyword (硬规则 2).** A candidate matches a decision-memory entry only when the
  entry's registered file path is, byte-for-byte, one of the candidate's structurally extracted file locations
  (declared `files`, a `scope.in_scope` entry, a slice move, or a complete repo-path token in the proposal's own
  subject strings). Prose that merely *talks about* the exempted item matches nothing — asserted as a test.

## 2. Holdout A — 25 recorded GOAL-032/033 replays, with ground truth (AC3)

Ground truth = the files the goal's **real merge commit** changed (`git diff <merge>^1 <merge>`: GOAL-032 `0da918926`,
GOAL-033 `ddb9c6ac0`); `slice_files` = the source modules the accepted slice actually moved. This is the only corpus
in this task allowed to have a known answer, and its purpose is exactly to show whether the decision memory blocks
the old misjudgment — so its answers are legitimately in hand.

| reading | value |
|---|---|
| evidence cost (25 runs) | **172 rounds · 140 tool requests · 647,717 bytes** |
| `falsePositiveRate` | **0.40** (10 of 25 runs proposed a change that touches none of the goal's real slice files) |
| `locality` (mean) | **0.362** — of everything a run laid hands on, ~36% sat inside the goal's real change set |
| `recoveryRounds` | **13 of 25** runs recovered (first touched the goal's real change set); summed rounds 121 |

All 25 outcome records read back with all four readings `{state:"evaluated"}` — none `not-evaluated`, because ground
truth exists. `locality` is 0 for 12 runs: those runs never read or proposed a file inside the goal's change set at
all (a 0 that is a real reading, not an absence — distinguishable from `{state:"not-evaluated"}`).

## 3. Holdout B — 3 blind runs at the GOAL-034/035/036 fork points (AC4)

**Blinding is mechanism-enforced, not discipline.** For each fork point a tree is built with
`git archive <fork-commit>`, and then `goals/`, `tasks/`, `experiments/`, `docs/analysis/`, `docs/architecture/`,
`.quay/`, `.archguard/`, `.claude/` and `CLAUDE.md` are **deleted before `git init` + commit**. The investigator's
executor reads `git show <commit>:<path>`, so a path that is not in that commit is not merely denied at the gate — it
**does not exist**. Nothing that states the answer is reachable.

| run | fork point | terminal | action | cost | proposed subject |
|---|---|---|---|---|---|
| `holdoutB:GOAL-034@162f8c380ed1` | `162f8c380` | propose_slice | investigate | 7 rounds · 6 requests · 22,317 B | `packages/quay/src/gate/config/loader.ts` |
| `holdoutB:GOAL-035@1b87254733ca` | `1b8725473` | propose_slice | investigate | 7 rounds · 6 requests · 20,543 B | `gate/acceptance-runner.ts`, `gate/types.ts` |
| `holdoutB:GOAL-036@8cb36c2fd946` | `8cb36c2fd` | propose_slice | propose-goal | 8 rounds · 6 requests · 8,236 B | `packages/quay/src/gate/config/loader.ts` |

`GOAL-034@…`'s first attempt ended `not-evaluated(judge-unavailable)` (launcher churn — the same failure class the
earlier replay doc records as exit 127); it was re-run and the re-run is what is recorded. A `not-evaluated` run is
not an abstain and is never counted as a sample.

**What the blind runs show.** All three independently converged on the same real object: the 4-member gate package
cycle (`src` ⇄ `src/gate` ⇄ `src/gate/config` ⇄ `src/gate/factories`) and the `gate/config/loader.ts` upward import
that holds it together. This reproduces, blind, the same cut the original live shadow runs proposed and the same
cycle the production rounds in §4 propose. It also confirms the recorded limit: the loop is **not** stable on the
*other* goal concerns (GOAL-035 was about the needs-human terminal transition, GOAL-036 about the in-flight
exclusion set — neither is a package cycle, and neither was proposed; the cycle is what the instrument can measure).

### Anti-cheat isolation (AC4)

The check is run as an actual `jq` intersection over the carrier:

```
jq -s 'map(select(.kind=="outcome")) as $all
     | ($all|map(select(.run_id|startswith("holdoutB:")))|map(.id)) as $b
     | ($all|map(select(.run_id|startswith("holdoutA:")))|map(.id)) as $a
     | {b_count:($b|length), a_count:($a|length), b_cap_a: ($b - ($b - $a)),
        b_cap_a_len: (($b - ($b - $a))|length), disjoint: ((($b - ($b - $a))|length)==0)}'
```

→ `{"b_count":3,"a_count":25,"b_cap_a":[],"b_cap_a_len":0,"disjoint":true}`. The record-id sets are pairwise
disjoint: Holdout B (3) ∩ Holdout A (25) = ∅, Holdout A ∩ decision-memory seed ids = ∅, Holdout B ∩ seed ids = ∅.

**⛔ That id-level check is weak, and saying so is part of the result.** The ids are content-addressed, so two records
can only collide if they are byte-identical — the check would be hard to fail even if the corpora were badly
contaminated. Two *stronger* checks were therefore run, and their results are reported as they came out:

| stronger check | result |
|---|---|
| subject identity `(concern_kind, file set)` — A ∩ B | **non-empty**: `{gate/config/loader.ts}` (Holdout A holds a run proposing exactly that one file; Holdout B's GOAL-034 and GOAL-036 runs both propose it) |
| Holdout B subject files ∩ decision-memory seed files | **∅** — no seed covers a Holdout B item |
| decision-memory seed **source** goals ∩ Holdout B goals | **non-empty**: `GOAL-036` |

Neither non-empty result is contamination of the blind runs. The first is **convergence**: three independent
investigations at different commits, with no shared history, landing on the same real cycle — that is the loop
working, and the blind method is what makes the claim credible. The second is a **seed-corpus boundary defect this
task's own plan created**: Plan step 2 instructs seeding the memory from GOAL-036's body, and Plan step 6 makes
GOAL-036 a Holdout B sample, so one source *document* is on both sides of the line. The seed's content
(`goal-store.ts::flipGoal`) is a different item from the blind GOAL-036 proposal (`gate/config/loader.ts`), so no
blind run was informed by the memory — but the isolation is not airtight, and it must be treated as such:

> **Any future training / seed corpus must exclude every Holdout B item, and in particular must not re-use GOAL-036's
> body as a source.** GOAL-036 cannot be both a seed source and a clean holdout.

## 4. Production live shadow — 3 real rounds on the develop tip (AC5)

Three **real** (non-replay) bounded investigations, analysed root = a detached worktree at the develop tip
`e0d39a7c3` (the same commit this task branched from), driven by the same `meta-driver` judge and the same executor
the production CLI uses. The loop's production path is used end to end, including the proposal carrier append.

| run | rounds / requests / bytes | terminal | action | `evidenceCost` | `falsePositiveRate` | `locality` |
|---|---|---|---|---|---|---|
| `…:1` | 7 / 6 / 17,544 | propose_slice | investigate | non-empty | `{state:"not-evaluated"}` | `{state:"not-evaluated"}` |
| `…:2` | 7 / 6 / 21,813 | propose_slice | investigate | non-empty | `{state:"not-evaluated"}` | `{state:"not-evaluated"}` |
| `…:3` | 7 / 6 / 15,504 | propose_slice | propose-goal | non-empty | `{state:"not-evaluated"}` | `{state:"not-evaluated"}` |

**AC5's honesty condition holds exactly**: `falsePositiveRate` and `locality` are strictly `{state:"not-evaluated"}`
in all three records — not a guessed value, not `0`, not an omitted key. `evidenceCost` is non-empty in all three
(it is a count of what happened, and needs no ground truth). The aggregate over the three runs reports
`falsePositiveRate`/`locality` as `not-evaluated` with `evaluated_runs: 0` — the aggregate refuses to invent a number
too.

All three rounds proposed the gate package cycle again (`gate/config/loader.ts` + `gate/config/index.ts` +
`gate/registry.ts`; then `gate/registry.ts`; then `gate/types.ts`). Two of the three were **downgraded**
(`action: investigate`, not `propose-goal`) by the pre-existing proposal-time guards, and the third reached
`propose-goal` with a computed delta. **The third recorded gap is not closed**: the live loop still produces no
computed, falsifiable slice on this repository (0 of 3 computed), exactly as `ownership-active-replay.md` §6
recorded. What changed is that this is now a *quantified* 0 with a cost attached, not a prose impression.

## 5. Decision memory: hits and misses

Scanned: all 34 recorded proposals (25 GOAL-032/033 replays + 9 historical live runs, from
`ownership-active-replay-results.json`). **2 hits, 30 misses.**

| corpus | label | status | entry | matched file |
|---|---|---|---|---|
| historical live | `live` | **`exempted`** | `dm-001-github-client-status-literals` | `packages/quay-github/src/github-client.ts` |
| Holdout A replay | `replay:GOAL-032:A:discovery` | `known-not-yet-filed` | `dm-002-flipgoal-disposeold-statuslog` | `packages/quay/src/goal-store.ts` |

The first is **the required regression hit**: the exact proposal that the old loop emitted is now classified
`exempted`, and the loop's terminal is rewritten from `propose_slice` to `abstain` with the reason
`known-exemption: dm-001-…` on the record. AC2 pins this end to end *and* with a negative control — the identical
proposal shape aimed at a file the memory does not know about still proposes, so the abstain is caused by the memory
rather than by the proposal being malformed.

The second shows the two hit types are genuinely different: a recorded defect nobody has filed is **flagged**
(`known-not-yet-filed`) but does **not** terminate the investigation — the loop still proposed a slice, which is the
right behaviour for something that is merely already-known.

30 misses is the honest denominator: two seed entries are a *start*, not coverage. Every miss is a proposal the
memory had nothing to say about, and none of them is evidence of a false negative — there is no way to tell "the
memory should have known" from "this is a new item" without a much larger recorded-decision corpus.

## 6. Differences from, and additions to, `ownership-active-replay.md`

- §3's "no decision memory" defect is **closed** for the recorded instance (AC2) and the mechanism now exists for
  new ones.
- §6's readiness list item (b) — "add a prior-decision index (exemptions, non-goals of landed goals) that the gate
  consults" — is **built**, on the file-location axis, with the seed list as its (small) corpus.
- §6's item (c) — "require ≥ N consecutive shadow runs with a computed delta before any proposal leaves the carrier"
  — is **not** addressed; the carrier-level output is unchanged and nothing leaves it.
- The three quantified readings are **new**; the old document had none, and its "0 of 3 live runs computed a delta"
  claim was an impression. It is now `0 of 3, 7 rounds and 6 requests each, 17.5–21.8 KB`.
- **New limit this task adds**: the decision memory only knows what a human has written down. Its seed list is three
  entries and its matching axis is file location — so it cannot catch a re-proposal that names the same *symbol* in
  a renamed file, and it will silently pass anything not yet recorded.

## 7. Limits, and what was NOT done

- Small n everywhere: 3 blind runs, 3 production rounds. No cell has enough samples for a rate; the numbers are
  readings, not estimates.
- Holdout A's `locality` denominator counts only files a run *read* or *proposed*; a grep's directory scope is
  deliberately excluded (a directory is not a file the run laid hands on).
- The `jq` record-id isolation check is satisfied but weak (see §3); the stronger subject-identity check is **not**
  satisfied between Holdout A and Holdout B, and that is reported rather than hidden.
- The production rounds ran with the code from this task's branch while the *analysed* tree was the develop tip
  `e0d39a7c3`. The analysed commit and the running code therefore differ by this task's own commit — the investigated
  tree is clean develop, the instrument is not.
- ⛔ **No Goal and no task was created, activated or steered by anything in this document.** The loop still writes
  only shadow carriers. Restricted proposal toward real Goals is `gap-ownership-active-limited-proposal-mode`, which
  this task deliberately does not touch.
