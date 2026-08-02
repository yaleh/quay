---
id: gap-test-selection-not-scoped-to-touches
title: "No mechanical per-task test selection — the only options are one file by
  hand or the full 600s suite"
status: todo
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

- [ ] AC1: `select-tests-for-touches.ts` exists in both mirrors, byte-identical
- [ ] AC2: Rule 1 (direct `*.test.mjs` in Touches) resolves to that file
- [ ] AC3: Rule 2 (basename pair) resolves `scripts/foo.ts` → `*/test/foo.test.mjs`
- [ ] AC4: Rule 3 (mirror fold) — the experiments and plugin paths of one module yield an identical set
- [ ] AC5: Rule 4 — an optional `## Test-Files` section is honored when present
- [ ] AC6: Rule 5 — a Touches entry resolving to no test appears in an `unresolved` list
- [ ] AC7: `--json` emits `{taskId, selected: [...], unresolved: [...], coverageRatio}`
- [ ] AC8: Thin coverage (<50% of Touches resolved) exits non-zero with `test-selection-thin`
- [ ] AC9: `--allow-thin` downgrades AC8 to a warning and exits 0
- [ ] AC10: `scripts/test.sh --for-task <id>` runs exactly the selected set
- [ ] AC11: `scripts/test.sh` with no args is byte-for-behavior unchanged (full suite)
- [ ] AC12: Measured on a real task — selected-set wall-clock recorded and compared against the full suite
- [ ] AC13: The fast-mode prompt documents `--for-task` as the in-task test step, with the full suite reserved for fan-in

## Definition of Done

- [ ] Both mirrors byte-identical; tests in `plugin/test/` cover AC2–AC9
- [ ] Real measurement for AC12 pasted into the task
- [ ] `scripts/test.sh` (no args) still green and unchanged in behavior

## Touches

- experiments/quay-perpetual-stream/scripts/select-tests-for-touches.ts
- plugin/scripts/select-tests-for-touches.ts
- plugin/test/select-tests-for-touches.test.mjs
- scripts/test.sh
- docs/analysis/fast-mode-execution-prompt.md
