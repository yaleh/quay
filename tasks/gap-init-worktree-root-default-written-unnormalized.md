---
id: gap-init-worktree-root-default-written-unnormalized
title: quay init writes default loop.worktree_root with a literal /../ segment
  (string template, no path.resolve)
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
packages/quay/src/init.ts:1410 builds the default worktree root as a string template `${repoRoot}/../${basename}-worktrees` and persists it verbatim: loop.worktree_root = /data/home/yale/work/quay-fleet/../quay-fleet-worktrees. It resolves correctly and passes validateWorktreeRoot (xfs), and worktree-namespace.ts:24 documents that readers resolve it, so behaviour is correct; but a non-canonical path in config is a string-equality hazard for any consumer comparing paths. All other path fields (tasks_dir, QUAY_NATIVE_*_DIR, repo_root) are already normalized; this is the lone straggler. The tmpfs error hint at init.ts:1419 repeats the pattern. plugin/scripts/full-suite-runner.ts:912 already uses path.resolve (reference idiom).

## Plan
1. Use path.resolve(repoRoot, "..", basename + "-worktrees") at :1410 and :1419 so normalization happens BEFORE validateWorktreeRoot.
2. State explicitly in the task notes whether an existing non-normalized value read by readExistingLoopValue is preserved or rewritten; a user-supplied --worktree-root is always preserved as given; a re-run must report config unchanged (idempotent).
3. Rule 5b: grep init.ts and plugin/scripts for other "/../" template-string path constructions; report count and first 3 hits in the commit message.

## Acceptance Criteria
- [x] init.test.mjs case: fresh init without --worktree-root persists a worktree_root with no ".." segment, equal to path.resolve(root, "..", basename + "-worktrees"). —— `worktree_root default: … persists the RESOLVED sibling — no '..' segment` PASSES; asserts equality with `path.resolve(ws, "..", basename(ws)+"-worktrees")` AND no `..` segment AND (negative control) that the string differs from what the old template wrote. Mutation control: reverting only the `path.resolve` line reds this test and only this test.
- [x] A second init on the same workspace reports .quay/config.yml unchanged. —— `worktree_root default: a SECOND init … reports .quay/config.yml unchanged (idempotent)` PASSES: file byte-identical (`assert.equal` on the full text) and stdout matches `/unchanged: \.quay\/config\.yml/`. Not a discriminator for this fix (the old template was idempotent too) — it guards against a fix that normalizes on write but reads back a different spelling and churns.
- [x] An explicit --worktree-root is persisted exactly as given. —— `worktree_root explicit: --worktree-root is persisted EXACTLY as given — never normalized` PASSES: a deliberately non-canonical `<ws>/../<base>-explicit-wt` round-trips verbatim, asserted `notEqual(path.resolve(given), given)` (fixture is non-vacuous) and `notEqual(persisted, path.resolve(given))` (init did not normalize it).
- [x] `node --test packages/quay/test/init.test.mjs` exits 0. —— exit code 0; `ℹ tests 87 / ℹ pass 87 / ℹ fail 0`. Re-run after restoring from the mutation control: same 87/87.

## Definition of Done
All ACs ticked with output pasted; rule-5b count and first 3 hits recorded; preserve-vs-rewrite decision for existing values written in the notes.

## Notes
**Preserve-vs-rewrite decision (Plan item 2): existing values are PRESERVED, not rewritten.** Only the DEFAULT is normalized. `resolveProjectLoopValues` keeps its documented precedence explicit → existing → default: an explicit `--worktree-root` is persisted verbatim, and an existing `loop.worktree_root` read back by `readExistingLoopValue` is persisted verbatim. Rationale: silently rewriting one of the four project-derived loop values would be an unrequested edit to a file this command's whole doctrine is to preserve, and `repo_root`/`test_command`/`tmux_session` behave the same way. Consequence, stated so it is not a surprise: a config written by an older quay KEEPS its `/../` spelling until the operator changes it (delete the key to re-derive the default, or pass `--worktree-root`). What this fix guarantees is only that quay never WRITES that spelling itself again. Idempotence (AC2) is preserved because the resolved default equals what the first run wrote, so the per-key merge in `writeInitConfig` sees `current === value` and reports the config unchanged. Measured on both arms: re-running init over a config holding a non-canonical value left the value untouched (exit 0), and re-running over a config holding the new canonical default left the file byte-identical with `unchanged: .quay/config.yml (already current for this version of quay — version-level defaults present, not rewritten)`.

**Implementation.** `packages/quay/src/init.ts` — hoisted the default into `const defaultWorktreeRoot = path.resolve(repoRoot, "..", \`${path.basename(repoRoot)}-worktrees\`)`, used at BOTH former template sites (the assignment at :1434 and the tmpfs failure hint that repeated the pattern), so the two can no longer drift apart. Normalization happens before `validateWorktreeRoot`, so the tmpfs probe and the written value are the same string. `repoRoot` defaults to `root`, so the AC's `path.resolve(root, "..", …)` spelling is the same expression. Single-writer check: `plugin/scripts/quay-init.sh` is a 38-line pass-through shim to `quay init` with no worktree logic of its own, so the TS site is the only writer (硬规则 5b).

**Rule 5b (Plan item 3) — same defect class elsewhere, with the predicate stated so the count is reproducible.**
Predicate A — an interpolated/template path literal containing a `/../` segment, in TS/JS/MJS, repo-wide (`packages/ plugin/ experiments/ scripts/`, excluding `node_modules` and comment lines): **0 hits in production code.** Pre-fix `init.ts` had 2 (exactly the two lines this task named); post-fix the only 4 hits repo-wide are TEST FIXTURES that deliberately feed a non-canonical value — `packages/quay/test/observation-worktree-namespace.test.mjs:102` plus the 3 in this change. Negative control for the predicate: run against `git show develop:packages/quay/src/init.ts` it prints exactly the 2 pre-fix lines, so the zero is a reading, not a broken grep.
Predicate B — a shell `"${VAR}/../"` interpolation, excluding `cd … && pwd` (which canonicalizes) and comment lines: **13 hits.** First 3:
  1. `plugin/scripts/checker-mutation-cases/release-master-advance-needs-check.sh:214`
  2. `plugin/scripts/develop-deliver-tgz.sh:432`
  3. `plugin/scripts/develop-deliver-tgz.sh:434`
Exactly ONE of the 13 feeds a worktree root: `plugin/scripts/verify-deliver-coldstart.sh:8803` (`WORKTREE_ROOT="${ROOT}/../${PROJECT}-worktrees"`). That is the cold-start harness's own default for its `--worktree-root` flag — an EXPLICIT value, which this fix deliberately preserves verbatim — so it propagates a non-canonical spelling into the config it produces but is NOT the defect fixed here (quay manufacturing and persisting a default). The other 12 are `$SCRIPT_DIR/../..`-style joins for reading a single file, where no consumer compares the string. Left as-is: changing them is outside this task's Touches, and one of them (`verify-deliver-coldstart.sh`, 8800+ lines of cold-start e2e) is a shipped carrier whose edit has its own blast radius.

## Touches
- packages/quay/src/init.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-worktree-root-default-written-unnormalized.md
