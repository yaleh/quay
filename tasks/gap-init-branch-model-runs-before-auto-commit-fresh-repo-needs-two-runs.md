---
id: gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs
title: "quay init: branch model is judged before auto-commit, so a fresh
  0-commit repo needs two runs and run 2 silently switches develop->author"
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
Minimal repro: `git init -b develop` (0 commits) then `quay init --root . --test-command X --auto-commit-confirm`. Run 1 prints "branch model: SKIPPED — the repository has no commits yet" and "doc branch ... [NOT-EVALUATED]", and only THEN "auto-commit: committed 5 file(s)". Run 2 prints "[CREATED] doc-branch -> author — created 'author' at 'develop' and switched the main checkout to it". So (i) a fresh repo cannot converge in one run, and (ii) run 2 changes the working branch with only a bracketed line as notice. Relevant code: autoCommitClosedSet (init.ts ~:3795, called ~:2075); the branch model is evaluated earlier (branch-model.ts, reason "no-commits"). The ordering rationale is UNKNOWN (intentional vs historical) and must be investigated first.

## Plan
1. Investigate and record in the task notes why the branch model precedes auto-commit (does it need config written first? does auto-commit need the branch settled?); git log / blame on both call sites.
2. Preferred: re-evaluate the branch model after auto-commit inside the same run so one init converges. Fallback if the order is load-bearing: emit an explicit "needs a second init run" line.
3. Either way the main-checkout switch must be named in the summary (old branch -> new branch), never only inside a [CREATED] line. The not-evaluated state keeps its own output value, never shaped like ok (rule 3b).

## Acceptance Criteria
- [ ] A test builds a 0-commit repo and runs init ONCE; the branch model ends decided, or an explicit asserted needs-rerun signal is present — not SKIPPED with no hint.
- [ ] A test asserts that when init switches the main checkout branch, the summary names both branches.
- [ ] Re-running init on the converged repo changes nothing (idempotent).
- [ ] `node --test packages/quay/test/init.test.mjs` exits 0.

## Definition of Done
Ordering rationale recorded; ACs ticked with output pasted; the chosen variant (re-evaluate vs explicit hint) justified in the notes.

## Touches
- packages/quay/src/init.ts
- packages/quay/src/branch-model.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs.md
