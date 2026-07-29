---
id: DIR-126-D
title: Per-generation phase telemetry for prepare-milestone.js (committed
  milestones/prepare-telemetry/ records) — fourth child of DIR-126's split
status: todo
labels:
  - milestone-candidate
  - human-steered
  - priority:urgent
parent: DIR-126
children: []
extra:
  schema: v1
  dirStatus: applied
  rank: 0
  urgency: urgent
---

**type:** execution

## Proposal

Emit one committed, structured JSON telemetry record per `prepare-milestone` generation — every
phase transition, every terminal outcome (`prepared`, `needs-human`, `revision-needed`, or the new
`prepare-already-running` contention outcome from [[DIR-126-A]]), not only the success path —
hash-bound into the receipt so tampering is mechanically detectable. Fourth child of DIR-126's
5-way split. Depends on [[DIR-126-A]] (admission is a real event to record), [[DIR-126-B]]
(preflight rejections are a real terminal shape to record), and [[DIR-126-C]] (this child finalizes
the generation-record shape C's `decideResumeGeneration` consumes in interim/frozen form).

### Problem framing (re-verified live against the current tree, 2026-07-29)

The receipt's `convergence` block (`fullSynthesisCount`, `deltaRounds`, `startedAtMs/endedAtMs`,
`proposalHashes`) is real DIR-125 telemetry, but scoped only to the `ProposalReview` phase and
written only on the success path (the `Receipt` phase, after `PlanCheck` passes — confirmed by
direct read of `prepare-milestone.js`). A `needs-human`/`revision-needed` return from
`ProposalAuthors`, `Adjudicate`, `PlanAuthor`, or `PlanCheck` never reaches the `Receipt` phase, so
no structured record survives a failed generation — exactly why DIR-126's own Finding had to
reconstruct M192/M195/M196/M198's numbers from raw Claude Code workflow-journal prose instead of a
queryable artifact (16 of 17 sampled real calls were non-success).

### Chosen mechanism

One committed JSON record per generation at
`milestones/prepare-telemetry/<taskId>/<generationId>.json`, where `generationId` is the
`Admission` phase's own real `$CLAUDE_CODE_SESSION_ID` — the same real, harness-set, unforgeable
provenance pattern DIR-117 iteration-2 already established for author/reviewer distinctness,
applied here to generation identity (a genuinely new use of an existing, proven pattern, not a new
mechanism class).

Written by whichever phase produces the terminal outcome — `Admission` (on `prepare-already-
running`), `Preflight` (on `preflight-rejected`), `ProposalAuthors`/`Adjudicate`/`PlanAuthor`/
`PlanCheck` (on `revision-needed`), or `Receipt` (on `prepared`) — any exit, not just success, and
containing one entry per phase transition:
`{generationId, phase, round, startedAtMs, endedAtMs, dispatchCount, retryCount, terminalReason,
sessionId}`.

**Committed, not gitignored** (unlike DIR-126-A's lease) — telemetry must survive across
sessions/days, be inspectable by a later auditor (the DoD's own "reproduces from checked-in
workflow artifacts, not session prose" bar), and exist even for failed generations. A gitignored
file could never satisfy reproducible capacity reporting for the majority-failure case DIR-126's
Finding measured (16 of 17 sampled calls were non-success).

**Pervasive call-site relationship, explicitly counted.** Every phase boundary in
`prepare-milestone.js` (both mirrors) gains a telemetry-emit call — a genuinely new, pervasive
relationship needing an AC that counts real emitted records against real phase dispatches from a
live journal, not a sampled subset.

**Tamper detection via existing mechanism.** The telemetry file's own hash is bound into the
receipt via a new `--telemetry` flag on `milestone-preparation-check.ts --build`, the same way
`--ledger` already hash-binds `proposal-ledger.json` (`checkPreparation()`'s existing `ledger-
stale`/`ledger-missing` pattern, reused, not reimplemented, for the new `--telemetry` flag).

**No fabrication.** A field that cannot be captured (e.g. token-usage counts the harness doesn't
expose to a given `agent()` result) is recorded as an explicit `null`/`"unknown"`, never omitted
(omission is indistinguishable from "not implemented yet" downstream) and never invented.

A new `--telemetry-report <milestoneId>` read-only CLI mode on `milestone-preparation-check.ts`
answers "phase timings for this milestone" without any JSONL-in-`~/.claude/projects/` parsing —
the DoD's own "without parsing session internals" bar, satisfied directly.

### Key design decisions

- **Admission (ephemeral, gitignored) and telemetry (durable, committed) are separate artifacts with
  separate lifecycles** — a lease that must be deleted on release cannot also serve as the
  permanent historical record capacity calibration needs.
- **Telemetry is written on EVERY terminal outcome, not only success** — this is the literal fix for
  Problem framing's gap 4; without a durable record of failed generations, [[DIR-126-C]]'s automatic
  resume-decision has nothing to compare against, and 16 of 17 sampled real calls in the Finding
  were non-success. (Rejected alternative: writing telemetry only on success, today's behavior —
  this is the literal cause of the gap being closed.)
- **`generationId` = the real harness-set `$CLAUDE_CODE_SESSION_ID`, not a self-generated ID** —
  reuses DIR-117 iteration-2's own unforgeable-provenance pattern rather than inventing a second,
  weaker identity scheme.
- **Tamper detection reuses the existing `--ledger` hash-binding mechanism**, not a new integrity
  scheme — `checkPreparation()`'s existing `ledger-stale`/`ledger-missing` codes are the precedent
  this child's `--telemetry` flag follows exactly.
- **Not deriving telemetry from Claude Code session JSONL via meta-cc** — the task's own AC requires
  telemetry be queryable "without parsing `~/.claude/projects/**.jsonl`," and session logs aren't
  checked in or reproducible by a later auditor, conflicting with the DoD's "checked-in workflow
  artifacts, not session prose" requirement.
- **Small structured JSON only, no prose duplication of the Proposal/Plan** — keeps this child's own
  new committed-artifact volume from adding to the 2.09:1 process-artifact-to-code ratio DIR-126's
  Finding flags as a problem; explicitly excluded from any LOC "productivity" framing.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Telemetry write fails on an otherwise-passing generation | terminal `needs-human`, never silently certified `prepared` |
| A phase transition's timestamp/dispatch-count cannot be captured | recorded as explicit `null`/`"unknown"`, never omitted or fabricated |
| Receipt references a telemetry file that no longer exists or has changed hash | `telemetry-missing`/`telemetry-stale` (mirroring `ledger-missing`/`ledger-stale`) — fails closed |
| `--telemetry-report` finds no records for a milestoneId | explicit `no-records` result, not a crash or an empty-looking success |

### Compatibility

Receipt (`preparation.json`) schema gains only optional new fields (`generationId`, a telemetry
hash pointer); no existing `milestone-preparation-check.ts` check changes shape or becomes stricter
for old receipts — the exact precedent `computeMetricsForReceipt` already sets for pre-DIR-125
receipts (`convergence-not-recorded`, a non-crash explicit code). M195/M197-shaped fixtures must
remain GREEN. Both workflow mirrors and the `milestone-preparation-check.ts` mirror stay
byte-identical via the existing vendor-sync mechanism. No retroactive backfilling of telemetry into
pre-DIR-126 receipts.

### Risks

- **Cross-child interface risk (inherited from DIR-126-C):** this child must treat the
  generation-record shape DIR-126-C already shipped against as a compatibility contract, not
  silently redesign it — DIR-126-C's own interim/frozen shape is the starting point here, extended
  (never breaking-changed) to the full telemetry record.
- **New committed-artifact volume could itself add to the 2.09:1 process-artifact-to-code ratio**
  the Finding flags as a problem — mitigated by keeping each record small structured JSON, no prose
  duplication, explicitly excluded from LOC "productivity" framing.

### Non-goals

Not implementing [[DIR-126-A]]'s admission/lease logic, [[DIR-126-B]]'s preflight checks, or
[[DIR-126-C]]'s resume-decision logic (only records what they decided). Not building
[[DIR-126-E]]'s capacity-report aggregation — this child only makes the raw records exist and be
individually queryable; aggregation across records is the later child's own scope. Not fabricating
token-usage fields the harness doesn't expose.

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]],
[[DIR-126-B]], [[DIR-126-C]].

## Finding

1. `.claude/workflows/prepare-milestone.js`'s `Receipt` phase (confirmed by direct read) is the
   only place `convergence` telemetry is written, and it only runs after `PlanCheck` passes.
2. DIR-126's own Finding: "16 of 17 sampled real calls were non-success" — the concrete, measured
   cost of telemetry only existing on the success path.
3. DIR-117 iteration-2's own `$CLAUDE_CODE_SESSION_ID` provenance pattern (confirmed real and
   already in production use for author/reviewer distinctness in the receipt's `provenance` block)
   is a direct, reusable precedent for unforgeable generation identity.
4. `milestone-preparation-check.ts`'s existing `--ledger` flag + `checkPreparation()`'s
   `ledger-stale`/`ledger-missing` checks (confirmed by direct read) are a direct, reusable
   precedent for hash-binding an auxiliary artifact into the receipt.

## Requested action

1. Add telemetry-emit calls at every phase boundary in `prepare-milestone.js` (both mirrors),
   writing to `milestones/prepare-telemetry/<taskId>/<generationId>.json` per the Chosen mechanism.
2. Add a new `--telemetry` flag to `milestone-preparation-check.ts --build` (+ `plugin/scripts/`
   mirror) hash-binding the telemetry file into the receipt, and a `telemetry-stale`/`telemetry-
   missing` check to `checkPreparation()`, mirroring the existing `--ledger` pattern.
3. Add a new `--telemetry-report <milestoneId>` read-only CLI mode to `milestone-preparation-
   check.ts` answering phase-timing queries without JSONL parsing.
4. Add real test fixtures: one cold run's full record, one resumed run's full record, one
   contention-rejection ([[DIR-126-A]]) record, one preflight-rejection ([[DIR-126-B]]) record —
   each confirmed queryable via `--telemetry-report` — plus a tamper-detection fixture (hand-edit a
   telemetry file post-receipt, confirm `telemetry-stale`).
5. Real regression proof: one real cold `prepare-milestone` dispatch and one real dispatch that
   hits a non-success terminal outcome, both producing real, inspectable telemetry files.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows every phase boundary in `prepare-milestone.js` (both mirrors) has a REAL telemetry-
  emit callsite — not zero importers, not `--selftest`-only reachability. This item alone, if
  unmet, fails the whole child regardless of how many other items pass.
- [ ] **Telemetry is directly queryable:** one real cold run, one real resumed run, one real
  contention rejection ([[DIR-126-A]]), and one real preflight rejection ([[DIR-126-B]]) each
  produce a real telemetry record exposing phase start/end/duration, dispatch/retry counts,
  terminal reason, and generation ID — retrieved via `--telemetry-report`, without parsing
  `~/.claude/projects/**.jsonl`.
- [ ] **Telemetry integrity:** a tamper fixture (hand-edited telemetry file post-receipt) is
  confirmed to produce `telemetry-stale` via `checkPreparation()`, and a fixture attempting to
  certify a generation `prepared` with a missing/mismatched telemetry record is confirmed to fail
  closed — instrumentation cannot turn a failed preparation into `prepared`.
- [ ] **Every phase transition is counted, not sampled:** a real journal's phase-dispatch count is
  confirmed to equal the corresponding telemetry record's phase-transition entry count, for at
  least one real multi-round generation (a `ProposalReview` delta round and a `PlanCheck` round).
- [ ] Every emitted record's fields are confirmed present-and-typed (`null`/`"unknown"` where
  genuinely uncapturable, never omitted) — verified via schema check against a real record.
- [ ] Canonical and `plugin/` mirrors of `prepare-milestone.js` and `milestone-preparation-check.ts`
  (+ their test files) are byte-identical — `cmp`/`sync-vendor.sh --check`.

- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — a `needs-human`/
  `revision-needed` return from `ProposalAuthors`/`Adjudicate`/`PlanAuthor`/`PlanCheck` today never
  reaches the `Receipt` phase, so no telemetry survives a failed generation. This child's real,
  production-wired fix: every phase emits a real telemetry record keyed by `generationId`
  (the real `$CLAUDE_CODE_SESSION_ID`, confirmed via the production-callsite AC item above), and
  `milestone-preparation-check.ts` gains a `--telemetry` flag hash-binding that record into the
  receipt via `checkPreparation()`'s existing `ledger-stale`/`ledger-missing`-shaped check
  (confirmed real, mirroring the pre-existing `--ledger` flag exactly) — all queryable without
  parsing `~/.claude/projects/**.jsonl`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js` and the receipt integrity engine,
  `milestone-preparation-check.ts`).
- [ ] A real, non-fixture cold run AND a real, non-fixture non-success generation both produce real,
  inspectable telemetry records with command output, not asserted.
- [ ] RED/GREEN evidence exists for the tamper-detection case and the missing-telemetry-fails-closed
  case.
- [ ] A fresh independent audit confirms the real production callsite for telemetry emission at
  every phase boundary, not merely unit-test reachability.

## Human verification when exp5 marks this DIR done

1. Can capacity and bottleneck conclusions now be reproduced without inspecting private Claude
   session logs (once DIR-126-E's aggregation exists to consume these records)?
2. Does telemetry survive a FAILED generation, not only a successful one?
3. Can instrumentation ever turn a failed preparation into a falsely-certified `prepared`? (Must be
   no.)

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `plugin/test/prepare-milestone-preparation-e2e.test.mjs`
