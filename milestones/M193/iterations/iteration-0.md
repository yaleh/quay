# M193 / DIR-125 iteration 0 — bound prepare-milestone Proposal convergence

**Task:** DIR-125 · **Charter:** `experiments/quay-perpetual-stream/charters/M193-dir125-bound-prepare-milestone-convergence.md`
**Class:** development · **Value type:** capabilityGrowth · **Deliverable:** yes

## Summary

Closes the DIR-120/M192 unbounded-restart defect: `prepare-milestone.js`'s ProposalReview phase
used to return `revision-needed` on any nonzero finding, and the CALLER restarted the entire
workflow — two new Proposal authors + a new adjudicator rewrote the complete Proposal before every
single review (10 consecutive full-regeneration rounds, finding sequence `8→2→1→1→1→2→2→1→2→1`,
~3h15m active workflow time, ~1.13M output tokens, never reaching PlanAuthor).

ProposalReview is now a **bounded convergence loop**, the same stopping-rule *shape* as PlanCheck's
pre-existing `<=3`-round/`F_i=0` rule:

1. **ONE full independent review per generation.** Proposal authors + adjudicator run exactly once;
   the review returns a typed finding array (`subsystem`, `summary`, `severity`, `blocking`,
   `evidence`, `claimRef`, `disposition`) instead of a scalar count.
2. **Only unresolved BLOCKING findings trigger further work** — via a focused reviser (edits only
   what's needed) + an independent delta reviewer, never the original authors/adjudicator again.
3. **Hard cap:** at most 2 delta rounds ordinary, 3 for explicit `highRisk` — a caller may lower
   this via `maxDeltaRounds`, never raise it above the policy ceiling (verified by both the
   in-workflow clamp and a receipt-side mechanical re-check).
4. **Soft wall-clock budget:** 45m ordinary / 75m `highRisk`, checked BEFORE admitting the next
   round (never killing an in-flight one).
5. **Split checkpoint:** >=3 independent blocking findings in one subsystem, or >2 independently
   landable mechanisms, recommends (never auto-performs) a split.
6. **Non-blocking findings are never discarded** — each carries an explicit disposition (`plan`,
   `split`, `accepted-risk`, `backlog`, `duplicate`, `superseded`) and stays queryable in the
   ledger, which is written beside the receipt and sha256 hash-bound into it (so a later ledger
   swap, or pairing the receipt with a Proposal edited after the fact, fails the preparation check).

## New module: `proposal-convergence.ts` (pure, unit-tested, mirrored)

`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` →
`plugin/scripts/proposal-convergence.ts` (byte-identical, added to `sync-vendor.sh`'s
`SYNC_SCRIPTS`). Exports the caps/ledger/split/budget/decision logic as pure functions:
`capsFor`, `fingerprintFinding`, `upsertFindings`, `applyResolutions`, `blockingOpen`,
`checkSplitRecommendation`, `budgetStatus`, `nextAction`, `hashLedger`,
`validateConvergenceCounters`, `computeConvergenceMetrics`. 32 unit tests in
`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, including a dedicated
cross-check that `prepare-milestone.js`'s inlined caps (both mirrors) literally match `capsFor()` —
the workflow file has no import statements (established convention: `MAX_PLANCHECK_ROUNDS` is
already inlined the same way), so the two must be kept honest by an explicit test rather than a
shared import.

## `prepare-milestone.js` (both `.claude`/`plugin` mirrors, byte-identical)

ProposalReview phase rewritten: one full review dispatch, then a `while` loop that checks
zero-blocking → split → budget → cap (in that order) before dispatching each focused-revise +
independent-delta-review pair. Backward-compatible: a legacy reviewer/mock returning a bare
`findings: <number>` still works (0 = pass, nonzero = filed as one untyped blocking finding). The
Receipt phase now also instructs writing `milestones/<id>/proposal-ledger.json` and passes
`--ledger`/`--convergence-json` to `milestone-preparation-check.ts --build`.

## `milestone-preparation-check.ts` extensions (both mirrors)

- `buildReceipt`/`checkPreparation` gain optional `ledgerFile`/`convergence` — fully
  backward-compatible (a pre-DIR-125 receipt with neither field is checked exactly as before).
- New fail-closed codes: `ledger-missing`, `ledger-stale` (hash mismatch — tamper/pairing
  detection), `ledger-blocking-findings-open`, `convergence-full-synthesis-exceeded`,
  `convergence-delta-rounds-exceeded` (receipt-side mechanical re-check via
  `proposal-convergence.ts`'s `validateConvergenceCounters` — never trusting the workflow's own
  internal counting).
- New `computeMetricsForReceipt({receiptFile})` + CLI `--metrics` mode: the one mechanically
  queryable surface for `prepareWallTime`/`fullSynthesisCount`/`proposalReviewRounds`/
  `blockingFindingYield`/`proposalChurnRatio`/`reachedPlanAuthor` per candidate.
- New CLI flags: `--ledger <file>`, `--convergence-json <json>`, `--metrics`.

## Test evidence

```
$ node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
ℹ tests 32 / pass 32 / fail 0

$ node --experimental-strip-types --test experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs
ℹ tests 42 / pass 42 / fail 0

$ node --experimental-strip-types --test plugin/test/prepare-milestone-preparation-e2e.test.mjs
ℹ tests 2 / pass 2 / fail 0   (zero-finding backward-compat, both mirrors)

$ node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs
ℹ tests 18 / pass 18 / fail 0   (9 scenarios x 2 mirrors)

$ node --experimental-strip-types --test plugin/test/execute-milestone-preparation-gate.test.mjs
ℹ tests 14 / pass 14 / fail 0   (unaffected — buildReceipt back-compat confirmed)
```

`prepare-milestone-convergence.test.mjs` drives the REAL, unmodified workflow source (loaded as an
`AsyncFunction`, same technique as `prepare-milestone-preparation-e2e.test.mjs`) through every
DIR-125 acceptance scenario with a scripted mock `agent()`, asserting on REAL dispatch counts:

| Scenario | Assertion |
|---|---|
| 2 blocking → 1 blocking → 0 | exactly 2 authors / 1 adjudicator / 2 revisions / 3 reviews; reaches `prepared` |
| Persistent blocker | stops at cap (1 full + 2 delta); `needs-human`; no 4th review dispatched |
| `highRisk` extra round | exactly 3 delta rounds (not the ordinary 2); reaches `prepared` |
| Caller requests `maxDeltaRounds:10` (`highRisk`) | clamped to 3, never honored above the ceiling |
| Caller requests `maxDeltaRounds:1` | honored (callers may lower, not raise) |
| Mixed blocker + plan/backlog/accepted-risk | blocks only until the blocker resolves; all 4 dispositions retained in the final ledger |
| 3 blocking findings, one subsystem | explicit split recommendation before any revise/delta-review dispatch |
| Soft budget (deterministic injected clock) | budget exceeded on round-1 admission check; zero revisions dispatched; `elapsedMs` recorded |
| DIR-120-shaped replay (6 real finding classes) | 1 full synthesis + 1 delta round reaches `prepared`, all 6 typed dispositions retained — not 10 syntheses |

Each scenario's `checkPreparation()`/`computeMetricsForReceipt()` output was independently
re-verified against the real receipt file the mocked Receipt phase actually wrote (not the mock's
self-report).

Full experiments-tree glob (`experiments/quay-perpetual-stream/test/*.test.mjs`, 279 files) run
clean except one PRE-EXISTING, unrelated failure:
`chart2-s2-delivery-completeness.test.mjs`'s "CLI: explicit repoRoot arg → cov 0.0" test expects
`cov = 0 (0/3)` against the real repo but the repo's actual delivery-completeness state is now
`cov = 1 (3/3)` — untouched by this milestone (git blame: `e70a101`, DIR-064-A), a drift between
that test's fixture expectation and the repo's real current publish state.

`bash plugin/scripts/sync-vendor.sh --check` reports `CLEAN: all files verified, no drift detected`
including the new `scripts/proposal-convergence.ts` entry.

**`scripts/test.sh` (the canonical `packages/*/test + plugin/test` glob) — evidence gathered
per-file, not as one clean full-suite run.** This session's machine was under heavy external
contention throughout the build (uninvolved concurrent sessions/processes; `uptime` load average
18–24 on what is otherwise a modest box), which made three attempted full-suite runs either take
>30m or produce spurious 60s-acceptance-timeout failures in `ts-typecheck-gate.test.mjs` (real
`npx tsc --noEmit` / real gate dispatch, unrelated to this milestone's files) purely from CPU
starvation. Re-running `ts-typecheck-gate.test.mjs` + `delivery-standalone-smoke-gate.test.mjs` in
isolation (no contention) passed 12/12 — confirming those are environment flakes, not a DIR-125
regression. One REAL regression was found this way and fixed:
`plugin/test/plugin-packaging.test.mjs`'s hardcoded `SYNC_SCRIPTS` count assertion (21 → 22, since
`proposal-convergence` was added) — verified passing 34/34 in isolation after the fix. Every other
`packages/*/test` + `plugin/test` file this milestone touches or could plausibly affect
(`execute-milestone-preparation-gate.test.mjs` 14/14, `prepare-milestone-preparation-e2e.test.mjs`
2/2, `prepare-milestone-convergence.test.mjs` 18/18, `plugin-packaging.test.mjs` 34/34) was run
individually, contention-free, and passes. No full, single, contention-free `scripts/test.sh`
invocation was obtained this session; the per-file evidence above is offered explicitly as a
substitute, not silently presented as equivalent to one.

## Documentation updated

- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — `prepare(c)` bullet now names the DIR-125
  stopping rule explicitly (one full synthesis, bounded delta rounds, soft budget, split
  checkpoint, non-blocking disposition durability) so a future reader never re-derives "restart on
  any nonzero finding" from stale prose.
- `.claude/skills/quay-task-to-plan/SKILL.md` / `plugin/skills/quay-task-to-plan/SKILL.md`
  (byte-identical) — contract 4 gains a note cross-referencing `prepare-milestone.js` as the
  canonical bounded-ProposalReview mechanism, so the two documents cannot re-diverge on the
  stopping rule the way ProposalReview and PlanCheck once did.

## AC/DoD coverage — honest disposition

All ten task Acceptance Criteria have real fixture/test evidence per the table above and the
receipt-side mechanical checks. Two items called out explicitly rather than silently assumed:

- **Metrics "mechanically queryable per candidate"**: satisfied via
  `computeMetricsForReceipt`/`--metrics`, unit-tested directly (3 tests) — not yet exercised against
  a REAL multi-hour `prepare-milestone` run (no such run has happened since this landed; that
  operational proof is inherently a later, real-usage event, consistent with DIR-117-B's own
  still-open real-landing scope for the base preparation lifecycle).
- **Rollout-baseline targets** (p50 20–25m, p90 <=60m, wall-ratio <=35%, attempts-per-task <=1.10)
  named in the task's DoD are targets for FUTURE real dispatches to be measured against — this
  iteration lands the mechanism and its instrumentation surface; it does not itself constitute the
  baseline measurement (there is no real post-DIR-125 `prepare-milestone` dispatch yet to measure).

AC checkboxes in `tasks/DIR-125.md` are left UNCHECKED per DIR-020 (¬self-tick — checkboxes are
ticked only by the adversarial Audit phase, never by the build step that implements them).

## Files touched

```
 .claude/skills/quay-task-to-plan/SKILL.md            |   1 +
 .claude/workflows/prepare-milestone.js               | 243 ++++++++++++++---
 experiments/quay-perpetual-stream/OUTER-LOOP.md      |  27 +-
 .../fixtures/preparation/dir120-replay-findings.json | new
 .../scripts/milestone-preparation-check.ts           | 112 +++++++-
 .../scripts/proposal-convergence.ts                  | new
 .../test/milestone-preparation-check.test.mjs        | 172 +++++++++++
 .../test/proposal-convergence.test.mjs               | new
 plugin/scripts/milestone-preparation-check.ts        | 112 +++++++-
 plugin/scripts/proposal-convergence.ts               | new
 plugin/scripts/sync-vendor.sh                        |   1 +
 plugin/skills/quay-task-to-plan/SKILL.md             |   1 +
 plugin/test/prepare-milestone-convergence.test.mjs   | new
 plugin/test/prepare-milestone-preparation-e2e.test.mjs |  23 +-
 plugin/workflows/prepare-milestone.js                | 243 ++++++++++++++---
 tasks/DIR-125.md                                     |   4 + (extra.acceptance)
```
