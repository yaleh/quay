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
- [ ] A new case in packages/quay/test/init.test.mjs runs init on a temp workspace and asserts the "Workspace ready at:" line equals the --root value AND equals loop.repo_root read back from .quay/config.yml.
- [ ] Negative control: with the old dirname(dirname()) expression restored the new case fails (failing output recorded in the task notes).
- [ ] `node --test packages/quay/test/init.test.mjs` exits 0.

## Definition of Done
All ACs ticked with command output pasted; rule-5b grep count and first 3 hits recorded; no other init summary line changed.

## Touches
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-summary-workspace-ready-prints-parent-dir.md
