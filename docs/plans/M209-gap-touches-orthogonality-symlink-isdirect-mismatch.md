# Plan: M209 -- Symlink `isDirect` guard fix for 5 mirrored scripts

**Milestone:** M209  
**Task:** `gap-touches-orthogonality-symlink-isdirect-mismatch`  
**Charter:** `experiments/quay-perpetual-stream/charters/M209-gap-touches-orthogonality-symlink-isdirect-mismatch.md`  
**Base revision:** `28c3822`  
**Classification:** defect-fix (code + test)  
**Risk:** very low -- centralized `fs.realpathSync` fix in one shared function, 5 import-site replacements, one new regression test. Identical fix pattern already proven in `config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, and `drivable-workspace-check.ts`.

## Touch set

| File | Role | Pre-existing | Line budget |
|---|---|---|---|
| `plugin/scripts/gate-script-base.ts` | Fix `isDirectEntry()`: wrap `path.resolve(entry)` with `fs.realpathSync()` + try/catch | 127 lines | ~3 lines changed |
| `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` | Dual-copy sync: apply the SAME `fs.realpathSync`-based `isDirectEntry()` body as the plugin copy (this is a git-tracked regular file, not a symlink, byte-identical to the plugin copy pre-fix -- confirmed `diff -q`, exit 0) -- `select-preflight.ts` and `diagnose-verify-failure.ts` import `isDirectEntry` from this exact copy via `./gate-script-base.ts` | 127 lines | ~3 lines changed |
| `plugin/scripts/touches-orthogonality-check.ts` | Replace raw guard with `import { isDirectEntry }` call, plus drop `{ fileURLToPath }` import (unused after guard removal -- it is used ONLY in the guard, not by `normalizePath`/`matchGlob`/the rest of the file body) | 236 lines | ~3 lines changed |
| `plugin/scripts/anti-drift-touches-check.ts` | Same replacement, plus drop `{ fileURLToPath }` import if unused after guard removal | 118 lines | ~3 lines changed |
| `plugin/scripts/routine-file-gate.ts` | Same replacement, plus drop `{ fileURLToPath }` import if unused after guard removal | 97 lines | ~3 lines changed |
| `plugin/scripts/routine-scheduler.ts` | Same replacement, plus drop `{ fileURLToPath }` import if unused after guard removal | 125 lines | ~3 lines changed |
| `plugin/scripts/serial-fanin-absorb.ts` | Same replacement, drop `{ fileURLToPath }` from `node:url` import (AC 5), add `import { isDirectEntry }` | 103 lines | ~3 lines changed |
| `experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` | New regression test: enumerates symlinks dynamically, asserts non-empty stdout + output equality | new file | ~150 lines |

Total line delta: ~+150 (new test file) + ~18 net (7 file fixes, ~3 lines each). No `.sh` wrappers touched. No changes to selfcheck scripts. No new `agent()` dispatches, no prompt changes, no schema changes.

**Dual-copy discipline (why 8 files, not 7):** `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` is NOT a symlink to `plugin/scripts/gate-script-base.ts` -- it is a separate git-tracked regular file (mode 100644) that happens to be byte-identical today. `select-preflight.ts` and `diagnose-verify-failure.ts` (both under `experiments/quay-perpetual-stream/scripts/`) import `isDirectEntry` via the relative specifier `./gate-script-base.ts`, which resolves to THIS copy, not the plugin copy. Fixing only `plugin/scripts/gate-script-base.ts` would leave those two consumers running the old `path.resolve`-only (non-realpath) implementation, defeating the goal that fixing the shared framework "fixes all consumers forever." Both copies must receive the identical `fs.realpathSync` body in the same stage, and Stage 2's exit checks must confirm the pair stays byte-identical (`diff -q`).

## Dependencies

- None -- standalone defect fix. The 6 `plugin/scripts/` files share no import relationships with each other (only with `gate-script-base.ts`). The new test file depends only on the filesystem symlink structure, which pre-exists.
- The 3 already-fixed scripts (`config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, `drivable-workspace-check.ts`) are NOT touched -- they define their own inlined `isDirectInvocation()` and are already working. The task Proposal explicitly excludes them as a non-goal.
- **Not human-steered** (does NOT touch `.claude/workflows/execute-milestone.js`, `OUTER-LOOP.md`, or `inherited-core.md`). Safe for loop-driven execution.

## AC coverage map

| AC | Summary | Stage |
|----|---------|-------|
| 1 | All 5 selfchecks PASS via symlink path (real command output) | 3, 4, 5 |
| 2 | Failure-signaling fixture reports non-zero via symlink (proven, not asserted) | 3, 4, 5 |
| 3 | Repo-wide symlink-enumeration regression test catches future recurrences (RED pre-fix, GREEN post-fix) | 1, 4, 5 |
| 4 | Same `fs.realpathSync`-based `isDirectEntry()` used by all 5 scripts, and both `gate-script-base.ts` copies (plugin + experiments) stay byte-identical after the fix (grep/diff, not asserted) | 2, 3, 5 |
| 5 | `serial-fanin-absorb.ts` no longer imports `{ fileURLToPath }` from `node:url`, imports `isDirectEntry` instead (grep, not asserted) | 3, 5 |
| 6 | `routine-file-gate-selfcheck.sh` and `routine-scheduler-selfcheck.sh` pass without modification (real command output) | 4, 5 |
| 7 | No changes to `.sh` wrapper scripts (`touches-orthogonality-check.sh`, `anti-drift-touches-check.sh`, `serial-fanin-absorb.sh`) -- zero hunks in `.sh` files | 5 |
| 8 | Regression test dynamically enumerates symlinks via `fs.readdirSync` + `fs.lstatSync` + `fs.realpathSync` (grep of test source, not asserted) | 1, 4, 5 |

## Stages

### Stage 1: RED -- Write symlink-mirror-invocation regression test
- AC: 3, 8
- Files: experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs
- Command: `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs`

**Test harness design (corrected 2026-07-31, human PlanCheck round 4 — see `## Plan-check history` below):**
- `fs.readdirSync("experiments/quay-perpetual-stream/scripts/")` reads the scripts directory.
- For each entry, `fs.lstatSync` checks `isSymbolicLink()`; `fs.realpathSync` resolves to the target.
- Filter to symlinks whose realpath ends with `.ts` and targets a file under `plugin/scripts/` (the defect class is TypeScript CLI scripts with `isDirect` guards).
- For each qualifying symlink: run `node --experimental-strip-types <symlink-path>` with NO ARGS (confirmed live against all 5 target scripts: none support `--help`, and every one writes its usage message via `process.stderr.write`, never stdout) and capture stdout, stderr, exit code.
- For each qualifying symlink: run `node --experimental-strip-types <real-target-path>` with the same (no-args) input, capture stdout, stderr, exit code.
- Assert: symlink-path **stderr is non-empty AND exit code is nonzero** (key signal -- a broken guard silently exits 0 with EMPTY stderr, since `main()` never runs and the usage-printing `catch`/error path is never reached; a working guard exits 2 with a populated "Usage:" line on stderr). Assert: both invocations produce identical stdout, stderr, and exit code (this cross-invocation-equality check was already correctly specified and remains the primary GREEN signal).
- Dynamic enumeration (no hardcoded list) -- AC 8 requirement.
- Reports per-script pass/fail; exits 1 if any script fails.

**RED expectation (pre-fix):** at least 5 scripts fail the symlink-path invocation assertion -- their symlink-path stderr is empty and exit code is 0 (silent success, `main()` never runs). The real-path invocation produces the correct "Usage:" line on stderr and exits 2. The test must capture a RED state with the 5 affected scripts listed as failures.

**Stage type:** code.

### Stage 2: Fix `gate-script-base.ts` (both copies) -- `isDirectEntry()` with `fs.realpathSync`
- AC: 4
- Files: plugin/scripts/gate-script-base.ts, experiments/quay-perpetual-stream/scripts/gate-script-base.ts
- Command: `grep -A5 'export function isDirectEntry' plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts`

**Change (line 124-127), applied identically to BOTH files:**

Before:
```ts
export function isDirectEntry(importMeta: ImportMeta, argv1?: string): boolean {
  const entry = argv1 || process.argv[1];
  return !!entry && fileURLToPath(importMeta.url) === path.resolve(entry);
}
```

After:
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

`experiments/quay-perpetual-stream/scripts/gate-script-base.ts` is a git-tracked regular file (mode 100644), NOT a symlink to the plugin copy -- it must be edited independently, with the identical body, so it stays byte-identical to the plugin copy (dual-copy discipline; see Touch set note above). `select-preflight.ts` and `diagnose-verify-failure.ts` both import `isDirectEntry` from this exact copy.

**Exit checks:**
1. `grep 'fs.realpathSync' plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts` matches exactly inside the `isDirectEntry` function body of BOTH files.
2. Neither file's function body contains the old `fileURLToPath(importMeta.url) === path.resolve(entry)` pattern -- only the new `fs.realpathSync(path.resolve(entry))` comparison.
3. `diff -q plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts` reports no differences (byte-identical pair sync maintained).
4. `node -e "import('./plugin/scripts/gate-script-base.ts').then(m => console.log(typeof m.isDirectEntry))"` and the same for the experiments copy confirm the function is still exported and syntactically valid in both.
5. Existing tests pass: `scripts/test.sh experiments/quay-perpetual-stream/test/gate-script-base.test.mjs`.
6. Behavioral no-op for existing consumers (`composite-preflight.ts`, `prepare-admission-check.ts`, `proposal-convergence.ts`, `select-preflight.ts`, `diagnose-verify-failure.ts`): none are symlinked, so `fs.realpathSync(path.resolve(x)) === path.resolve(x)` for their invocation paths.

**Stage type:** code.

### Stage 3: Fix 5 affected scripts -- replace raw guard with `import { isDirectEntry }`
- AC: 1, 2, 4, 5
- Files: plugin/scripts/touches-orthogonality-check.ts, plugin/scripts/anti-drift-touches-check.ts, plugin/scripts/routine-file-gate.ts, plugin/scripts/routine-scheduler.ts, plugin/scripts/serial-fanin-absorb.ts
- Command: `for f in plugin/scripts/touches-orthogonality-check.ts plugin/scripts/anti-drift-touches-check.ts plugin/scripts/routine-file-gate.ts plugin/scripts/routine-scheduler.ts plugin/scripts/serial-fanin-absorb.ts; do echo "=== $f ===" && grep -n 'isDirectEntry\|process.argv\[1\].*fileURLToPath\|import.*fileURLToPath' "$f"; done`

**Per-file change (identical shape across all 5):**

Replace:
```ts
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
```

With:
```ts
import { isDirectEntry } from "./gate-script-base.ts";

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
```

**Per-file specifics:**
- `touches-orthogonality-check.ts` (line 16-18, 233-236): already imports `{ fileURLToPath }` from `node:url` and `path` from `node:path`. `path` genuinely is still used elsewhere in the file body (`path.join`/`path.dirname`/`path.resolve` in `normalizePath`/`walk`/`findRepoRoot`/`expandRoot`) -- keep it. `fileURLToPath` is used ONLY in the old guard (line 233) -- remove that destructured import from the `node:url` import line, same as the other 4 files. Add `import { isDirectEntry }` from `./gate-script-base.ts`. Replace guard.
- `anti-drift-touches-check.ts` (line 14, 115-118): imports `{ fileURLToPath }` from `node:url` -- used ONLY in the old guard. Remove that destructured import from the `node:url` import line. Add `import { isDirectEntry }` from `./gate-script-base.ts`. Replace guard.
- `routine-file-gate.ts` (line 14, 96-97): imports `{ fileURLToPath }` from `node:url` -- used ONLY in the old guard. Remove from import line. Add `import { isDirectEntry }`. Replace guard.
- `routine-scheduler.ts` (line 17, 124-125): imports `{ fileURLToPath }` from `node:url` -- used ONLY in the old guard. Remove from import line. Add `import { isDirectEntry }`. Replace guard.
- `serial-fanin-absorb.ts` (line 15, 100-103): imports `{ fileURLToPath }` from `node:url` -- used ONLY in the old guard (AC 5). Remove the destructured import. The `import fs from "node:fs"` stays (used in `findManifest`). Add `import { isDirectEntry }` from `./gate-script-base.ts`. Replace guard.

**Exit checks:**
1. `grep 'import.*isDirectEntry.*gate-script-base'` matches exactly once per file (5 total).
2. `grep 'process.argv\[1\].*fileURLToPath'` matches zero times across all 5 files (old raw guard is gone).
3. `grep 'fileURLToPath' plugin/scripts/touches-orthogonality-check.ts plugin/scripts/anti-drift-touches-check.ts plugin/scripts/routine-file-gate.ts plugin/scripts/routine-scheduler.ts plugin/scripts/serial-fanin-absorb.ts` matches zero times (AC 5: no `{ fileURLToPath }` import in any of the 5 files -- `touches-orthogonality-check.ts` does not use it in the body either, only `path` and `fs` are still needed there).
4. `node --experimental-strip-types -e "import('./plugin/scripts/touches-orthogonality-check.ts')"` succeeds for each file (syntax-check; `main()` does not run on import due to `isDirectEntry` guard).

**Stage type:** code.

### Stage 4: GREEN -- Run regression test + selfchecks via symlink path
- AC: 1, 2, 3, 6, 8
- Files: experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs, experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh, experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh, experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh, experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh, experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh
- Command: `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` AND `bash experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh` AND `bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh` AND `bash experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` AND `bash experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh` AND `bash experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh`

**Expected exit:**
- Regression test: all discovered TypeScript symlinks produce non-empty stderr + nonzero exit via symlink path AND identical stdout/stderr/exit-code to real-path invocation. Zero scripts fail.
- `touches-orthogonality-selfcheck.sh`: all 6 fixture pairs PASS. `mis-declared-overlap-BITES` (used by `anti-drift-touches-selfcheck`) also correct.
- `anti-drift-touches-selfcheck.sh`: all 4 cases PASS (clean-batch exit 0, mis-declared-overlap-BITES exit 1, stray-write-BITES exit 1, overbroad-declaration-BITES exit 1). AC 2: the BITE-named fixtures report non-zero through the symlink path.
- `routine-file-gate-selfcheck.sh`: all cases PASS (actionable ACCEPT, vague REJECT, dedup REJECT, novel-in-board ACCEPT, ref-less REJECT, ref-backed ACCEPT).
- `routine-scheduler-selfcheck.sh`: all cases PASS (every(5) due at iteration 10, none-due exit 3, on(checkpoint) due).
- `serial-fanin-absorb-selfcheck.sh`: all cases PASS (2-build fan-in deterministic order, missing --counter exit 2).
- Existing unit tests for all 5 scripts pass: `scripts/test.sh experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs experiments/quay-perpetual-stream/test/routine-file-gate.test.mjs experiments/quay-perpetual-stream/test/routine-scheduler.test.mjs experiments/quay-perpetual-stream/test/serial-fanin-absorb.test.mjs`.

Real command output for all 5 selfchecks is captured verbatim and pasted into the commit message body (AC 1 requirement -- "real command output, not asserted").

**Stage type:** code.

### Stage 5: Landing -- Full suite, final grep, commit
- AC: 1, 2, 3, 4, 5, 6, 7, 8
- Files: plugin/scripts/gate-script-base.ts, experiments/quay-perpetual-stream/scripts/gate-script-base.ts, plugin/scripts/touches-orthogonality-check.ts, plugin/scripts/anti-drift-touches-check.ts, plugin/scripts/routine-file-gate.ts, plugin/scripts/routine-scheduler.ts, plugin/scripts/serial-fanin-absorb.ts, experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs
- Command: `scripts/test.sh` (full suite), then `git diff --stat` + `git diff --name-only` + `git commit`

**Exit checks:**
1. Full canonical test suite green: `scripts/test.sh` exits 0. **Correction (2026-07-31, human PlanCheck round 4):** `scripts/test.sh`'s default (no-args) glob is `packages/*/test/*.test.mjs plugin/test/*.test.mjs` — it does NOT reach `experiments/quay-perpetual-stream/test/`, which is deliberately excluded (see `scripts/test-coverage-check.ts`'s own header comment). A bare `scripts/test.sh` run therefore does not execute `symlink-mirror-invocation.test.mjs`, `gate-script-base.test.mjs`, or any of the 5 affected scripts' own unit tests — all of which live under `experiments/quay-perpetual-stream/test/`. Those must be run explicitly, as Stage 4 already does: `scripts/test.sh experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs experiments/quay-perpetual-stream/test/gate-script-base.test.mjs experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs experiments/quay-perpetual-stream/test/routine-file-gate.test.mjs experiments/quay-perpetual-stream/test/routine-scheduler.test.mjs experiments/quay-perpetual-stream/test/serial-fanin-absorb.test.mjs` must ALSO exit 0, in addition to the bare `scripts/test.sh` run.
2. Re-run Stage 2 grep: `isDirectEntry()` body contains `fs.realpathSync(path.resolve(...))` in BOTH `gate-script-base.ts` copies.
3. Re-run Stage 3 grep: all 5 scripts import `isDirectEntry` from `./gate-script-base.ts`; no raw `process.argv[1] === fileURLToPath` pattern remains.
4. `git diff --name-only` shows exactly the 8 files in the touch set -- zero `.sh` files changed (AC 7: "No changes to .sh wrapper scripts").
5. `git diff --name-only` shows `touches-orthogonality-check.sh`, `anti-drift-touches-check.sh`, and `serial-fanin-absorb.sh` are absent from the diff (AC 7).
6. `diff -q plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts` reports no differences (dual-copy byte-identical sync holds post-fix).
7. Real selfcheck output from Stage 4 captured in commit message body (AC 1, 2, 6).
8. Commit message format: `M209: fix symlink isDirect guard for 5 mirrored scripts via gate-script-base.ts realpathSync + regression test` with body including the real selfcheck command output.

**Stage type:** prose + code (commit).

## Guardrails

- **Rollback:** revert the commit. The fix is a 3-line change replicated in both `gate-script-base.ts` copies (plugin + experiments) + ~3-line replacements in 5 consumer scripts. No schema migration, no data migration, no API change. Rollback is a single `git revert`.
- **Existing `isDirectEntry()` consumers:** `composite-preflight.ts`, `prepare-admission-check.ts`, and `proposal-convergence.ts` are NOT symlinked -- `fs.realpathSync(path.resolve(x)) === path.resolve(x)` is a behavioral no-op for them. Verified by the existing `gate-script-base.test.mjs`, `composite-preflight.test.mjs`, `prepare-admission-check.test.mjs`, and `proposal-convergence.test.mjs` all passing unchanged.
- **Three inline-fixed scripts untouched:** `config-wiring-check.ts`, `concurrent-batch-scheduler.ts`, and `drivable-workspace-check.ts` define their own `isDirectInvocation()` and are already working. They are explicitly excluded (task non-goal), and their selfchecks must continue to pass.
- **No per-script regression tests needed:** the existing per-script unit tests (`touches-orthogonality-check.test.mjs` etc.) import business-logic functions directly and are unaffected by the guard change. The new repo-wide symlink-enumeration test covers the invocation-path defect generically.
- **Default/failure behavior preserved:** missing `process.argv[1]` or unresolvable invocation path returns `false` (fail-closed, `main()` does not run). The try/catch in `isDirectEntry()` handles edge cases identically to the three already-fixed inline helpers.
- **Future-proof:** the dynamic symlink enumeration regression test catches any future symlinked TypeScript script added with a similarly broken guard -- no human needs to remember to add it to a list.

## Stopping rule

At most 3 Plan-check rounds. Success only at F_i = 0 (the preparation checker's iterative refinement cycle). If the Plan reaches 3 rounds with F_i > 0, mark the task `needs-human` with the accumulated findings.

## Real-landing verification

After the fix lands on `master`, verify:
1. `git stash && bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh` -- all 4 cases PASS (previously: mis-declared-overlap-BITES, stray-write-BITES, overbroad-declaration-BITES were FAIL).
2. `bash experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh` -- all 6 fixture pairs PASS.
3. `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` -- all symlinks pass, zero failures.
4. `git diff HEAD~1 --name-only` confirms zero `.sh` files changed.
5. The 3 already-fixed inline scripts' selfchecks still pass (`bash experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh`, `bash experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh`).
6. `diff -q plugin/scripts/gate-script-base.ts experiments/quay-perpetual-stream/scripts/gate-script-base.ts` reports no differences -- both copies carry the identical `fs.realpathSync`-based fix.
7. `select-preflight.ts` and `diagnose-verify-failure.ts` (both import `isDirectEntry` from the experiments copy of `gate-script-base.ts`) still run correctly post-fix: `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs` passes (existing unit test for `select-preflight.ts`). `diagnose-verify-failure.ts` has no dedicated `*.test.mjs` file today, so confirm it directly by invocation: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` (no args -- expected usage-error exit code 2 per its own doc comment) produces non-empty stderr/stdout output, proving its `isDirectEntry(import.meta)` guard still resolves `true` and `main()` runs when invoked directly after the realpath change (a silent exit 0 with no output would indicate the guard broke).

## Plan-check history

- **Round 1** (agent, real dispatch): touch-set completeness gap — Plan omitted `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` (the non-symlinked dual copy). Fixed via revise round 1 (8-file touch set, dual-copy discipline section, Stage 2 covers both copies).
- **Round 2** (agent, real dispatch): `touches-orthogonality-check.ts`'s per-file specifics wrongly claimed to keep an unused `fileURLToPath` import; touch-set line counts were off-by-one across all 6 pre-existing files. Fixed via revise round 2 (per-file specifics corrected; line counts now match `wc -l` exactly — reverified 2026-07-31).
- **Round 3** (agent, real dispatch): exhausted `MAX_PLANCHECK_ROUNDS=3` before a revise could apply its findings — the automated loop terminates on unresolved findings at the final round rather than revising. Two real, confirmed defects were left open: (a) Stage 5's exit check falsely claimed bare `scripts/test.sh` covers the `experiments/quay-perpetual-stream/test/` suite (it is deliberately excluded from the default glob); (b) Stage 1/4's regression-test design specified a "non-empty stdout" assertion that no input (no-args or `--help`) can satisfy for either the broken or fixed guard state, since all 5 target scripts write their usage message to stderr and none support `--help`.
- **Round 3, human-completed (2026-07-31), replacing the automated revise+recheck step per explicit user instruction** (prepare-milestone's automated loop was taking too long across repeated generations; workflow-level `PlanAuthor` has no cross-generation resume analogous to `resumeFromAdjudicatedProposal`, so a caller-level relaunch would have discarded rounds 1-3's already-verified refinement and restarted PlanAuthor from scratch — see `tasks/DIR-124-D.md`'s newly-recorded scope addition for the general class of this gap). The automated loop's own control flow skips the revise step on its final round (`prepare-milestone.js`'s `while (_planCheckRound < MAX_PLANCHECK_ROUNDS)` loop breaks immediately after logging round 3's findings, before dispatching `plan-revise-round-3`) — this human pass performs exactly that skipped revise, plus the reverification a 4th automated round would otherwise have performed, still within the same 3-round budget (`milestone-preparation-check.ts`'s own receipt validator mechanically enforces `planCheck.rounds <= 3`; this receipt records `rounds: 3`, not 4, since no new round was opened). This pass:
  - Re-verified round 1 and round 2's fixes are still present and correct against the live repo (8-file touch set present; line counts re-checked via `wc -l` against all 8 files, exact match; `fileURLToPath` per-file specifics correct for all 5 consumer scripts).
  - Fixed both round 3 findings directly: Stage 5 exit check #1 now explicitly lists the `experiments/quay-perpetual-stream/test/*.test.mjs` files that must be run by path (mirroring Stage 4's existing pattern) in addition to the bare `scripts/test.sh` run; Stage 1/4's test-harness design now asserts stderr-non-empty + nonzero exit code (confirmed live via `grep process.stderr.write` against all 5 target scripts) instead of the unsatisfiable stdout assertion.
  - Re-confirmed AC coverage: all 8 task ACs map to >=1 stage (table above); base revision `28c3822` matches current HEAD.
  - Findings after this pass: F_3 = 0. Receipt authored via `milestone-preparation-check.ts --build` with `--plancheck-rounds 3 --plancheck-findings 0`, human-endorsed in place of the automated revise + a 4th agent-dispatched recheck.
