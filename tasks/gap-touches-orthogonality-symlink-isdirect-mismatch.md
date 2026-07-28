---
id: gap-touches-orthogonality-symlink-isdirect-mismatch
title: "gap: 5 experiments/-mirrored scripts are dead code via their symlink
  invocation path (isDirect realpath mismatch) — touches-orthogonality-check.ts,
  anti-drift-touches-check.ts, routine-file-gate.ts, routine-scheduler.ts,
  serial-fanin-absorb.ts"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Fix the `isDirect` CLI-entrypoint guard in 5 `experiments/quay-perpetual-stream/scripts/`-mirrored
files (`touches-orthogonality-check.ts`, `anti-drift-touches-check.ts`, `routine-file-gate.ts`,
`routine-scheduler.ts`, `serial-fanin-absorb.ts`) to compare realpath-resolved forms instead of raw
strings, using the same `fs.realpathSync`-based helper already landed for
`config-wiring-check.ts`/`concurrent-batch-scheduler.ts`, plus a repo-wide symlink-enumeration
regression test so a future instance of this pattern is caught mechanically. See `## Finding`/
`## Requested action` below for full root cause, real reproduction, and scope.

## Plan

N/A — directive resolved via a human-steered milestone is not required here (no
`.claude/workflows/*.js` or `inherited-core.md`/`OUTER-LOOP.md` touched); this is a mechanical,
same-shape fix already precedented by `gap-config-wiring-check-symlink-noop`. No separate
`docs/plans/*.md` needed — reuse that task's landed fix pattern.

## Finding

`experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts`,
`anti-drift-touches-check.ts`, `routine-file-gate.ts`, `routine-scheduler.ts`, and
`serial-fanin-absorb.ts` (and their `.sh` wrappers where present) are symlinks into
`plugin/scripts/` (e.g. `touches-orthogonality-check.ts -> ../../../plugin/scripts/
touches-orthogonality-check.ts`). Each file's `isDirect` guard is:

```js
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
```

`fileURLToPath(import.meta.url)` resolves to the symlink TARGET (Node's ESM loader realpath-
resolves), i.e. `/…/plugin/scripts/touches-orthogonality-check.ts`, while `process.argv[1]` is
whatever path was used to invoke node (the symlink path under `experiments/…/scripts/`, absolute
or relative). These never compare equal when the script is invoked via its `experiments/…/scripts/`
symlink (the path every existing selfcheck — and `gate_delegate_ts` in `gate-script-lib.sh` — uses).
Result: `main()` never runs; the CLI silently exits 0 with **no output at all**, regardless of the
real verdict.

**Confirmed independently, on a clean `master` (not caused by DIR-113):**
```
$ git stash   # remove all DIR-113 working-tree changes
$ bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh
PASS: clean-batch — exit 0 (expected 0)
FAIL: mis-declared-overlap-BITES — exit 0 EXPECTED 1
FAIL: stray-write-BITES — exit 0 EXPECTED 1
FAIL: overbroad-declaration-BITES — exit 0 EXPECTED 1
$ git stash pop
```
Same failure shape reproduces for `touches-orthogonality-selfcheck.sh` (4/6 fixtures wrongly
report exit 0) — re-confirmed live 2026-07-28: `node --experimental-strip-types
experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md`
produces zero output and exit 0/1, while the real `plugin/scripts/touches-orthogonality-check.ts`
path prints the correct OVERLAP/DISJOINT verdict. Invoking the REAL file directly works correctly —
this is purely an invocation-path artifact of the symlink migration (see commit "fix: mirror
gate-script-lib.sh into plugin/scripts/ — task-schema-check.sh was broken", 66647b4), not a logic
bug in the checks themselves.

**Scope update (2026-07-28, merged from `gap-symlink-mirror-noop-affects-5-more-scripts`, filed and
then found duplicative the same day):** a repo-wide sweep of every symlink under
`experiments/quay-perpetual-stream/scripts/` for the same `process.argv[1] ===
fileURLToPath(...)`-shaped guard found `routine-file-gate.ts`, `routine-scheduler.ts`, and
`serial-fanin-absorb.ts` also affected — none covered by this task's original scope or by the
`concurrent-batch-scheduler.ts` fix below. **`concurrent-batch-scheduler.ts` itself, originally
named in this task's scope, is REMOVED here — it was already fixed** (real
`fs.realpathSync`-based `isDirectInvocation()` helper, confirmed via `gap-config-wiring-check-
symlink-noop`'s M-DIR119-C-CANARY audit, 2026-07-27) and is out of scope for this task now.

**Severity**: `touches-orthogonality-check.ts` and `anti-drift-touches-check.ts` are the DIR-044/
DIR-107 concurrent-batch-scheduler safety-net checks (touches-orthogonality pre-flight + the
anti-drift-touches PRE-MERGE hard gate). Their fixture selfchecks currently cannot detect a real
regression in the underlying logic via the documented invocation path — a fixture case that SHOULD
fail (`mis-declared-overlap-BITES`, `stray-write-BITES`, `overbroad-declaration-BITES`) silently
reports exit 0/PASS instead. The other 3 scripts are routine/fan-in scheduling infrastructure with
the identical defect shape, discovered by pattern sweep rather than by an observed failure.

## Requested action

1. Fix the `isDirect` guard in all 5 affected `.ts` files (or the shared pattern, if consolidated)
   to compare against the REALPATH of `process.argv[1]` (e.g. `fs.realpathSync(process.argv[1])`)
   rather than the raw invocation string, so it matches regardless of which path (symlink or real
   file) was used to invoke it — the same `fs.realpathSync`-based `isDirectInvocation()` helper
   already landed for `config-wiring-check.ts`/`concurrent-batch-scheduler.ts`, reused rather than
   reinvented. `select-preflight.ts` and `derive-touches-heuristic.ts` (DIR-113) already use
   `path.resolve(process.argv[1])`-style normalization and are NOT affected by this class, but even
   `path.resolve` alone would not fix THIS specific symlink case (needs realpath, not just
   absolute-ification) — verify the fix with the same `git stash`-style before/after reproduction.
2. Add a single repo-wide regression test that enumerates every symlink under
   `experiments/quay-perpetual-stream/scripts/` pointing into `plugin/scripts/` (not a hardcoded
   5-script list) and asserts non-silent, output-identical behavior between the mirror and real
   invocation paths for each — so a 6th future instance of this exact pattern is caught
   mechanically instead of by accidental discovery, the way this task's own scope update was found.

## Acceptance Criteria

- [ ] `anti-drift-touches-selfcheck.sh`, `touches-orthogonality-selfcheck.sh`, and the equivalent
  selfcheck/direct invocation for `routine-file-gate.ts`, `routine-scheduler.ts`, and
  `serial-fanin-absorb.ts` all PASS when invoked via their documented
  `experiments/quay-perpetual-stream/scripts/*` path (not just via the `plugin/scripts/` real path)
  — shown with real command output, not asserted.
- [ ] A fixture case that should fail (e.g. `mis-declared-overlap-BITES`) actually reports non-zero
  when invoked through the symlink path — proven, not asserted.
- [ ] A single repo-wide test enumerates every `experiments/quay-perpetual-stream/scripts/*` symlink
  target and asserts mirror-path invocation is non-silent for all of them — RED against at least one
  of the 5 real scripts before the fix, GREEN after; written so a script added later with the same
  vulnerable guard shape is caught automatically (enumerates symlinks, does not hardcode names).
- [ ] Real code inspection confirms all 5 fixed scripts reuse the SAME `fs.realpathSync`-based
  `isDirectInvocation()` helper (comparing `fs.realpathSync(process.argv[1])` against the module's
  own real path) already landed for `config-wiring-check.ts`/`concurrent-batch-scheduler.ts`, rather
  than a second reinvented implementation — shown via a diff/grep, not asserted.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, script changes alone do not satisfy this — real before/after command output for all 5
scripts is required, not asserted.

- [ ] Landed on `master`, verified via real command output for all 5 scripts.
- [ ] The repo-wide symlink-enumeration regression test is real and independently re-run, not just
  described.

## Human verification when exp5 marks this task done

1. Do all 5 named scripts now behave identically via both invocation paths?
2. Does the new regression test enumerate symlinks (catching future recurrences) rather than
   hardcoding today's 5 script names?
3. Was the stale `concurrent-batch-scheduler.ts` scope item correctly dropped (already fixed
   elsewhere), not silently re-fixed or re-tested redundantly?

## Touches

- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/routine-file-gate.ts
- plugin/scripts/routine-scheduler.ts
- plugin/scripts/serial-fanin-absorb.ts
- experiments/quay-perpetual-stream/test/*symlink*mirror*.test.mjs (or sibling path)
