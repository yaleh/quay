---
id: gap-test-selection-not-scoped-to-touches
title: "No mechanical per-task test selection — the only options are one file by
  hand or the full 600s suite"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test.sh` runs the full suite (~600s measured 2026-08-02) or an explicitly named file.
There is nothing in between. Under the ≤1-hour-per-task target, running the full suite twice per
task (before and after) costs **20 minutes — 33% of the budget** — before any implementation work.

### This is already load-bearing but invisible

The 2026-08-02 fast-mode batch completed task 1.2 in 11 minutes and 1.3 in 7 minutes. **Neither is
possible with a 600s suite run**, so the executor was already selecting tests by hand. That worked,
but it is an undocumented judgment call: nothing records which tests were chosen, nothing verifies
the choice actually covered the changed surface, and a wrong choice produces a green signal over an
untested change.

Making the selection mechanical converts an invisible dependency into a checkable one, and is a
precondition for adding proposal/plan back within budget.

## Chosen mechanism

`experiments/quay-perpetual-stream/scripts/select-tests-for-touches.ts` (byte-identical
`plugin/scripts/` mirror): given a task id, emit the test files whose subject intersects that task's
`## Touches`.

Resolution, most-specific first — each rule is deterministic and independently checkable:

1. **Direct** — a Touches entry that is itself a `*.test.mjs` path
2. **Basename pair** — `<dir>/foo.ts` → any `*/test/foo.test.mjs` (the repo's dominant convention)
3. **Mirror fold** — `experiments/…/scripts/X.ts` and `plugin/scripts/X.ts` resolve to the same
   test set (mirrors are byte-identical by construction)
4. **Declared extra** — an optional `## Test-Files` section in the task body, for coupling a
   basename convention cannot see
5. **Unresolved** — a Touches entry matching no test is REPORTED, never silently dropped

Reuses `extractSection` from `task-schema.ts` for parsing; no new task-format surface.

**Fail-loud on thin coverage.** If a task changes N Touches files and the selector resolves tests
for fewer than half of them, it exits non-zero with `test-selection-thin` unless
`--allow-thin` is passed. Silent under-selection is the one failure mode that produces a false
green, so it must be the loud one.

**Integration.** `scripts/test.sh --for-task <id>` delegates to the selector and runs the resulting
set. The full-suite default and the explicit-file form are both unchanged — this is additive.

**Scope boundary.** This selects tests to run DURING a task. The full suite still runs at fan-in
before merge to master; that is unchanged and not this task's scope. Making the full suite itself
faster is [[gap-suite-speedup]].

## Acceptance Criteria

- [x] AC1: `select-tests-for-touches.ts` exists in both mirrors, byte-identical
- [x] AC2: Rule 1 (direct `*.test.mjs` in Touches) resolves to that file
- [x] AC3: Rule 2 (basename pair) resolves `scripts/foo.ts` → `*/test/foo.test.mjs`
- [x] AC4: Rule 3 (mirror fold) — the experiments and plugin paths of one module yield an identical set
- [x] AC5: Rule 4 — an optional `## Test-Files` section is honored when present
- [x] AC6: Rule 5 — a Touches entry resolving to no test appears in an `unresolved` list
- [x] AC7: `--json` emits `{taskId, selected: [...], unresolved: [...], coverageRatio}`
- [x] AC8: Thin coverage (<50% of Touches resolved) exits non-zero with `test-selection-thin`
- [x] AC9: `--allow-thin` downgrades AC8 to a warning and exits 0
- [x] AC10: `scripts/test.sh --for-task <id>` runs exactly the selected set
- [x] AC11: `scripts/test.sh` with no args is byte-for-behavior unchanged (full suite)
- [x] AC12: Measured on a real task — selected-set wall-clock recorded and compared against the full suite
- [x] AC13: The fast-mode prompt documents `--for-task` as the in-task test step, with the full suite reserved for fan-in

## Definition of Done

- [x] Both mirrors byte-identical; tests in `plugin/test/` cover AC2–AC9
- [x] Real measurement for AC12 pasted into the task
- [x] `scripts/test.sh` (no args) still green and unchanged in behavior

## Execution record (2026-08-02)

**AC12 measurement** — real task `gap-test-selection-not-scoped-to-touches` (this task; the fast-mode
task whose Touches resolve to exactly its own test file):

```
scripts/test.sh --for-task gap-test-selection-not-scoped-to-touches
  → 1 test file selected (plugin/test/select-tests-for-touches.test.mjs)
  → coverage 0.60 (3/5 Touches resolved: 2 script mirrors + the test file; docs + test.sh unresolved)
  → WALL-CLOCK 8.30s, exit 0, 16/16 tests pass
Full suite (no args): 378s most recently measured (B2-3 commit 0a6b7603, "full suite 378s ≤ 480s");
  the task body's own figure was ~600s measured 2026-08-02.
Ratio: 8.30 / 378 ≈ 2.2%  (≈ 45× faster; ≈ 72× vs the 600s figure).
Selector overhead alone: 0.36s. split-or-commit whole-store invariant: ~0.1s.
```

Also measured a larger real task, `gap-suite-speedup` (5 selected files: quay-github + quay +
quay-backlog mcp-server/cli/task-check-passthrough tests, coverage 0.75): the selected set completed
in 1.54s wall-clock in this worktree, but the package tests failed with `ERR_MODULE_NOT_FOUND`
(`@modelcontextprotocol/sdk`, `yaml`) because the fresh worktree has no `node_modules`. That is a
worktree-dependency artifact, not a code defect — the main checkout has those deps installed and the
canonical suite runs them. Primary AC12 datapoint above is dependency-free (plugin test only) and valid.

**Two-round adversarial review** (independent sub-agents, read the code + ran the tests themselves):
- Round 1 found one REAL shell BUG: `mapfile -t files <<< "${sel_out}"` on empty `sel_out` yields a
  1-element `[""]` array, so the empty-selection error branch was dead code and `node --test ""`
  ran → `Could not find ''`, breaking `--allow-thin` → exit-0. Fixed by guarding on `[ -z "${sel_out}" ]`
  (exit 2 task-not-found / exit 1 thin / exit 0 `--allow-thin`), plus `testBasenameFor` `.test.`
  collapse hardening and `--json`/`--paths-only` now forwarded to the selector instead of crashing
  `node --test`. Three regression tests added (missing-task exit 2, `--allow-thin` zero-selection
  exit 0, `testBasenameFor` collapse).
- Round 2 could not refute the fixes: 19/19 tests pass both directly and via `scripts/test.sh`; all
  manual shell probes (missing task → 2, thin → 1, `--allow-thin` → 0, no `Could not find ''`) pass;
  mirror byte-identity and symlink invocation confirmed. No CRITICAL/BUG findings; remaining items
  are documented edge cases.

**Files changed** (all in `## Touches`): the selector module + symlink mirror, the plugin test file,
`scripts/test.sh` (`--for-task` branch, additive), and `docs/analysis/fast-mode-execution-prompt.md`
(AC13).

## Touches

- experiments/quay-perpetual-stream/scripts/select-tests-for-touches.ts
- plugin/scripts/select-tests-for-touches.ts
- plugin/test/select-tests-for-touches.test.mjs
- scripts/test.sh
- docs/analysis/fast-mode-execution-prompt.md
