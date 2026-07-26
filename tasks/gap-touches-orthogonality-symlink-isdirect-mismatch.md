---
id: gap-touches-orthogonality-symlink-isdirect-mismatch
title: "gap: touches-orthogonality-check.ts / concurrent-batch-scheduler.ts /
  anti-drift-touches-check.ts CLI entrypoints are dead code via their
  experiments/ symlinks (isDirect realpath mismatch)"
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Finding

`experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts`,
`concurrent-batch-scheduler.ts`, `anti-drift-touches-check.ts` (and their `.sh` wrappers) are
symlinks into `plugin/scripts/` (e.g. `touches-orthogonality-check.ts -> ../../../plugin/scripts/
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
report exit 0) and `concurrent-batch-scheduler-selfcheck.sh` (all 3 cases mismatch — the CLI prints
nothing at all, so the selfcheck's string-match against expected output also fails). Invoking the
REAL file directly (`node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts
...`) works correctly — this is purely an invocation-path artifact of the symlink migration (see
recent commit "fix: mirror gate-script-lib.sh into plugin/scripts/ — task-schema-check.sh was
broken", 66647b4), not a logic bug in the checks themselves.

**Severity**: these are the DIR-044/DIR-107 concurrent-batch-scheduler safety-net checks
(touches-orthogonality pre-flight + the anti-drift-touches PRE-MERGE hard gate). Their fixture
selfchecks currently cannot detect a real regression in the underlying logic via the documented
invocation path — a fixture case that SHOULD fail (`mis-declared-overlap-BITES`, `stray-write-
BITES`, `overbroad-declaration-BITES`) silently reports exit 0/PASS instead.

## Requested action

Fix the `isDirect` guard in the 3 affected `.ts` files (or the shared pattern, if consolidated) to
compare against the REALPATH of `process.argv[1]` (e.g. `fs.realpathSync(process.argv[1])`) rather
than the raw invocation string, so it matches regardless of which path (symlink or real file) was
used to invoke it. `select-preflight.ts` and `derive-touches-heuristic.ts` (DIR-113) already use
`path.resolve(process.argv[1])`-style normalization and are NOT affected by this class, but even
`path.resolve` alone would not fix THIS specific symlink case (needs realpath, not just absolute-
ification) — verify the fix with the same `git stash`-style before/after reproduction.

## Acceptance Criteria

- [ ] `anti-drift-touches-selfcheck.sh`, `touches-orthogonality-selfcheck.sh`,
  `concurrent-batch-scheduler-selfcheck.sh` all PASS when invoked via their documented
  `experiments/quay-perpetual-stream/scripts/*.sh` path (not just via the `plugin/scripts/` real
  path)
- [ ] A fixture case that should fail (e.g. `mis-declared-overlap-BITES`) actually reports non-zero
  when invoked through the symlink path — proven, not asserted

## Definition of Done

Standard inherited-core DoD clauses apply. Done only when the 3 selfchecks above are re-run for
real (pasted output) and all green via the symlinked invocation path used in production (loop
driver, CI, etc.).

## Touches

- `plugin/scripts/touches-orthogonality-check.ts`
- `plugin/scripts/concurrent-batch-scheduler.ts`
- `plugin/scripts/anti-drift-touches-check.ts`
