# Charter M118-arch-audit-post-dir058-explore — post-DIR-058 architecture audit (mandatory explore)

**Milestone id:** M118
**Task:** `tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md`
**Surface:** methodology-class / explore (discovery/instrument-correction)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`0c32db0`, M117's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore per the ≥1/5 rule: M114–M117 are 4 consecutive exploits since the M113 explore
reset. DIR-058 closed at M117 — every product `.js` file under `packages/**` is now `.ts` (bar 2
permanently-exempted SEA shims). This is the FIRST time archguard's TypeScript-based structural
instrument can see the entire product across all 4 packages in one analysis; every prior audit
(M93/M98/M108/M113) was structurally incomplete by construction, excluding whatever wasn't yet
migrated (bin/ entrypoints, the entire quay-backlog package). This genuinely grows the reusable
structural-analysis core rather than re-treading an old surface — the correct shape for an explore.

## Scope

Read-only archguard sweep, FILE-ONLY (explore never fixes):
1. Fresh `archguard_analyze` + `archguard_summary` (scope=`packages/`, `noCache:true`) — official
   full-product baseline (all 4 packages, no dark files).
2. God-package / god-function detection across the full scope.
3. Cycle detection across the full scope.
4. Administrative cleanup: verify + resolve the stale `status: todo`-despite-ticked-boxes bookkeeping
   gap on `PROBE-M98-001` and `exp5-M-ARCH-AUDIT-M98-EXPLORE` (flagged at M115/M116/M117 SELECT).
5. File any NEW confirmed findings behind `routine-file-gate.ts`.

**Out of scope:** any fix to a finding (explore never fixes — a fix, if warranted, becomes its own
future exploit milestone).

## Class routing

**Methodology-class / explore** — read-only analysis + task filing, no product code touched. No
`quay-task-to-plan` pipeline required (matches M93/M98/M108/M113 precedent).

## Acceptance Criteria (from task)

- [ ] Fresh archguard analysis run on current `master` HEAD, scope=`packages/`, `noCache:true`; entity/relation counts recorded as this milestone's official full-product baseline.
- [ ] God-package + god-function metrics measured across the FULL scope; any new finding filed.
- [ ] `PROBE-M98-001` and `exp5-M-ARCH-AUDIT-M98-EXPLORE`'s stale bookkeeping resolved (flipped `done` or annotated superseded).
- [ ] Any new genuine findings filed as milestone-candidate tasks, gated through `routine-file-gate.ts`.
- [ ] FILE-ONLY invariant held.

## Definition of Done

- [ ] Archguard re-run output pasted in the ABSORB entry; comparison vs M113/M117 partial baselines.
- [ ] All new findings' `routine-file-gate.ts` disposition pasted as evidence.
- [ ] FILE-ONLY confirmed via `git show --stat`.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116/M117 — `exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
