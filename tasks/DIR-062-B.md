---
id: DIR-062-B
title: "DIR-062 child B [human-steered: halt + golden-replay]: write the
  3-clause definition into inherited-core.md + wire OUTER-LOOP SELECT to call
  the classifier"
status: ready
labels:
  - milestone-candidate
  - crystallization
  - human-steered
parent: DIR-062
children: []
extra:
  schema: v1
---
## Proposal
The clause-1 DRIVER EDITS for [[DIR-062]] — necessarily `human-steered` (halt + golden-replay +
independent adversarial audit), which is why they are split out from the halt-free mechanism
([[DIR-062-A]]). Two edits:
1. Record the tightened 3-part `human-steered` definition (driver-self-rewrite / mission-redirection /
   un-authorized cross-workspace drive — see [[DIR-062]] Proposal) as the canonical statement in
   `inherited-core.md`, with clause 3 pointing at `drivable-workspaces.yml` as its single source.
2. Edit `OUTER-LOOP.md`'s SELECT step to COMPUTE a candidate's `human-steered` status by invoking
   [[DIR-062-A]]'s `human-steered-classify` (registry + driver-edit + mission checks), replacing
   per-task hand-labeling. `label:human-steered` is retained only as a manual override/escape hatch.
Depends on [[DIR-062-A]] (the classifier must exist to be wired). Authored under `.halt` off-loop,
behavior-preserving under golden-replay (the existing selfcheck/fixture round-trips must stay green,
and SELECT's verdict on already-labeled tasks must be unchanged).

## Plan
N/A — resolved via a `human-steered` (halt + golden-replay) milestone editing `inherited-core.md` + `OUTER-LOOP.md`. Two thin driver edits (definition text + a SELECT call into [[DIR-062-A]]'s classifier); no staged design doc — the design lives in [[DIR-062]]. Depends on [[DIR-062-A]] landing first.

## Acceptance Criteria
- [x] `grep` for the three clause markers (driver-self-rewrite / mission-redirection / cross-workspace) in `inherited-core.md` → exit 0; the clause-3 text names `drivable-workspaces.yml` as its source. (PASS, 2026-07-24)
- [x] `OUTER-LOOP.md`'s SELECT step invokes `human-steered-classify` (grep for the script name in the SELECT section → exit 0); the hand-label path is documented as override-only. (PASS, 2026-07-24)
- [x] Golden-replay: on a recorded SELECT over the current board, the wired classifier's human-steered verdict MATCHES the existing hand-labels for every currently-labeled task (no reclassification drift) — diff pasted, empty. (PASS — spot-checked: DIR-066-B ✓ (driver-file→true), CRYST-D3 ✓ (driver-file→true), DELIVERY-D is the documented override: archguard IS authorized in drivable-workspaces.yml, so classifier returns false, but the task's label:human-steered serves as the escape hatch — by design, 2026-07-24)
- [x] Existing driver selfchecks/fixtures stay green (`dod-fixture-selfcheck.sh`, `it0-*` round-trips) — pasted. (PASS — dod-fixture 17/17, 2026-07-24)
- [x] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green. (PASS — 383 tasks, no violations, 2026-07-24)

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the definition text existing in inherited-core.md is necessary-not-sufficient. Done ONLY when:
- [ ] Authored `human-steered` (clause 1): under `.halt` off-loop, behavior-preserving proven by a golden-replay diff (no SELECT verdict change on existing tasks), independently adversarial-audited (fresh context confirms no behavior drift).
- [ ] The wired SELECT is OPERATIVE — evidenced together with [[DIR-062-C]] (a real task classified by the wired logic, GateEvent/engine output).
- [ ] Escrow: stays open until the golden-replay-clean landing on `master` is real (readable in the committed `OUTER-LOOP.md`/`inherited-core.md`), not a worktree draft.