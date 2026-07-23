# M125 iteration-0 — DIR-062 child A: drivable-workspace gate + human-steered classifier

**Task:** `DIR-062-A`
**Charter:** `experiments/quay-perpetual-stream/charters/M125-dir062-a-drivable-workspace-gate.md`
**Class:** development, single-pass (halt-free mechanism, no driver file touched).

## What was done

1. `experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts` (+ `.sh` thin wrapper) — a
   fail-closed gate over `drivable-workspaces.yml`: PASS iff every given path is under
   `authorized_root` or an explicit `workspaces[]` entry (or its descendant); FAIL closed on any
   uncovered/missing/unparseable input. Uses the `yaml` package (already a dependency).
2. `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts` — a pure `classify()`
   function computing the 3 DIR-062 clauses (driver-file edit / mission-redirection /
   unauthorized-workspace), reusing `drivable-workspace-check.ts`'s `isCovered` as a library import
   (no subprocess, no duplicated coverage logic).
3. Registered `drivable-workspace` as a new `it0[]` gate entry in both `.quay/gates.yml` and
   `.quay/config.yml`.
4. Fixture-first sibling tests: `test/drivable-workspace-check.test.mjs` (26 tests),
   `test/human-steered-classify.test.mjs` (23 tests). **Correction (M125's own adversarial audit,
   non-blocking cosmetic finding):** this section originally said "28 + 21" — the real per-file
   counts, independently re-run by the audit, are 26 + 23 (combined 49/49 unchanged, and 49/49 is
   the only figure any AC/DoD clause actually cites).

## Real evidence

```
$ node experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts /tmp/x
FAIL: 1/1 workspace path(s) NOT covered by .../drivable-workspaces.yml: /tmp/x
$ echo $?
1

$ node experiments/quay-perpetual-stream/scripts/drivable-workspace-check.ts /home/yale/work/archguard
PASS: all 1 workspace path(s) covered by .../drivable-workspaces.yml: /home/yale/work/archguard
$ echo $?
0
```

```
$ node experiments/quay-perpetual-stream/scripts/human-steered-classify.ts --touched OUTER-LOOP.md
{ "humanSteered": true, "clauses": { "driverFileEdit": true, ... } }

$ node experiments/quay-perpetual-stream/scripts/human-steered-classify.ts --mission-redirection
{ "humanSteered": true, "clauses": { "missionRedirection": true, ... } }

$ node experiments/quay-perpetual-stream/scripts/human-steered-classify.ts --workspace /tmp/somewhere-not-registered
{ "humanSteered": true, "clauses": { "unauthorizedWorkspace": true, ... } }

$ node experiments/quay-perpetual-stream/scripts/human-steered-classify.ts --touched packages/quay/src/foo.ts --workspace /home/yale/work/quay
{ "humanSteered": false, ... }
```

End-to-end gate verification against the real `QC-T1` fixture task:
```
$ quay task edit QC-T1 --extra '{"drivableWorkspaceArgs":["/home/yale/work/archguard"]}'
$ quay gate QC-T1 --gate drivable-workspace
PASS

$ quay task edit QC-T1 --extra '{"drivableWorkspaceArgs":["/tmp/unlisted-x"]}'
$ quay gate QC-T1 --gate drivable-workspace
FAIL — acceptance failed (exit 1)
```
(Cleaned up afterward: `QC-T1.extra` restored to `{}` via `task_write`.)

```
$ quay gate --list | grep drivable-workspace
drivable-workspace
```

Test suites:
```
$ node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
tests 49, pass 49, fail 0

$ node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
drivable-workspace-check.ts: 97.86% lines, 93.02% branches, 100% funcs

$ node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
human-steered-classify.ts: 94.55% lines, 85.71% branches, 100% funcs

$ bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test
31 total, 8 pass, 23 N/A, 0 fail
PASS: every load-bearing script has a sibling *.test.mjs

$ node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .
PASS: 368 task(s) checked — no violations

$ node --test $(find experiments -name "*.test.mjs")
tests 525, pass 525, fail 0   (was 476/476 + 49 new)
```

## FILE-ONLY / no-driver-edit confirmation

`git status --short` before commit shows ONLY: the charter, this report, the 2 new scripts + `.sh`
wrapper, the 2 new test files, `.quay/gates.yml`/`.quay/config.yml` (gate-data registration, not a
driver file), and not-selected-note task files. No `OUTER-LOOP.md`/`inherited-core.md`/`.claude/skills/`
touched — matches this child's explicit scope boundary.

## Not in scope / deferred

- SELECT-wiring (actually using the classifier to gate autonomous SELECT) and the `inherited-core.md`
  definition edit — both DIR-062-B, human-steered, out of this child's scope.
