---
id: gap-init-summary-workspace-ready-prints-parent-dir
title: quay init summary prints 'Workspace ready at:' as the parent of the
  project (extra dirname)
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Evidence origin: cold-start /quay:init on fresh dir /data/home/yale/work/quay-fleet, quay 0.19.0 (plugin cache), reported 2026-10-12 by the session "user/project scope 下的 quay 旧版本".
packages/quay/src/init.ts:2271 prints `path.dirname(path.dirname(tasksDir))` for "Workspace ready at:". With tasksDir=<root>/tasks that is the PARENT of the workspace, while the next line `Tasks dir: ${tasksDir}` is correct, so the summary contradicts itself. Measured: root=/data/home/yale/work/quay-fleet printed `Workspace ready at: /data/home/yale/work`. The persisted config is right (loop.repo_root = the project dir); only the summary text is wrong.

## Plan
1. Print the resolved workspace root already in scope (repoRoot/root) instead of re-deriving it from tasksDir, so it does not depend on the tasks-dir naming convention.
2. Rule 5b: grep init.ts and packages/quay/src for other dirname(dirname( root derivations; put the hit count and first 3 hits in the commit message.

## Acceptance Criteria
- [x] A new case in packages/quay/test/init.test.mjs runs init on a temp workspace and asserts the "Workspace ready at:" line equals the --root value AND equals loop.repo_root read back from .quay/config.yml. —— new case at packages/quay/test/init.test.mjs:2203. It runs `quay init --root <subdir>` with the CWD set to the PARENT (the only shape that exposes the bug — when --root IS the CWD the two candidate answers coincide) and asserts the line equals the --root value, is NOT the parent, and equals `doc.loop.repo_root` parsed out of `.quay/config.yml`. `node --test --test-name-pattern="Workspace ready at:"` → pass 1, fail 0.
- [x] Negative control: with the old dirname(dirname()) expression restored the new case fails (failing output recorded in the task notes). —— restored `path.dirname(path.dirname(tasksDir))` in `printNextSteps` (init.ts backed up first, md5 98b60d6058402e0eed5ec2152d7f0c0c), re-ran the single case: it went RED with exactly the reported symptom (parent dir printed). Failing output pasted verbatim in ## Evidence below; init.ts then restored from the backup and re-verified at the same md5.
- [x] `node --test packages/quay/test/init.test.mjs` exits 0. —— tests 88, suites 0, pass 88, fail 0, cancelled 0, duration_ms 25787.87, process exit 0.

## Definition of Done
All ACs ticked with command output pasted; rule-5b grep count and first 3 hits recorded; no other init summary line changed.

## Evidence

### AC1 — the new case, green
$ node --test --test-name-pattern="Workspace ready at:" packages/quay/test/init.test.mjs
✔ printNextSteps: 'Workspace ready at:' is the --root ITSELF, and agrees with loop.repo_root (never the parent dir) (270.1159ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0

Manual reading of the fixed summary (`quay init --root $T/subdir`, cwd = $T):
  Workspace ready at: /tmp/initfix-mRDPs0/subdir
  Provider: native
  Tasks dir: /tmp/initfix-mRDPs0/subdir/tasks
and the config agrees: `grep repo_root $T/subdir/.quay/config.yml` → `repo_root: /tmp/initfix-mRDPs0/subdir`.

### AC2 — negative control: old expression restored ⇒ the new case FAILS
✖ printNextSteps: 'Workspace ready at:' is the --root ITSELF, and agrees with loop.repo_root (never the parent dir) (275.315834ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual   'Workspace ready at: /tmp/quay-init-ready-root-cDjxn6'
  - expected 'Workspace ready at: /tmp/quay-init-ready-root-cDjxn6/subdir'
      at TestContext.<anonymous> (file:///…/packages/quay/test/init.test.mjs:2220:10)
The `+ actual` line IS the reported defect: the parent of the workspace, printed as the workspace.
Restored: `cp /tmp/init.ts.ac2-backup <wt>/packages/quay/src/init.ts` → md5 98b60d6058402e0eed5ec2152d7f0c0c (== the pre-control backup) on both sides.

### AC3 — the full file, green
$ node --test packages/quay/test/init.test.mjs
ℹ tests 88  ℹ suites 0  ℹ pass 88  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0  ℹ todo 0  ℹ duration_ms 25787.868478
exit 0

### Rule 5b — other `dirname(dirname(` root derivations in packages/quay/src
The predicate had to be CORRECTED first (硬规则 2): the literal `dirname(dirname(` matches 0 hits, because
the real idiom carries the receiver — `dirname(path.dirname(`. Counts are for the corrected predicate.

  $ grep -rn 'dirname(path\.dirname(' packages/quay/src/ | wc -l
  7      # before the fix (6 after — init.ts:2453 was the only tasksDir-derived one, now gone)

First 3 hits, all inspected and DELIBERATELY left alone — each double-dirname is correct by
construction because it derives from `<root>/.quay/config.yml`, where two levels up really IS root:
  1. packages/quay/src/config.ts:32          const workspaceRoot = path.dirname(path.dirname(configPath));
  2. packages/quay/src/loaded-version.ts:133 return path.basename(dir) === "dist" ? path.dirname(path.dirname(dir)) : path.dirname(dir);
  3. packages/quay/src/driver-control.ts:38  return path.dirname(path.dirname(configPath));
(the remaining 3 are the same configPath idiom: mcp-server.ts:252, gate/config/loader.ts:117, cli/server.ts:155.)
The distinguishing property is the INPUT, not the expression: `configPath` is `<root>/.quay/config.yml`
(two levels down, so two levels up is the root), whereas `tasksDir` is `<root>/tasks` (ONE level down,
so the same expression overshoots to the parent). packages/quay-native's `path.dirname(tasksDir)`
carrier-dir defaults (adr/goals/meta) use a SINGLE dirname and were inspected and left alone.

### No other init summary line changed
The only line edited inside the printed block is `Workspace ready at:`; `Provider:` and `Tasks dir:`
are byte-identical (`git diff` on init.ts touches only that line plus the signature/doc-comment).

### Touches widening (transport, not scope creep)
The fix cannot live in init.ts alone — `printNextSteps`'s two callers must pass the root, so the
delta necessarily grew `packages/quay/src/cli/init.ts` and `packages/quay-native/bin/quay-native.ts`.
Both were added to `## Touches`; `anti-drift-touches-check.ts --task … --worktree … --merge-target develop`
⇒ `ANTI-DRIFT OK: … 4 actual file(s), all within declared Touches (5 glob(s))`.

## Touches
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-summary-workspace-ready-prints-parent-dir.md
