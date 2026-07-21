---
id: DIR-044-LIVE
title: "DIR-044 terminal proof: run a REAL ≥2-wide orthogonal batch via native
  Agent(run_in_background=true) builds + serial fan-in on exp5's own loop —
  the live end-to-end run the M74 mechanism was golden-replayed against but never
  actually dispatched. Human-steered (driver dispatch + un-halt)."
status: todo
labels:
  - directive
  - milestone-candidate
  - human-steered
parent: DIR-044
children: []
extra:
  dirStatus: pending
  schema: v1
---
## Proposal
Close [[DIR-044]]'s one open DoD item. M74 landed and adversarially-audited the deterministic
concurrent-scheduler MECHANISM (orthogonality → batch → fan-in → anti-drift) and proved it via a
golden-replay of the RECORDED DIR-039 ∥ DIR-042-A diffs — but never dispatched a LIVE background-subagent
batch. This task performs that real run once the preconditions exist:
- **wire the driver** to consume the scheduler's plan (`concurrent-batch-scheduler.mjs`) and, for each
  batched candidate, spawn a native `Agent(run_in_background=true)` build in its own worktree (build
  defers ALL shared-state writes), then run the serial fan-in (`serial-fanin-absorb.mjs`) and the
  after-the-fact `anti-drift-touches-check.mjs`;
- **run it for real** on two ready, touches-disjoint execution-type milestone-candidates (declared
  `## Touches`, orthogonality check PASS), with `milestone_counter` advancing by N and both dashboard
  entries appended, NO merge conflict.

This is the DIR-026 "real object through the mechanism" that M74 honestly deferred. Human-steered: it
dispatches live background builds and mutates the driver's dispatch path; it must run under DIR-027
hygiene and must NOT be fabricated (a golden-replay is not a live run).

## Plan
N/A — a single integration+run milestone. Preconditions: two real ready disjoint milestone-candidates
exist (or are authored) and the loop is un-halted for this pass. The mechanism scripts already exist
(M74); this task wires them into the driver's dispatch path and exercises them live once.

## Finding
M74 (charter `charters/M74-dir044-concurrent-scheduler.md`) delivered the mechanism (78 tests, 3-round
audit, golden-replay exit 0) but its DoD item 1 — "a REAL ≥2-wide batch actually RAN via native
background subagents on exp5's own loop" — is unmet: the scheduler computes the dispatch PLAN; the
live `Agent(run_in_background)` dispatch is the DRIVER's job and was never exercised. The gap is real
and was recorded honestly rather than ticked.

## Requested action
1. Wire the loop driver to dispatch background builds from the scheduler's plan (one worktree per
   batched candidate; build writes NO shared state during the parallel phase).
2. Run a real ≥2-wide orthogonal batch; capture the concurrent dispatch + serial fan-in in the
   milestone record (counter +N, both dashboard entries, no conflict).
3. Run `anti-drift-touches-check.mjs` on the actually-touched file-sets after the fact; it must PASS
   (real disjoint) — and its guardrail remains the backstop if a declaration was wrong.

## Acceptance Criteria
- [ ] The driver dispatches N native `Agent(run_in_background=true)` builds from the scheduler's plan, one worktree each; a check confirms NO build wrote a shared-state file during the parallel phase.
- [ ] A REAL ≥2-wide orthogonal batch ran and fan-in ABSORBed cleanly on exp5's own loop: `milestone_counter` advanced by N, both dashboard entries present, NO merge conflict — pasted in the milestone record (DIR-026 real object, not a golden-replay).
- [ ] `anti-drift-touches-check.mjs` run on the ACTUAL post-run file-sets → PASS (genuinely disjoint); a deliberately mis-declared trial → HARD FAIL (guardrail still bites live).
- [ ] Native-only (no manda); learning-type candidates were not batched.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts. Done ONLY when:
- [ ] The live ≥2-wide run actually happened (real background subagents, real fan-in, real counter +N) — the DIR-044 parent's open DoD item 1 is now satisfiable and ticked; DIR-044 is marked done.
- [ ] The driver dispatch path is single-sourced against the M74 mechanism scripts (no re-implementation); the it0 DoD meta-enforcer passes.
- [ ] Human-steered + DIR-027 hygiene held; no fabricated/golden-replay stand-in was passed off as the live run.

## Human verification when exp5 marks this DIR done
1. Did two real disjoint milestones actually run as concurrent background subagents (subagent session files exist), not a replay?
2. Did the fan-in advance `milestone_counter` by N with both dashboard entries and no conflict?
3. Did anti-drift PASS on the real post-run file-sets, and still bite a deliberately mis-declared trial?
4. If the "live run" was actually a golden-replay of recorded diffs, it is NOT landed — send back.
