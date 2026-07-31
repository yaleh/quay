# M209 — gap-touches-orthogonality-symlink-isdirect-mismatch: symlink `isDirect` guard fix for 5 mirrored scripts

**Task:** gap-touches-orthogonality-symlink-isdirect-mismatch · **Class:** development
**Value type:** defectFix · **Deliverable:** yes · **Charter tokens:** ~0.1 K
**type:** execution · **highRisk:** no

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (defect-fix, deliverable). 5 `experiments/quay-perpetual-stream/scripts/`-mirrored
scripts (`touches-orthogonality-check.ts`, `anti-drift-touches-check.ts`, `routine-file-gate.ts`,
`routine-scheduler.ts`, `serial-fanin-absorb.ts`) are dead code via their symlink invocation path
— the `isDirect` guard compares `process.argv[1]` (symlink path) against
`fileURLToPath(import.meta.url)` (realpath-resolved target), which never match. Result: `main()`
never runs; CLI silently exits 0. Confirmed independently on clean `master`. Fix: reuse the
`fs.realpathSync`-based `isDirectInvocation()` helper already landed for
`config-wiring-check.ts`/`concurrent-batch-scheduler.ts`, plus a repo-wide symlink-enumeration
regression test.

## Scope

Per `tasks/gap-touches-orthogonality-symlink-isdirect-mismatch.md`'s own Requested action /
Acceptance Criteria / Definition of Done — not duplicated here. Mechanical, same-shape fix across
5 files, already precedented.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD. Real command output proves all 5 scripts behave identically via both
invocation paths. The repo-wide symlink-enumeration regression test catches future recurrences.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
