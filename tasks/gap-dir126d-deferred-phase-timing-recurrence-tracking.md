---
id: gap-dir126d-deferred-phase-timing-recurrence-tracking
title: DIR-126-D deferred two enrichment ideas that were never actually
  charter-mandated -- per-phase-boundary timing (nowMs threaded through
  prepare-admission-check.ts, a {phase, round, startedAtMs, endedAtMs}
  breakdown) and findingCodes[] recurrence tracking (recurrenceKey,
  firstSeenGeneration, lastSeenGeneration) -- record them as real,
  well-specified follow-up work
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
## Proposal

Pick up the two enrichment ideas DIR-126-D's own ProposalReview convergence originally bundled in
as "Mechanism B.1" and "Mechanism B.3" before a later round found neither was actually mandated by
the M203 charter and deferred both to keep DIR-126-D's own `mechanismCount` at a defensible size
(DIR-026 SPLIT-OR-COMMIT's `split-multi-mechanism` trigger). Both ideas are real and additive to
the telemetry record DIR-126-D lands (per-generation committed JSON at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`) — neither requires redesigning that record,
only extending it.

## Finding

`experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md`'s own Scope/Done-when
text was directly grepped during DIR-126-D's ProposalReview round 7 (`grep -in
'phase|finding|recurrence|mechanical|content.*agent|dispatch count'`) and confirmed to name only:
one committed record per dispatch attempt (written by whichever phase produces the terminal
outcome), a `--telemetry` hash-binding flag on `milestone-preparation-check.ts --build`, and a
`--telemetry-report <milestoneId>` read-only query mode. Neither granular per-phase-boundary timing
nor recurrence tracking is named anywhere in the charter text — both were added during DIR-126-D's
own iterative ProposalReview fix cycle (the "Forward-compatible feedback identity" AC bullet that
introduced `findingCodes[]` was itself an earlier round's reviewer addition, not a charter
requirement; the `nowMs`/phase-timing idea was a plausible-but-unverified reading of the charter's
title phrase "phase telemetry"). Once DIR-126-D's own scope grew to include them, ProposalReview's
`mechanismCount` (an LLM-judged count of independently-landable mechanisms in the Proposal) stayed
stuck above the `split-multi-mechanism` threshold across two rounds of pure document-structure
consolidation — trimming these two ideas out (verified against the real charter, not assumed) was
the fix that let DIR-126-D actually converge.

## Requested action

1. **Phase-boundary timing.** Extend `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) with
   one additive `nowMs: Date.now()` field on its JSON stdout, computed inside the real subprocess
   (never inside the sandboxed `prepare-milestone.js` itself — that constraint is load-bearing, see
   `gap-prepare-milestone-workflow-dynamic-import`). Extend DIR-126-D's landed
   `--record-generation`/`--decide-resume`/`--record-attempt` calls the same way. Accumulate
   `{phase, round, startedAtMs, endedAtMs}` entries into DIR-126-D's committed telemetry record
   (a new array field, additive to DIR-126-D's frozen schema — no renames/removals of what
   DIR-126-D itself lands). Requires its own AC coverage for the two confirmed
   `Date.now()`/`import()` production-crash precedents (`f6db2a8`, `7357a91`) via a grep-based
   regression guard, matching DIR-126-D's own established bar.
2. **`findingCodes[]` recurrence tracking.** One entry per stable finding code a terminal carries
   (at minimum `terminal.reason`, plus each ProposalReview ledger finding's own code).
   `recurrenceKey = sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/`lastSeenGeneration`
   populated by scanning DIR-126-D's already-committed prior records for a matching
   `recurrenceKey` — a plain glob+JSON-parse read inside `proposal-convergence.ts`, no new
   dispatch. Requires a dedicated fixture spanning two real generations of the same task with a
   repeated finding code, confirming `lastSeenGeneration` advances while `firstSeenGeneration`
   stays pinned.
3. Author a charter (or extend an existing one) that names both explicitly in its own Scope
   section, so a future ProposalReview round doesn't have to re-derive charter-mandate status from
   scratch the way this deferral did.

## Acceptance Criteria

- [ ] `prepare-admission-check.ts` (both mirrors) gain an additive `nowMs: Date.now()` field;
  `prepare-milestone.js` (both mirrors) accumulates `{phase, round, startedAtMs, endedAtMs}` purely
  by reading already-parsed subprocess output — zero new `Date.now()`/`new Date()`/`import()` call
  sites added to `prepare-milestone.js` itself, verified by a grep-based regression fixture.
- [ ] A real multi-round generation's journal (including a `ProposalReview` delta round and a
  `PlanCheck` round) has its phase-dispatch count confirmed equal to the telemetry record's own
  phase-transition entry count.
- [ ] `findingCodes[]` with `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` is added to
  the committed telemetry record (additive to DIR-126-D's frozen schema); a fixture spanning two
  real generations with a repeated finding code confirms `lastSeenGeneration` advances while
  `firstSeenGeneration` stays pinned.
- [ ] Byte-identical mirrors re-verified (`cmp`/`sync-vendor.sh --check`) across every file this
  child touches, including the newly-touched `prepare-admission-check.ts`.
- [ ] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): confirmed real by
  direct source read that DIR-126-D's landed `--record-generation`, `--decide-resume`, and
  `--record-attempt` calls are the exact three extension points this child's phase-timing field
  attaches to, matching Requested action item 1 above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (touches `prepare-admission-check.ts`, not
  previously touched by DIR-126-D's own trimmed scope).
- [ ] Real, non-fixture evidence: a fresh independent audit confirms the real production callsite
  for both the phase-timing self-report and the recurrence-tracking read, not merely unit-test
  reachability.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
