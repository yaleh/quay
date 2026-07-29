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

Emit one committed, structured JSON telemetry record per `prepare-milestone` dispatch attempt
(including every admitted content generation) — every phase transition, every terminal outcome
(`prepared`, `needs-human`, `revision-needed`, or the new
`prepare-already-running` contention outcome from [[DIR-126-A]], or [[DIR-126-C]]'s
`reuse-terminal` decision), not only the success path. Every record is committed; a successful
generation's record is additionally hash-bound into its receipt so tampering is mechanically
detectable. Fourth child of DIR-126's 5-way split. Depends on [[DIR-126-A]] (admission
identity/release are real events to record), [[DIR-126-B]] (preflight verdict policy is a real
input and rejection shape), and [[DIR-126-C]] (this child finalizes the generation-record shape C's
`decideResumeGeneration` consumes in interim/frozen form).

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

One committed JSON record per dispatch attempt at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`. Every record has an `attemptId`;
successfully admitted attempts additionally have a `generationId` derived deterministically from
[[DIR-126-A]]'s successful Admission identity
`{key, ownerExecutionId, fencingToken}` (canonical encoding/hash of all three), not from bare
`$CLAUDE_CODE_SESSION_ID`: a top-level Claude session can host multiple Workflow runs, while A's
monotonic fencing token distinguishes successive owners even when `ownerExecutionId` is reused.
Contention attempts that do not acquire a lease get their own attempt record keyed by the observed
lease key plus the contender identity/attempt-start timestamp, with `generationId:null`; they cannot
masquerade as the active owner's generation. For an admitted attempt, `recordId = generationId`;
for contention, `recordId = attemptId`. A `reuse-terminal` attempt has a real
Admission/generation identity for ownership and release accounting but records
`createsContentGeneration:false`, matching [[DIR-126-C]]'s rule that it does not execute a new
content/review generation.

Written by whichever phase produces the terminal outcome — `Admission` (on `prepare-already-
running`), `Preflight` (on `preflight-rejected`), `ProposalAuthors`/`Adjudicate`/`PlanAuthor`/
`PlanCheck` (on `revision-needed`), [[DIR-126-C]]'s decision point (on `reuse-terminal`), or
`Receipt` (on `prepared`) — any exit, not just success. The frozen record contains:

`{schemaVersion, recordId, attemptId, generationId,
admission:{key,ownerExecutionId,fencingToken}, workspace, taskId, milestoneId,
class, highRisk, hashes:{charter,taskContract,proposal,reviewPolicy},
decision:{kind,reason,priorGenerationId,priorReason,createsContentGeneration},
phases:[{phase,round,startedAtMs,endedAtMs,
mechanicalRunnerCount,mechanicalRunnerMs,contentAgentDispatchCount,contentAgentMs,retryCount}],
terminal:{outcome,reason,phase,cacheable}, leaseRelease:{attempted,ok,reason}, sessionId}`.

For admitted attempts, `decision.kind` is exactly `cold|resume|reuse-terminal`; a contention or
other pre-decision exit records `kind:"not-evaluated"` with a typed reason rather than omitting the
field. `reviewPolicy` includes [[DIR-126-B]]'s checker policy version/hash. `reuse-terminal`
records zero content-agent dispatches/minutes, the prior generation it reused,
`createsContentGeneration:false`, and [[DIR-126-A]]'s release result before return.

**Committed, not gitignored** (unlike DIR-126-A's lease) — telemetry must survive across
sessions/days, be inspectable by a later auditor (the DoD's own "reproduces from checked-in
workflow artifacts, not session prose" bar), and exist even for failed generations. A gitignored
file could never satisfy reproducible capacity reporting for the majority-failure case DIR-126's
Finding measured (16 of 17 sampled calls were non-success).

**Pervasive call-site relationship, explicitly counted.** Every phase boundary in
`prepare-milestone.js` (both mirrors) gains a telemetry-emit call — a genuinely new, pervasive
relationship needing an AC that counts real emitted records against real phase dispatches from a
live journal, not a sampled subset. Mechanical CLI runners and content-generation/review agents are
separate counters; combining them would hide whether [[DIR-126-B]]/[[DIR-126-C]] actually prevented
expensive content work.

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
- **Generation identity inherits A's lease identity, not bare session identity** —
  `{key,ownerExecutionId,fencingToken}` is already the ownership authority; deriving the telemetry
  ID from that tuple prevents collisions when one Claude session hosts multiple Workflow runs and
  keeps telemetry aligned with the exact owner/release being measured.
- **C's decision inputs/outputs are first-class fields, not free-text terminal details** —
  `charter/taskContract/proposal/reviewPolicy` hashes, `cold|resume|reuse-terminal`,
  `priorGenerationId`, and the terminal cacheability/reason are required so C and E never have to
  infer control decisions from prose.
- **Mechanical runners and content agents are counted separately** — a preflight rejection or
  terminal reuse is efficient only if the record proves zero content-agent dispatches; total
  dispatch count alone cannot prove that. Their summed execution milliseconds are also separate
  from phase wall time so parallel authors do not disappear from the capacity calculation.
- **Lease release is telemetry, not an assumed side effect** — every acquired generation records
  whether release was attempted/succeeded, including C's new `reuse-terminal` edge.
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
| A phase transition's timestamp/dispatch-count/agent-duration cannot be captured | recorded as explicit `null`/`"unknown"`, never omitted or fabricated |
| Admission identity lacks key/owner/fencing token | fail closed; no collision-prone bare-session `generationId` is emitted |
| `reuse-terminal` record has a content-agent dispatch or lacks a prior generation/policy hash | schema/telemetry validation fails closed |
| An acquired generation terminates without a successful/typed lease-release result | terminal remains visibly failed/needs-human; telemetry cannot report a clean release |
| Receipt references a telemetry file that no longer exists or has changed hash | `telemetry-missing`/`telemetry-stale` (mirroring `ledger-missing`/`ledger-stale`) — fails closed |
| `--telemetry-report` finds no records for a milestoneId | explicit `no-records` result, not a crash or an empty-looking success |

### Compatibility

Receipt (`preparation.json`) schema gains only optional new fields (`generationId`, decision,
review-policy hash, and a telemetry hash pointer); no existing `milestone-preparation-check.ts`
check changes shape or becomes stricter
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
- **Admission implementation may expose the lease identity with different serialization details**
  — mitigated by consuming A's actual `key/ownerExecutionId/fencingToken` fields and defining one
  canonical generation-ID encoder here, never parsing a human-formatted owner string.
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
3. Existing real receipts record the same parent `$CLAUDE_CODE_SESSION_ID` across multiple
   sub-dispatch roles, and a top-level session can host multiple Workflow runs; session identity is
   provenance, not a unique generation key. [[DIR-126-A]]'s `key/ownerExecutionId/fencingToken`
   tuple is the actual ownership identity and the correct generation-key source.
4. `milestone-preparation-check.ts`'s existing `--ledger` flag + `checkPreparation()`'s
   `ledger-stale`/`ledger-missing` checks (confirmed by direct read) are a direct, reusable
   precedent for hash-binding an auxiliary artifact into the receipt.

## Requested action

1. Add telemetry-emit calls at every phase boundary and decision/terminal/release edge in
   `prepare-milestone.js` (both mirrors), writing to
   `milestones/prepare-telemetry/<taskId>/<recordId>.json` per the frozen schema above.
2. Add a new `--telemetry` flag to `milestone-preparation-check.ts --build` (+ `plugin/scripts/`
   mirror) hash-binding the telemetry file into the receipt, and a `telemetry-stale`/`telemetry-
   missing` check to `checkPreparation()`, mirroring the existing `--ledger` pattern.
3. Add a new `--telemetry-report <milestoneId>` read-only CLI mode to `milestone-preparation-
   check.ts` answering phase-timing queries without JSONL parsing.
4. Add real test fixtures: one cold run, one resumed run, one contention rejection
   ([[DIR-126-A]]), one preflight rejection ([[DIR-126-B]]), and one `reuse-terminal`
   ([[DIR-126-C]]) record — each confirmed queryable via `--telemetry-report` — plus generation-ID
   collision, policy-hash invalidation, lease-release, and tamper-detection fixtures.
5. Real regression proof: one real cold `prepare-milestone` dispatch and one real dispatch that
   hits a non-success terminal outcome, both producing real, inspectable telemetry files.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows every phase boundary in `prepare-milestone.js` (both mirrors) has a REAL telemetry-
  emit callsite — not zero importers, not `--selftest`-only reachability. This item alone, if
  unmet, fails the whole child regardless of how many other items pass.
- [ ] **Telemetry is directly queryable:** one real cold run, one real resumed run, one real
  contention rejection ([[DIR-126-A]]), one real preflight rejection ([[DIR-126-B]]), and one real
  `reuse-terminal` ([[DIR-126-C]]) each produce a record exposing hashes, decision/prior
  generation, phase wall timing, separate mechanical/content dispatch counts and summed execution
  milliseconds, terminal/cacheability, lease-release result, and generation ID — retrieved via
  `--telemetry-report`, without parsing `~/.claude/projects/**.jsonl`.
- [ ] **Generation identity cannot collide across runs in one Claude session:** two successive
  Admission owners with the same `ownerExecutionId` but different fencing tokens produce distinct
  generation IDs; the ID is mechanically traceable back to A's exact lease tuple.
- [ ] **C's terminal reuse is measurable:** a real `reuse-terminal` record has matching
  task/Proposal/charter/review-policy hashes, a real `priorGenerationId`, zero
  `contentAgentDispatchCount`/`contentAgentMs`, `createsContentGeneration:false`, and a
  successful/typed A-release result. A checker-policy mutation produces a cold decision instead of
  reusing the old terminal.
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
  production-wired fix: every dispatch/phase emits a real telemetry record keyed by `recordId`;
  admitted records carry `generationId` derived from [[DIR-126-A]]'s
  `key/ownerExecutionId/fencingToken`, while contention attempts carry `generationId:null`
  (confirmed via the production-callsite AC item above), and
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
- [ ] A real `reuse-terminal` record proves zero content agents and successful/typed lease release;
  two generations sharing a parent session remain uniquely keyed.
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
