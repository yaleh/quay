# M195 / DIR-117-B — inner iteration report (iteration-0, Build phase)

**Task:** DIR-117-B · **Class:** development (capability-growth) · **Milestone:** M195
**Charter:** experiments/quay-perpetual-stream/charters/M195-dir117b-prepared-gate-real-proof.md
**Base revision:** f0feef7 (post negative-control #1 / preparation receipt commits)

## Context: what already existed before this Build

The real SELECT→`prepare-milestone.js`→receipt run for M195 was already in flight and landed in prior
commits: `milestones/M195/preparation.json` + `proposal-ledger.json` (commit 536171c, PlanCheck
3 rounds 1→3→0), `docs/plans/M195-dir-117-b.md`, and negative-control #1 — a real `execute-milestone.js`
dispatch with a doctored-stale receipt returning `{outcome:"revision-needed", reason:"FAIL:
proposal-stale", phase:"Prepared"}` before Build (commit f0feef7). This Build phase lands the three
code changes the milestone exists to make + the wiring fixture/tests + the post-flip negative control.

## Done-when items → work performed

### Work item A — wire ProposalReview to the REAL `checkWiringCoverage()` (AC #4)

- **CLI main added** to the single-source `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`
  (`node --experimental-strip-types …/wiring-coverage-check.ts --task <task.md>`): extracts `## Proposal`
  + `## Acceptance Criteria`, calls the existing exported `checkWiringCoverage()`, prints a typed JSON
  verdict whose `findings` array maps each `uncovered` claim to a BLOCKING ledger finding in the exact
  `{subsystem:"wiring-coverage", severity:"blocker", blocking:true, evidence, claimRef, disposition}`
  shape the workflow already consumes. Exit 0 = verdict produced; exit 2 = usage/IO error. No claim-
  extraction logic duplicated — the module stays the ONE source DIR-122 imports. Propagated
  byte-identically to `plugin/scripts/wiring-coverage-check.ts` (`sync-vendor.sh --check` CLEAN).
- **Dispatch added** to BOTH `prepare-milestone.js` mirrors (`.claude` + `plugin`, byte-identical): a
  deterministic `agent({label:'wiring-coverage-check', phase:'ProposalReview'})` runs the CLI; the SCRIPT
  (not the LLM) merges the returned findings via the existing `_upsertFindings(..., 0)` path, so the
  phase's open-blocking count increments by `result.findings.length` from the function's real return
  value. A non-parseable verdict fails the phase CLOSED (`needs-human`, `wiring-coverage-check-failed`).
  The LLM reviewer's prompt-level wiring step is retained as a complementary heuristic.
- **Mock harnesses extended** (both fail closed on unknown labels): `plugin/test/prepare-milestone-
  convergence.test.mjs` + `plugin/test/prepare-milestone-preparation-e2e.test.mjs` now handle the
  `wiring-coverage-check` label — default runs the real CLI on the task under review (0 findings for
  the generic fixtures → every pre-existing assertion unchanged), with a per-test `onWiringCheck` override.
- **Grep-confirmable** call sites: the literal CLI command string + `_upsertFindings` merge exist in both
  `prepare-milestone.js` mirrors.

### Work item B — flip the Prepared default to ENFORCED (AC #3)

- BOTH `execute-milestone.js` mirrors (byte-identical): the `else`-skip branch is deleted; `phase('Prepared')`
  is now unconditional; a MISSING `preparationReceiptFile` returns `{outcome:"revision-needed",
  reason:"preparation-receipt-missing", phase:"Prepared"}` before Build (distinct caller-fixable reason,
  not `needs-human`, not the checker's file-level `receipt-missing`). Header phase-table entry updated.
- **OUTER-LOOP.md** disclosure updated in both places (`prepare(c)` STATUS note + `execute()` signature):
  "not yet proven / omitting accepted / `preparationReceiptFile?` optional" → enforced contract with the
  M195 evidence pointer + the explicit known-exposure note (pending receipt-less ad-hoc dispatches must
  route their primary task through `prepare-milestone.js` first).

### Work item C — keep `## Touches` clean (AC #5)

- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/task-schema-check.ts
  tasks/DIR-117-B.md` → **exit 0** ("PASS: schema v1 conformant"). All files touched by this Build are
  within the task's `## Touches` set (verified via `git status`); `tasks/DIR-117.md` was deliberately NOT
  edited here — its `dirStatus`/Resolution update is a Land-phase action (not in `## Touches`, would trip
  `computeTouchesExpansion`).

### Fixtures + tests (AC #4 evidence)

- New fixture `experiments/quay-perpetual-stream/fixtures/preparation/wiring-uncovered-claim-task.md`:
  Proposal claims 2 mechanisms (wiring verb + ≥2 backtick identifiers) with NO matching AC item.
- New unit tests in `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`: the CLI emits
  ≥1 BLOCKING finding from the function's real return value; finding count == `checkWiringCoverage()`'s
  uncovered count (same source of truth); usage error exits 2; a covered Proposal emits 0 findings.
- New convergence test (both mirrors): drives the REAL workflow with the LLM full-review stubbed to ZERO
  findings and the `wiring-coverage-check` dispatch returning the real CLI's findings on the fixture —
  asserts the ledger's open-blocking count increments by EXACTLY the function's return value, every wiring
  finding BLOCKING/blocker, LLM added nothing.
- `plugin/test/execute-milestone-preparation-gate.test.mjs`: the former "SKIPPED (back-compat) — reaches
  Build" case flipped RED-then-GREEN honest to "FAILS CLOSED … Build never dispatched" (both mirrors).

### Post-flip negative control (AC #2 negative half + AC #3 flip proof)

- Real, unmodified workflow source of BOTH mirrors driven with `preparationReceiptFile` OMITTED
  (`milestones/M195/negative-control/post-flip-omitted-receipt-journal.jsonl`): both return
  `{outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"}`, `buildReached:false`,
  `phasesDispatched:["Verify","Prepared"]` — Build never dispatched. Evidence recorded in
  `milestones/M195/negative-control-evidence.md` (alongside pre-flip negative-control #1).

### Parent bookkeeping (DoD clause 3)

- DEFERRED to Land by design: `tasks/DIR-117.md` is NOT in this milestone's `## Touches`; its
  `dirStatus`/Resolution update pointing at M195's evidence happens at Land (per the Proposal's sequencing
  step 6), not during Build.

## Verification

- wiring unit tests: 13/13 pass.
- preparation-gate (both mirrors): 14/14 pass (incl. new fail-closed-on-omitted-receipt).
- convergence (both mirrors): 20/20 pass (incl. new AC#4 increment test; all pre-existing assertions green).
- preparation-e2e (both mirrors): 2/2 pass.
- task-schema-check on DIR-117-B: exit 0.
- preparation receipt still validates after the `extra.acceptance` frontmatter write:
  `milestone-preparation-check.ts --task … --receipt milestones/M195/preparation.json` → PASS (exit 0).
- Mirror byte-identity: `diff -q` clean for execute-milestone.js, prepare-milestone.js, wiring-coverage-check.ts;
  `sync-vendor.sh --check` CLEAN.
- Full `scripts/test.sh`: 579 pass / 2 fail / 3 skipped. The 2 failures (`build-dist-smoke` serve-HTTP-200,
  `delivery-standalone-smoke-gate` 60s gate timeout) are product serve/gate smoke tests unrelated to this
  milestone's methodology-layer changes; confirmed pre-existing — they PASS in isolation both with and
  without these changes (full-suite concurrency/load timing artifact under `--test-concurrency=8`).

## Outcome

`done` — all 5 AC items and the in-scope DoD Build work landed; audit/gate/Land + DIR-117 parent
bookkeeping remain for the subsequent phases.
