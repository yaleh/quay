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

Five symlinked `plugin/scripts/*.ts` scripts invoked through their
`experiments/quay-perpetual-stream/scripts/` mirror paths silently exit 0 with no output -- the
`isDirect` CLI-entrypoint guard never fires, so `main()` never runs.  The root cause is mechanical
and identical across all five: `process.argv[1]` preserves the invocation path as-typed (the symlink
path, or a relative path resolved by the shell), while Node's ESM loader realpath-resolves
`fileURLToPath(import.meta.url)` to the symlink **target** under `plugin/scripts/`.  These never
compare equal, so the guard falls through to a clean exit 0 indistinguishable from "ran and found
zero issues."  Invoking the real `plugin/scripts/<name>.ts` path directly works correctly -- this is
purely an invocation-path artifact of the symlink mirror migration.

Confirmed independently on clean `master` (2026-07-28 for `touches-orthogonality-check.ts` and
`anti-drift-touches-check.ts`; 2026-07-31 for the full sweep confirmed the same raw guard shape in
`routine-file-gate.ts`, `routine-scheduler.ts`, and `serial-fanin-absorb.ts`):

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md
# zero output, exit 0 -- WRONG (symlink path, guard failed silently)

$ node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md
DISJOINT: tasks/A.md ∥ tasks/B.md -- safe to batch (disjoint file-sets)
# exit 0 -- CORRECT (real path, guard fired)
```

**Affected scripts (5 in scope):**

| Script | Selfcheck path | Guard shape |
|---|---|---|
| `touches-orthogonality-check.ts` | `touches-orthogonality-selfcheck.sh` | raw `process.argv[1] === fileURLToPath(...)` |
| `anti-drift-touches-check.ts` | `anti-drift-touches-selfcheck.sh` | raw `process.argv[1] === fileURLToPath(...)` |
| `routine-file-gate.ts` | `routine-file-gate-selfcheck.sh` | raw `process.argv[1] === fileURLToPath(...)` |
| `routine-scheduler.ts` | `routine-scheduler-selfcheck.sh` | raw `process.argv[1] === fileURLToPath(...)` |
| `serial-fanin-absorb.ts` | (wrapped by `.sh`) | raw `process.argv[1] === fileURLToPath(...)` |

**Severity**: `touches-orthogonality-check.ts` and `anti-drift-touches-check.ts` are the DIR-044/
DIR-107 concurrent-batch-scheduler safety-net checks (pre-flight orthogonality + the PRE-MERGE hard
anti-drift guardrail). Their fixture selfchecks currently cannot detect a real regression via the
documented invocation path -- a fixture case that SHOULD fail (`mis-declared-overlap-BITES`,
`stray-write-BITES`, `overbroad-declaration-BITES`) silently reports exit 0/PASS instead. The other
3 scripts are routine/fan-in infrastructure with the identical defect shape.

**Already-fixed precedent (out of scope):** `config-wiring-check.ts`, `concurrent-batch-scheduler.ts`,
and `drivable-workspace-check.ts` each carry an inline `isDirectInvocation()` function using
`fs.realpathSync(path.resolve(process.argv[1]))`. All three are confirmed working via audit
(M-DIR119-C-CANARY) and are explicitly out of scope for this task.

### Chosen mechanism: fix `gate-script-base.ts`'s `isDirectEntry()`, then import it in all 5 affected scripts

`gate-script-base.ts` is the shared framework for TypeScript gate scripts in this repo. It already
exports `isDirectEntry(importMeta, argv1?)` (line 124), already imported by `composite-preflight.ts`,
`prepare-admission-check.ts`, and `proposal-convergence.ts`. Its CURRENT implementation is:

```ts
export function isDirectEntry(importMeta: ImportMeta, argv1?: string): boolean {
  const entry = argv1 || process.argv[1];
  return !!entry && fileURLToPath(importMeta.url) === path.resolve(entry);
}
```

This uses `path.resolve(entry)` -- absolute-ification -- which is NOT sufficient for the symlink
case (a relative symlink path `./scripts/foo.ts` becomes absolute `.../experiments/.../scripts/foo.ts`,
still not equal to `.../plugin/scripts/foo.ts`). The fix wraps `path.resolve(entry)` with
`fs.realpathSync()` and adds a try/catch guard, making it:

```ts
export function isDirectEntry(importMeta: ImportMeta, argv1?: string): boolean {
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(importMeta.url);
  } catch {
    return false;
  }
}
```

This is the SAME `fs.realpathSync`-based comparison already proven in the three inline-fixed
scripts, but centralized in the shared framework so no script needs its own copy.

**[Claim: `gate-script-base.ts`'s fixed `isDirectEntry()` is the single-source `realpathSync`-based
entry guard -- needs AC-level proof via grep showing `fs.realpathSync` in the function body and no
other `realpathSync`-based entry guard elsewhere in the 5 fixed scripts.]**

**Why fix `gate-script-base.ts` rather than inline in each file (the precedent path):**

The precedent (`config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, `drivable-workspace-check.ts`)
inlined the helper because at the time those were fixed, `gate-script-base.ts`'s `isDirectEntry()`
was also broken for symlinks -- inlining was the only correct path. Now that the shared framework
itself is being fixed, every future consumer (and the 5 new importers) gets the fix automatically.
`gate-script-base.ts` already IS the shared framework for TypeScript gate scripts -- it exports
`parseArgs`, `readFrontmatter`, `emitPass`, `emitFail`, `requireArg`, and `isDirectEntry`. Fixing
it once fixes all consumers forever.

**[Claim: `gate-script-base.ts` `isDirectEntry()` is now `realpathSync`-based, so no new script
needs to reinvent it -- needs AC-level proof that the 5 affected scripts import `isDirectEntry`
from `gate-script-base.ts` rather than defining their own variant.]**

### Dual-copy discipline: `gate-script-base.ts` must be fixed in BOTH tracked locations

`experiments/quay-perpetual-stream/scripts/gate-script-base.ts` is a git-tracked **regular file**
(mode 100644, not a symlink) that is currently byte-identical to `plugin/scripts/gate-script-base.ts`
(same blob hash) -- unlike the 5 in-scope scripts, which are real 120000 symlinks into
`plugin/scripts/`. This is NOT an oversight: `gate-script-base.ts`, `composite-preflight.ts`,
`prepare-admission-check.ts`, `proposal-convergence.ts`, `candidate-contracts.ts`, and
`composite-manifest-synthesis.ts` are all maintained by this repo's own established convention as
manually-synced byte-identical PAIRS rather than symlinks (see commit `eaed20a7` and the
`a16f085`/`701e7fb` "3 file pairs (byte-identical)" precedent).

`select-preflight.ts` and `diagnose-verify-failure.ts` -- both real, non-symlinked files that live
only under `experiments/quay-perpetual-stream/scripts/` -- import `isDirectEntry` via the relative
specifier `./gate-script-base.ts`, which (since neither importing file nor `gate-script-base.ts`
itself is a symlink there) resolves to the **experiments copy**, not the `plugin/scripts/` copy
edited above. Fixing only `plugin/scripts/gate-script-base.ts` would leave the experiments copy
permanently on the stale `path.resolve`-only implementation, so `isDirectEntry` as consumed by
`select-preflight.ts` and `diagnose-verify-failure.ts` would still be un-fixed after this task lands.

Therefore the identical `fs.realpathSync`-based body shown above must be applied to BOTH tracked
copies -- `plugin/scripts/gate-script-base.ts` AND
`experiments/quay-perpetual-stream/scripts/gate-script-base.ts` -- keeping them byte-identical per
the existing pair-sync convention, exactly as already required for the other five manually-synced
pairs in this repo.

**[Claim: `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` receives the SAME
`fs.realpathSync`-based `isDirectEntry()` body as `plugin/scripts/gate-script-base.ts`, keeping the
pair byte-identical -- needs AC-level proof via `diff -q` between the two files post-fix.]**

### Per-file change (each of the 5 affected scripts)

Replace the current raw guard:

```ts
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
```

With an import-based guard:

```ts
import { isDirectEntry } from "./gate-script-base.ts";

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
```

The `import.meta` parameter is lexically scoped to the calling module -- `isDirectEntry()` receives
`importMeta.url` from the CALLER, then compares its `fileURLToPath()` form against
`fs.realpathSync(path.resolve(process.argv[1]))`. Because `importMeta.url` is already
realpath-resolved by Node's ESM loader AND `process.argv[1]` is now realpath-resolved by
`fs.realpathSync`, the two paths compare equal regardless of which invocation path (symlink or real
file) was used.

**[Claim: all 5 scripts import `isDirectEntry` from `./gate-script-base.ts` -- needs AC-level proof
via grep of each file's imports.]**

**[Claim: the raw `process.argv[1] === fileURLToPath(...)` pattern is absent from all 5 files post-fix
-- needs AC-level proof via grep.]**

**`serial-fanin-absorb.ts`** currently imports `fs` and `{ fileURLToPath }` from `node:url` -- it
does not import `path` at all (the old raw guard's `fileURLToPath(import.meta.url) ===
process.argv[1]` comparison needs no `path` module, so there is no `path` import to remove here).
The import change is: remove `import { fileURLToPath } from "node:url"` (no longer used once the
comparison moves into `isDirectEntry()`), add `import { isDirectEntry } from
"./gate-script-base.ts"`. The `import fs from "node:fs"` stays for any existing `fs` usage in the
file body. This exact import delta -- drop `fileURLToPath`, add `isDirectEntry` -- is the claim
proven by the dedicated Acceptance Criteria item covering `serial-fanin-absorb.ts`'s import change.

### Design decision: do NOT consolidate the three inline-fixed scripts

`config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, and `drivable-workspace-check.ts` each
define their own `isDirectInvocation()` inline and are already working. Consolidating them to import
from `gate-script-base.ts` would touch files outside the task's `## Touches` scope and would
require re-validating their selfchecks -- a pure-refactor risk with no bug-fix benefit. They are
left as-is. Any NEW TypeScript CLI script should import `isDirectEntry` from `gate-script-base.ts`
going forward, preventing this class from recurring.

### No changes to shell wrappers

The `.sh` wrappers (`touches-orthogonality-check.sh`, `anti-drift-touches-check.sh`,
`serial-fanin-absorb.sh`) resolve `$(dirname "$0")/<name>.ts` -- this correctly points at the
symlink, and Node will receive the symlink path as `process.argv[1]`. The fix handles this case
inside the TypeScript via `fs.realpathSync`, so no wrapper changes are needed. Selfcheck scripts
that invoke `.ts` files directly (`routine-file-gate-selfcheck.sh`, `routine-scheduler-selfcheck.sh`)
also need no changes.

### Defaults and failure behavior

- **Missing `process.argv[1]`** (e.g., `node -e "require('./script.ts')"`): `isDirectEntry()` returns
  `false` -- `main()` does not run. This is the existing behavior and correct: a programmatic import
  should NOT trigger the CLI.
- **Unresolvable invocation path** (e.g., the file was deleted after invocation): `fs.realpathSync`
  throws, caught by try/catch -- returns `false` -- `main()` does not run. Fail-closed: silencing is
  safer than executing with a path the code cannot validate.
- **Invoked via the real `plugin/scripts/` path directly**: `realpath` of `process.argv[1]` equals
  the real path -- `main()` runs -- backward compatible with any existing direct invocation.
- **Invoked via the symlink `experiments/` path**: Both sides now resolve to the same real path via
  `fs.realpathSync` -- `main()` runs -- this is the fix.
- **For the 3 existing consumers of `isDirectEntry()`** (`composite-preflight.ts`,
  `prepare-admission-check.ts`, `proposal-convergence.ts`): none are symlinked, so
  `fs.realpathSync(path.resolve(x)) === path.resolve(x)` -- the fix is a behavioral no-op
  (benign, zero regression risk).

### Regression test: symlink-mirror-invocation.test.mjs

A single test file at `experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs`
that:

1. **Enumerates** every symlink under `experiments/quay-perpetual-stream/scripts/` whose realpath
   target is under `plugin/scripts/` (via `fs.readdirSync` + `fs.lstatSync` + `fs.realpathSync`,
   not a hardcoded list).
2. **Filters** to symlinks targeting `.ts` files (the defect class is TypeScript CLI scripts with
   `isDirect` guards; `.sh` wrappers are thin delegators with no `isDirect` guard).
3. **For each symlink**, runs `node --experimental-strip-types <symlink-path>` with a fixed test
   input that triggers usage output (e.g. no arguments, or `--help` where supported) and captures
   stdout, stderr, and exit code.
4. **For each symlink**, runs `node --experimental-strip-types <real-target-path>` with the same
   test input and captures stdout, stderr, and exit code.
5. **Asserts** that the symlink-path invocation produces non-empty stdout (non-empty output is the
   key signal -- a silent exit-0 is the failure mode; a script that produces output proves its
   `main()` actually ran) AND that both invocations produce identical stdout+stderr+exit code.
6. **Reports** which scripts fail so a human can diagnose. Exits 1 if any script fails either
   assertion.

The test does NOT hardcode script names. It discovers symlinks at runtime. This means:
- Pre-fix, it is RED against at least 5 scripts (the 5 in scope).
- Post-fix, it is GREEN against all discovered symlinks.
- If a 7th symlinked script with a similar broken guard is added later, the test catches it
  mechanically -- no human needs to remember to add it to a list.

**[Claim: the regression test discovers symlinks dynamically -- needs AC-level proof showing
`fs.readdirSync` + `fs.lstatSync`/`fs.realpathSync` in the test source, not a static array of
filenames.]**

**[Claim: the regression test asserts non-empty stdout for the symlink-path invocation -- needs
AC-level proof showing stdout capture and non-empty assertion per symlink.]**

**[Claim: invoking via symlink path and real path produces identical output -- needs AC-level proof
showing stdout/stderr/exit-code comparison between the two invocations.]**

### Compatibility

No breaking changes. Scripts invoked via the real `plugin/scripts/` path continue to work
identically. Scripts invoked via the symlink path now work instead of silently no-opping. No
changes to any script's exported API surface (`main()`, exported functions). No changes to shell
wrappers, selfcheck scripts, or OUTER-LOOP.md.

The 3 existing `isDirectEntry()` consumers (`composite-preflight.ts`, `prepare-admission-check.ts`,
`proposal-convergence.ts`) see zero behavioral change -- none are symlinked, so
`fs.realpathSync(path.resolve(x)) === path.resolve(x)` for their invocation paths.

### Risks

**Very low.** The fix pattern (`fs.realpathSync` in the entry guard) is proven in 3 scripts already
landed on `master` (`config-wiring-check.ts`, `concurrent-batch-scheduler.ts`,
`drivable-workspace-check.ts`), all of which pass their selfchecks and are exercised in the loop.
The mechanical transformation is identical across all 5 targets -- replace the raw guard with an
import-based guard calling the fixed `isDirectEntry()`.

**Risk of `gate-script-base.ts` regression for existing consumers**: The 3 existing consumers of
`isDirectEntry()` are not symlinked, so the change from `path.resolve` to `fs.realpathSync` is a
no-op for them. Verified: `fs.realpathSync` of a non-symlink absolute path returns the same path.

**Risk of `serial-fanin-absorb.ts` import cleanup**: Currently imports `{ fileURLToPath }` from
`node:url` solely for use in the old guard. After the fix, this import is dead. Removing it is
clean, but accidentally removing a needed import would break the script. The fix only touches
the import block and the guard -- the rest of the file is untouched, and the selfcheck verifies
correctness.

**Risk of introducing a regression**: The fix only affects the CLI entrypoint guard. Every script's
exported functions (`checkTouchesPair`, `checkAntiDrift`, `gateFinding`, `dueRoutines`,
`computeFanIn`, etc.) are untouched. The existing unit tests import these functions directly and
are unaffected by the guard change.

### Non-goals

- **Not consolidating the three inline-fixed scripts** (`config-wiring-check.ts`,
  `concurrent-batch-scheduler.ts`, `drivable-workspace-check.ts`) to import `isDirectEntry` --
  they are already fixed and working; touching them adds pure-refactor risk with zero bug-fix
  benefit.
- **Not changing `select-preflight.ts` or `derive-touches-heuristic.ts`** -- they already use
  `path.resolve(process.argv[1])`-style normalization and are not affected by this class (confirmed
  in task body).
- **Not changing any script's business logic, exported API, or test suite** -- pure entrypoint-guard
  replacement.
- **Not adding per-script regression tests** -- the single repo-wide symlink-enumeration test covers
  all scripts generically; existing per-script unit tests already cover the business logic.
- **Not auditing or changing `.sh` wrapper scripts** -- they use `$(dirname "$0")` which resolves to
  the symlink directory and delegates to `node <script>.ts` with the symlink path; no shell-level
  changes are needed because the fix lives entirely in the `.ts` guard. The resulting behavior of
  each `.sh`-wrapped invocation (`anti-drift-touches-selfcheck.sh`, `touches-orthogonality-selfcheck.sh`,
  and `serial-fanin-absorb`'s wrapper) is exactly what the first Acceptance Criteria item already
  requires and proves -- real selfcheck PASS output through the documented symlink path -- so no
  separate claim or separate coverage is introduced here.

### AC coverage

| AC | How satisfied |
|---|---|
| All 5 selfchecks PASS via symlink path (real command output) | Each script's `isDirect` guard is replaced with `import { isDirectEntry }` calling the fixed `gate-script-base.ts` function. Before/after command output for each selfcheck proves the fix -- not asserted. |
| A failure-signaling fixture reports non-zero via symlink | `mis-declared-overlap-BITES` for `anti-drift-touches-check`, the 3 BITE-named fixtures for `touches-orthogonality` -- these fixtures exercise the exact path that currently silently exits 0. After fix, they exit non-zero. |
| Repo-wide symlink-enumeration regression test catches future recurrences | New test at `experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` calls `fs.readdirSync` + `fs.lstatSync` + `fs.realpathSync` to discover all mirror symlinks, invokes each via both paths, asserts non-empty stdout and output equality. RED against at least one unfixed script before the fix, GREEN after all 5 are fixed. |
| The SAME `fs.realpathSync`-based helper is used by all 5 scripts | `gate-script-base.ts`'s `isDirectEntry()` body contains `fs.realpathSync(path.resolve(...))` -- one definition, 5 import sites. Verified via grep/diff: grep `isDirectEntry` in the 5 files shows `import { isDirectEntry } from "./gate-script-base.ts"`; grep `fs.realpathSync` in `gate-script-base.ts` shows it inside `isDirectEntry()`; grep `fs.realpathSync` in the 5 affected scripts shows no self-defined variant. |
| The `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` mirror copy (imported by `select-preflight.ts` and `diagnose-verify-failure.ts`) gets the identical fix, not just the `plugin/scripts/` copy | `diff -q plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts` reports no difference post-fix -- both copies carry the same `fs.realpathSync`-based `isDirectEntry()` body, preserving the existing manually-synced-pair convention. |

### Alternatives considered and rejected

**A. Inline `isDirectInvocation()` in each of the 5 files (the precedent path).** This was the path
taken for `config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, and
`drivable-workspace-check.ts`. Rejected because (a) it would be the 6th-10th copy of the same logic,
violating DRY; (b) `gate-script-base.ts` already exports `isDirectEntry()` -- fixing it once fixes
all consumers forever; (c) the precedent predates the existence of a correct shared helper; this
task creates it. The three already-fixed scripts are left as-is (see Non-goals) -- touching them is
pure-refactor risk with zero bug-fix benefit.

**B. Use `path.resolve()` only (no `realpathSync`).** This is `gate-script-base.ts`'s current
implementation. Rejected because `path.resolve("./scripts/foo.ts")` returns an absolute path that
still goes through the symlink directory, not the real target directory -- it makes the path
absolute but does not resolve symlinks. Only `fs.realpathSync` resolves the symlink to its target.

**C. Change the shell wrappers to always invoke via the real `plugin/scripts/` path.** Shifts the
problem to the shell layer (which must now locate the real path) without fixing the root cause.
Any future symlink added without a shell wrapper (e.g., `routine-scheduler.ts` is invoked directly)
would silently reintroduce the defect. Rejected: fixes the symptom, not the cause -- the guard
itself should work regardless of invocation path.

**D. Remove the `isDirect` guard entirely.** The guard exists to prevent `main()` from running when
the script is `import`-ed as a module (e.g., `concurrent-batch-scheduler.ts` imports from
`touches-orthogonality-check.ts`). Removing it would cause side effects (CLI argument parsing,
process.exit) on every `import`. Rejected: breaks the module-vs-CLI separation contract.

**E. Hardcode the 5 script names in the regression test.** A hardcoded list would pass regardless
of whether a 6th script is added later with the same vulnerable guard. The AC explicitly requires
enumeration, not hardcoding. Rejected: fails the "future recurrence" requirement.

## Plan

See [docs/plans/M209-gap-touches-orthogonality-symlink-isdirect-mismatch.md](docs/plans/M209-gap-touches-orthogonality-symlink-isdirect-mismatch.md) for the full execution plan (5 stages: RED regression test, fix `gate-script-base.ts` `isDirectEntry()`, fix 5 affected scripts, GREEN selfchecks + regression test, landing).

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
symlink (the path every existing selfcheck -- and `gate_delegate_ts` in `gate-script-lib.sh` -- uses).
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
report exit 0) -- re-confirmed live 2026-07-28: `node --experimental-strip-types
experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts tasks/A.md tasks/B.md`
produces zero output and exit 0/1, while the real `plugin/scripts/touches-orthogonality-check.ts`
path prints the correct OVERLAP/DISJOINT verdict. Invoking the REAL file directly works correctly --
this is purely an invocation-path artifact of the symlink migration (see commit "fix: mirror
gate-script-lib.sh into plugin/scripts/ -- task-schema-check.sh was broken", 66647b4), not a logic
bug in the checks themselves.

**Scope update (2026-07-28, merged from `gap-symlink-mirror-noop-affects-5-more-scripts`, filed and
then found duplicative the same day):** a repo-wide sweep of every symlink under
`experiments/quay-perpetual-stream/scripts/` for the same `process.argv[1] ===
fileURLToPath(...)`-shaped guard found `routine-file-gate.ts`, `routine-scheduler.ts`, and
`serial-fanin-absorb.ts` also affected -- none covered by this task's original scope or by the
`concurrent-batch-scheduler.ts` fix below. **`concurrent-batch-scheduler.ts` itself, originally
named in this task's scope, is REMOVED here -- it was already fixed** (real
`fs.realpathSync`-based `isDirectInvocation()` helper, confirmed via `gap-config-wiring-check-
symlink-noop`'s M-DIR119-C-CANARY audit, 2026-07-27) and is out of scope for this task now.

**Severity**: `touches-orthogonality-check.ts` and `anti-drift-touches-check.ts` are the DIR-044/
DIR-107 concurrent-batch-scheduler safety-net checks (touches-orthogonality pre-flight + the
anti-drift-touches PRE-MERGE hard gate). Their fixture selfchecks currently cannot detect a real
regression in the underlying logic via the documented invocation path -- a fixture case that SHOULD
fail (`mis-declared-overlap-BITES`, `stray-write-BITES`, `overbroad-declaration-BITES`) silently
reports exit 0/PASS instead. The other 3 scripts are routine/fan-in scheduling infrastructure with
the identical defect shape, discovered by pattern sweep rather than by an observed failure.

## Requested action

1. Fix the `isDirect` guard in all 5 affected `.ts` files by fixing `gate-script-base.ts`'s shared
   `isDirectEntry()` function to use `fs.realpathSync(path.resolve(entry))` instead of
   `path.resolve(entry)` alone, and replacing each script's raw `process.argv[1] ===
   fileURLToPath(import.meta.url)` guard with `import { isDirectEntry } from
   "./gate-script-base.ts"` and `if (isDirectEntry(import.meta))` -- so it matches regardless of
   which path (symlink or real file) was used to invoke it. `select-preflight.ts` and
   `derive-touches-heuristic.ts` (DIR-113) already use `path.resolve(process.argv[1])`-style
   normalization and are NOT affected by this class, but even `path.resolve` alone would not fix
   THIS specific symlink case (needs realpath, not just absolute-ification) -- verify the fix with
   the same `git stash`-style before/after reproduction.
2. Add a single repo-wide regression test that enumerates every symlink under
   `experiments/quay-perpetual-stream/scripts/` pointing into `plugin/scripts/` (not a hardcoded
   5-script list) and asserts non-silent, output-identical behavior between the mirror and real
   invocation paths for each -- so a 6th future instance of this exact pattern is caught
   mechanically instead of by accidental discovery, the way this task's own scope update was found.

## Acceptance Criteria

- [ ] `anti-drift-touches-selfcheck.sh`, `touches-orthogonality-selfcheck.sh`, and the equivalent
  selfcheck/direct invocation for `routine-file-gate.ts`, `routine-scheduler.ts`, and
  `serial-fanin-absorb.ts` all PASS when invoked via their documented
  `experiments/quay-perpetual-stream/scripts/*` path (not just via the `plugin/scripts/` real path)
  -- shown with real command output, not asserted.
- [ ] A fixture case that should fail (e.g. `mis-declared-overlap-BITES`) actually reports non-zero
  when invoked through the symlink path -- proven, not asserted.
- [ ] A single repo-wide test enumerates every `experiments/quay-perpetual-stream/scripts/*` symlink
  target and asserts mirror-path invocation is non-silent for all of them -- RED against at least one
  of the 5 real scripts before the fix, GREEN after; written so a script added later with the same
  vulnerable guard shape is caught automatically (enumerates symlinks, does not hardcode names).
- [ ] Real code inspection confirms the fix uses the SAME `fs.realpathSync`-based logic across all 5
  scripts: `gate-script-base.ts`'s `isDirectEntry()` body contains `fs.realpathSync(path.resolve(...))`,
  and each of the 5 affected scripts imports `isDirectEntry` from `./gate-script-base.ts` rather than
  defining its own variant -- shown via grep/diff, not asserted.
- [ ] `serial-fanin-absorb.ts` no longer imports `{ fileURLToPath }` from `node:url` (dead after guard replacement) and imports `isDirectEntry` from `./gate-script-base.ts` instead -- shown via grep, not asserted.
- [ ] Selfcheck scripts that invoke `.ts` files directly (`routine-file-gate-selfcheck.sh`, `routine-scheduler-selfcheck.sh`) pass without modification after the fix -- shown via real command output, not asserted.
- [ ] No changes to `.sh` wrapper scripts (`touches-orthogonality-check.sh`, `anti-drift-touches-check.sh`, `serial-fanin-absorb.sh`) -- shown via `git diff` showing zero hunks in `.sh` files, not asserted.
- [ ] The regression test at `experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` dynamically enumerates symlinks via `fs.readdirSync` + `fs.lstatSync` + `fs.realpathSync` (not a static hardcoded list of filenames) and asserts non-empty stdout per symlink with output-identical behavior between the symlink and real invocation paths -- shown via grep of the test source, not asserted.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, script changes alone do not satisfy this -- real before/after command output for all 5
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

- plugin/scripts/gate-script-base.ts
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/routine-file-gate.ts
- plugin/scripts/routine-scheduler.ts
- plugin/scripts/serial-fanin-absorb.ts
- experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs
- experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh
