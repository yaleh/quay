---
id: gap-init-worktree-root-default-written-unnormalized
title: quay init writes default loop.worktree_root with a literal /../ segment
  (string template, no path.resolve)
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Evidence origin: cold-start /quay:init on fresh dir /data/home/yale/work/quay-fleet, quay 0.19.0 (plugin cache), reported 2026-10-12 by the session "user/project scope 下的 quay 旧版本".
packages/quay/src/init.ts:1410 builds the default worktree root as a string template `${repoRoot}/../${basename}-worktrees` and persists it verbatim: loop.worktree_root = /data/home/yale/work/quay-fleet/../quay-fleet-worktrees. It resolves correctly and passes validateWorktreeRoot (xfs), and worktree-namespace.ts:24 documents that readers resolve it, so behaviour is correct; but a non-canonical path in config is a string-equality hazard for any consumer comparing paths. All other path fields (tasks_dir, QUAY_NATIVE_*_DIR, repo_root) are already normalized; this is the lone straggler. The tmpfs error hint at init.ts:1419 repeats the pattern. plugin/scripts/full-suite-runner.ts:912 already uses path.resolve (reference idiom).

## Plan
1. Use path.resolve(repoRoot, "..", basename + "-worktrees") at :1410 and :1419 so normalization happens BEFORE validateWorktreeRoot.
2. State explicitly in the task notes whether an existing non-normalized value read by readExistingLoopValue is preserved or rewritten; a user-supplied --worktree-root is always preserved as given; a re-run must report config unchanged (idempotent).
3. Rule 5b: grep init.ts and plugin/scripts for other "/../" template-string path constructions; report count and first 3 hits in the commit message.

## Acceptance Criteria
- [ ] init.test.mjs case: fresh init without --worktree-root persists a worktree_root with no ".." segment, equal to path.resolve(root, "..", basename + "-worktrees").
- [ ] A second init on the same workspace reports .quay/config.yml unchanged.
- [ ] An explicit --worktree-root is persisted exactly as given.
- [ ] `node --test packages/quay/test/init.test.mjs` exits 0.

## Definition of Done
All ACs ticked with output pasted; rule-5b count and first 3 hits recorded; preserve-vs-rewrite decision for existing values written in the notes.

## Touches
- packages/quay/src/init.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-worktree-root-default-written-unnormalized.md
