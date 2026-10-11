# Limited proposal mode — phase C of the end-to-end architecture self-bootstrap

Task: `gap-ownership-active-limited-proposal-mode`.
Code: `docs/analysis/ownership-active-limited-proposal.mjs` (new; imports nothing from the shadow loop).
Tests: `plugin/test/ownership-active-limited-proposal.test.mjs` (18).
Depends on: `gap-architecture-evidence-store-and-decision-memory` (decision memory `isKnownExemption`,
quantitative readings `computeRunMetrics`, the evidence-store carrier) — consumed, **not** re-implemented.

## 0. Why this task exists

`gap-ownership-active-investigation-loop-shadow` (done) ends at `ownership-active-replay.md` §6: the loop is a
**structural sandbox** that only ever writes a shadow carrier (`plugin/test/ownership-active-loop.test.mjs`
pins that red line), and §6 names four *suggested entry conditions* under which — and only under which — a
proposal may leave the carrier. Those conditions were written down and never implemented. This task implements
them, and stops at the first thing the mechanism is allowed to produce: **one `draft` Goal, for a human to
approve or reject.** It never activates anything.

## 1. What was built

| piece | role |
|---|---|
| `evaluateEntryBar(carrierRecords)` | PURE. The four §6 conditions over one candidate's records; returns `{eligible, reason, matchedConditions, conditions, streak}`. A refusal names **which** condition failed and **why** — never one generic "not eligible". |
| `proposeDraftGoal(rec, existingGoalIds, deps)` | PURE policy + one injected write seam. Computes the next `GOAL-0NN` from the supplied ids, writes the exit-condition AC **first** (the goal write surface refuses a draft GOAL with zero ACs — AC-217), then exactly **one** `status: "draft"` GOAL. |
| `createGoalStoreWrite(store)` | The real write seam over a goal store, passed IN so the module never statically imports the Core tree. |
| CLI (`--carrier … [--write]`) | A real (non-fixture) reading over a production carrier; `--write` performs the constrained write only for eligible candidates. |

The four conditions are taken **verbatim** from §6 (a)–(d):

1. `concern_kind === "package-cycle"` — the only kind with a computable, falsifiable delta;
2. the delta was **computed** by the ArchGuard `slice-delta` primitive, its **negative control is falsified**,
   and `provenanceConsistency === "match"`;
3. the decision memory says **`not-known`** — a recorded `exempted` or a `known-not-yet-filed` item must not be
   re-wrapped as a new Goal (it has its own path, or a human already ruled);
4. **≥ N=3 consecutive production live runs** on the same candidate carry a **consistent** computed delta.

Three decisions worth naming, because each is a place a weaker implementation looks fine:

- **`evaluateEntryBar` is an enum, not a boolean (硬规则 3).** An unreadable `concern_kind` is reported as
  `CONDITION_1_UNDETERMINED` — its own state — never silently folded into "not package-cycle". The four
  refusal reasons are asserted pairwise **distinct**.
- **"Not computed" and "computed but the control did not falsify" are different facts (硬规则 3b).** Each
  sub-reading of condition 2 (presence / computed / control / provenance) produces its own reason.
- **No id is hard-coded (硬规则 8).** `nextGoalId` reads the id set it is given; a test asserts the module
  source contains no concrete `GOAL-0NN` literal, and that the *same* dynamic computation drives the write.

## 2. AC5 — the production dry run (honest, no fabrication)

**Result: NOT satisfied. `eligible: false` for every candidate; the mechanism produced NO Goal this round.**

Reading taken with the module's own CLI (`--carrier`, dry run — no write) against the live production carrier:

| reading | value |
|---|---|
| carrier | `.quay/ownership-shadow-proposals.jsonl` (the live shadow-proposal carrier, gitignored runtime state) |
| carrier sha256 | `86efb78217534123795f0c5db64a94e0f50cd2c3579ae06703c570fbe35fd656` |
| records | **89** |
| candidates (grouped by structural file set, else the loop's `concern_key`) | **20** |
| eligible | **0** |
| maximum run-streak | **0 / 3** |

Where the 20 candidates fall, by **first** failing condition:

| first failing condition | candidates | meaning |
|---|---|---|
| `CONDITION_2_NOT_MET` (delta not computed) | **10** | reached C1 (a real `package-cycle` candidate) and stopped here |
| `CONDITION_1_NOT_MET` (kind ≠ package-cycle) | 3 | `other-boundary` ×1, `canonicalization` ×2 — out of scope by §6(d) |
| `CONDITION_1_UNDETERMINED` (record has no run shape) | 7 | older benchmark/replay-shaped rows in the same carrier; the concern kind cannot be read |

The 10 C1-passing candidates are the gate-core cycle proposals. **All 10 carry `slice_delta.status =
"not-evaluated"`** — the primitive refused to compute a cut (`NO_EDGE_EXPLAINED_BY_MOVES`,
`MOVE_TO_NOT_AN_INTERNAL_DIR`, `切法覆盖不足`). Since the delta is not computed, there is no negative control
and no `provenanceConsistency` to check. So the shortfall is not a near-miss: **not one production run has ever
produced a computed, falsifiable slice on this repository.**

That is the same zero that `ownership-active-replay.md` §3 (`0 of 3`) and
`architecture-evidence-store-replay.md` §4 (`0 of 3`, 7 rounds / 6 requests each) recorded — now reading as a
quantified **0 of 20 candidates, max run-streak 0/3** over the whole committed carrier. **Per AC5 this is a
legal terminal: "未满足,还差 3 轮" (and today not even 1 of those 3 rounds has a computable delta).**
No synthetic record was manufactured to make the number look better; the honest reading is recorded as it came
out, and no Goal was created.

## 3. Carrier choice — an honest limit of the dependency's schema

The task's Plan names `.quay/architecture-evidence-store.jsonl` as the input, but the four record kinds that
store persists do **not** carry the readings the entry bar needs:

- the `outcome` record carries `verdict`, `run_id`, `subject_key`, `subject_files`, `concern_key`, `gate_ok`
  and `metrics` — but **no `concern_kind`, no computed delta, no `provenanceConsistency`**;
- those readings live on the **run record**, whose verbatim carrier is
  `.quay/ownership-shadow-proposals.jsonl` (the loop appends each run there, and it is what "leaves the
  carrier" per §6(c)).

So `evaluateEntryBar` consumes **run records** and derives `concern_kind` **structurally** — a non-null
`slice_delta` implies `package-cycle` by construction of the loop (the primitive is only called for that kind),
and a non-cycle run names its own kind as a machine-written `concern_kind=<kind>` token in its envelope. Had the
entry bar read only the evidence store, it would have been **structurally dead** (condition 2 could never be
evaluated). This is recorded as a limit, not papered over; if the store is to become the sole input, its
`outcome` record must first be extended to carry the delta and its provenance.

## 4. Limits, and what was NOT done

- **No Goal was created or activated; no goal branch was opened; no code was refactored.** The production dry
  run was read-only; because it was not eligible, `proposeDraftGoal` was never invoked in production.
- The unit tests exercise the write end-to-end against a **real** goal store in a temp dir (AC4 reads the
  created GOAL back with `store.get` and asserts `status === "draft"`), but N is small and the eligible path is
  not yet reachable in production — the mechanism is built and gated, not yet used.
- The streak semantics: replay/holdout records neither count toward nor break the production streak (§6(c)
  counts *production* live runs); the first production run that fails to qualify ends it. This is a declared
  reading, not a derived one.
- The run-streak only counts the **tail**: three qualifying runs that are followed by a non-qualifying
  production run are not eligible — deliberately, since the point is to propose from the *current* state.
