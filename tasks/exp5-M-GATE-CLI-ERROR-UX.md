---
id: exp5-M-GATE-CLI-ERROR-UX
title: "QENG gate/lifecycle CLI surface: replace raw stack traces on
  guarded-error paths with clean one-line messages, and fix quay run's
  exit-code leak on a fixpoint stop that included a failed task"
status: todo
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Materialized at the M37-discover-post-qeng discovery milestone (2026-07-19), from direct exercise of
the QENG-1..4 gate/lifecycle/driver CLI surface (`packages/quay/src/gate/*.js`,
`packages/quay/bin/quay.js`) in a live sandbox workspace — not from reading code alone.

## Source
Live CLI reproduction, this milestone's report (`report.iteration-0.md`, "QENG survey" section).

## Value type / cadence
exploit (UX/robustness fix on an already-shipped, real CLI surface).

## Findings (live-reproduced, not inferred from code reading)

**1. Guarded-error paths on `promote`/`retreat`/`gate` throw uncaught, surfacing a raw Node stack
trace to the user, unlike `complete`'s clean one-line `FAIL — <reason>` / precondition message.**
Reproduced directly:
```
$ node bin/quay.js retreat SURVEY-1 --reason x   # task already at todo (illegal back edge)
Error: illegal transition: todo cannot back
    at assertTransition (.../src/gate/lifecycle.js:57:11)
    at runRetreat (.../src/gate/lifecycle.js:206:3)
    ... (5 more stack frames)
```
Same pattern reproduced for `promote <done-task>` (`illegal transition: done cannot forward`),
`gate <id> --gate bogus` (`unknown gate: bogus`, from `engine.js:30`), and `gate <nonexistent-id>`
(`no such task: <id>`, from `engine.js:32`). This is DELIBERATE per `bin/quay.js` line 21's own
comment ("Illegal transitions throw → the top-level catch reports them") and the top-level
`main().catch()` handler (`bin/quay.js` lines 920-924) — so it is not a crash, but it is a UX
inconsistency: `complete`'s analogous guarded-precondition-reject path
(`lifecycle.js` `runComplete`, "not-ready" branch) prints a clean `console.log(reason)` +
`process.exitCode = 1` with NO stack trace, while `promote`/`retreat`'s illegal-transition path and
`gate`'s unknown-gate/missing-task path both go through the generic top-level catch instead. A human
or agent driving this CLI sees a Node internals dump for what is, in every one of these cases, a
well-understood, already-named error condition (the message string itself is exactly right — only
the *presentation* is inconsistent).

**2. `quay run` (the full loop, not `--once`) leaks `process.exitCode` from the LAST failed task's
`runComplete` call even when the loop reaches a clean `fixpoint` stop.** Reproduced directly: a
2-task board (one task with a real failing acceptance meter `false`, one `ready` task with NO
acceptance meter set at all, correctly skipped as non-actionable per the anti-spin design) —
```
$ node bin/quay.js run
FAIL — acceptance failed (exit 1)
run: 0 completed in 1 iters (stop=fixpoint)
$ echo $?
1
```
Compare an all-passing board:
```
$ node bin/quay.js run
PASS — status=done
PASS — status=done
run: 2 completed in 2 iters (stop=fixpoint)
$ echo $?
0
```
`bin/quay.js`'s `run` handler (non-`--once` branch, around line 907) only explicitly sets
`process.exitCode = 1` for the `cap` stop ("only the safety ceiling is nonzero" per its own inline
comment) — implying `fixpoint`/`sentinel` stops are meant to exit 0 regardless of whether individual
tasks failed along the way (this is what the loop is FOR: observe, log, and move on to other
actionable work, matching the anti-spin design's own stated philosophy). But `runComplete` (called
inside `runLoop`, `driver.js`) unconditionally sets `process.exitCode = 1` on an acceptance-gate fail
(this is CORRECT and desired for `--once`, which explicitly resets it back to 0 afterward per the
inline comment at `bin/quay.js` ~line 903-906) — the non-`--once` `run` branch has no equivalent
reset, so a fixpoint stop that included ANY failed task along the way silently inherits exit 1,
indistinguishable from a real `cap`-ceiling hit by exit code alone (only the printed `stop=` text
differentiates them). A caller scripting against `quay run`'s exit code (e.g. a CI step, or a future
outer-loop automation) cannot currently tell "ran to a clean fixpoint, some individual tasks just
weren't ready yet" from "hit the safety ceiling" without parsing stdout text.

Both findings are real, reproducible, currently-shipped behavior — not speculative or invented for
this task's sake.

## Acceptance Criteria
- [ ] `promote`/`retreat`'s illegal-transition throws, and `gate`'s unknown-gate/missing-task throws,
  produce a clean one-line error message (mirroring `complete`'s existing "not-ready" precondition
  message shape: no stack trace) instead of falling through to the generic top-level catch — OR, if
  the decision is to keep the stack-trace behavior deliberately (e.g. because these ARE genuinely
  exceptional/programmer-error conditions distinct from `complete`'s expected-and-common precondition
  case), that decision is explicitly documented with a stated reason, not left as an undocumented
  inconsistency.
- [ ] `quay run` (non-`--once`) exits 0 on a `fixpoint` or `sentinel` stop regardless of whether any
  individual task failed its acceptance gate along the way, and exits nonzero ONLY on the `cap`
  ceiling — matching the handler's own existing inline comment's stated intent. A regression test
  reproduces the exact scenario in this task's Finding 2 (mixed pass/fail board reaching fixpoint)
  and asserts exit code 0.
- [ ] Both fixes are covered by new or extended tests in `packages/quay/test/lifecycle.test.mjs` /
  `packages/quay/test/driver.test.mjs` (or a new test file), run against real CLI invocation (not
  just the underlying `run*`/`runLoop` functions in isolation), and the existing gate/lifecycle/driver
  suite (currently 89+ tests, 100% line/func coverage on all 7 `src/gate/*.js` files per this
  milestone's independent coverage run) continues to pass with no regression.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv, 7 test-floor — APPLIES, `surface:cli` is product-touching, ≥80% coverage disposition or a
stated waiver required). No task-specific exemption from any clause.
- [ ] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).

## Not selected (M51)
Considered at M51 SELECT (2026-07-20) alongside `exp5-M-GATE-README-DOCS` and
`exp5-M-GATE-MCP-PARITY-GAP`, against `exp5-M-GATE-HELP-SYNOPSIS-GAP` (the winner). Per checkpoint
cp-50's recommendation to break a 5-milestone exploit-typed-pick drought, M51 picked the smallest,
most concrete, directly VT-moving exploit-typed fix available — a ~15-line, mechanically-testable
CLI-help synopsis gap. This CLI error-UX fix is real and exploit-typed, but larger in scope (two
distinct findings — error-message presentation and an exit-code leak — each needing new/extended
tests in `lifecycle.test.mjs`/`driver.test.mjs`) than the synopsis fix. Remains a live
`milestone-candidate` for a future SELECT.
