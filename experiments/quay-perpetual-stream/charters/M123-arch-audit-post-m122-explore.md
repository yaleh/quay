# Charter M123-arch-audit-post-m122-explore — post-M121/M122 architecture audit (mandatory explore)

**Milestone id:** M123
**Task:** `tasks/exp5-M-ARCH-AUDIT-POST-M122-EXPLORE.md`
**Surface:** methodology-class / explore (discovery/instrument-correction)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`dda7b8c`, M122's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Mandatory explore per the ≥1/5 rule: M119–M122 are 4 consecutive exploits since the M118 explore
reset. M121 (`gate/registry.ts` dual-mode `__dirname` fix) and M122 (`release.yml` CI extension +
Windows dotglob archiving fix) both touched real product/infra code — a fresh archguard sweep
confirms neither introduced a structural regression before the loop continues exploiting.

## Scope

Read-only archguard sweep, FILE-ONLY (explore never fixes):
1. Fresh `archguard_analyze` + `archguard_summary` (scope=`packages`, `noCache:true`).
2. Cycle detection across the same scope.
3. Compare against the M113/M117/M118 baseline (entities=144/relations=201, 0 cycles).
4. File any NEW confirmed findings behind `routine-file-gate.ts`.

**Out of scope:** any fix to a finding (explore never fixes).

## Class routing

**Methodology-class / explore** — read-only analysis, no product code touched. No `quay-task-to-plan`
pipeline required (matches M93/M98/M108/M113/M118 precedent).

## Acceptance Criteria (from task)

- [ ] Fresh `archguard_analyze` (scope=packages, noCache:true) + `archguard_summary` run on current
  master HEAD; entity/relation counts recorded and compared against the M113/M117/M118 baseline.
- [ ] Cycle detection run across the same scope; result recorded.
- [ ] Any new genuine findings filed as milestone-candidate tasks, gated through `routine-file-gate.ts`.
- [ ] FILE-ONLY invariant held (no product code touched).

## Definition of Done

- [ ] All 4 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M122 —
`exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
