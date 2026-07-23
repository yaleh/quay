# Charter M125-dir062-a-drivable-workspace-gate — DIR-062 child A halt-free mechanism

**Milestone id:** M125
**Task:** `tasks/DIR-062-A.md`
**Surface:** development-class / governance-integrity (chart-2 S3 External-validation reach)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`4a551e2`, DRAIN status-note commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-062 (tightened `human-steered` semantics) split into a halt-free mechanism child (this one) and a
human-steered driver-wiring child (DIR-062-B). This milestone builds the MECHANISM only: two standalone
scripts under `experiments/quay-perpetual-stream/scripts/`, neither touching a driver file.

## Scope

1. `drivable-workspace-check.ts` (+ `.sh` thin wrapper, mirrors the `it0-dod-check.sh`/`.ts` shape) —
   a fail-closed gate: given one or more workspace paths, PASS (exit 0) iff EVERY path is covered by
   `drivable-workspaces.yml` (under `authorized_root`, or an explicit `workspaces[]` entry), FAIL
   closed (exit 1) otherwise — absent registry, unreadable, or an uncovered path all fail closed.
2. `human-steered-classify.ts` — a pure function computing a task's `human-steered` verdict from the
   3 DIR-062 clauses: (1) touches a driver file (OUTER-LOOP.md / inherited-core.md / the loop's own
   skills under `.claude/skills/`); (2) a declared mission-redirection flag; (3) drives a workspace
   not covered by the registry (reuses check #1's logic as a library function, not a subprocess).
3. Register the `drivable-workspace` gate in BOTH `.quay/gates.yml` and `.quay/config.yml` (`it0[]`
   entry, mirroring the existing 5 it0-gate entries).
4. Fixture-first ≥80%-coverage sibling tests for both scripts.

**Not in scope:** SELECT-wiring (using the classifier to actually exclude human-steered candidates —
already done via the existing `label:human-steered` convention) or the `inherited-core.md` definition
edit — both are DIR-062-B, human-steered, explicitly out of this child's scope.

## Class routing

**Development-class** (2 new load-bearing scripts + tests + gate-data registration, no driver file
touched). No `quay-task-to-plan` pipeline required — mirrors the DIR-064-A precedent (its own sibling
halt-free child, same shape: cov-calculator scripts + fixtures + tests, dispatched directly).

## Acceptance Criteria (from task)

- [ ] `drivable-workspace-check` FAILs closed (non-zero) for a fixture task targeting a path NOT under `authorized_root` (e.g. `/tmp/x`), and PASSes (0) for one targeting `/home/yale/work/archguard` — both fixtures run, both verdicts pasted.
- [ ] `human-steered-classify` returns `humanSteered:true` for a fixture that edits `OUTER-LOOP.md`, `true` for a mission-redirection-flagged fixture, `true` for one driving an unlisted workspace, and `false` for one driving only `/home/yale/work/*` with no driver edit — pasted.
- [ ] Both scripts have a sibling `*.test.mjs`; `node --test <the two tests>` exits 0; each ≥80% line coverage (figures pasted).
- [ ] The `drivable-workspace` gate is registered in BOTH `.quay/gates.yml` and `.quay/config.yml` (grep → present in both); `quay gate --list` includes it.
- [ ] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green.

## Definition of Done

- [ ] Both scripts land as real load-bearing scripts with passing sibling tests (≥80%), verified by real `node --test` runs (pasted), and `loadbearing-test-gate.sh` PASSes.
- [ ] The `drivable-workspace` gate produces a real GateEvent (PASS on a listed target, FAIL on an unlisted one) via `quay gate` — pasted.
- [ ] This child touches NO driver file — verifiable by `git show --stat` on its landing commit.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M124 —
`exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
