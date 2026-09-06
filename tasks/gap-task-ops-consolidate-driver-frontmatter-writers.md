---
id: gap-task-ops-consolidate-driver-frontmatter-writers
title: Consolidate loop-layer's 5 independent frontmatter parsers/writers into
  one library that owns commit+sync (task-ops.ts)
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-abi-missing-commit-delete-dependson-primitives
---
## Proposal

`gap-unified-frontmatter-parser` (done) unified the three IN-PROCESS parsers reachable from `packages/quay-native`/`plugin/scripts/task-schema.ts` (`store.ts parse()`, `task-schema.ts parseTask()`, `readDependsOn()`) behind `parseFrontmatterCompletely()`. It explicitly did NOT touch the loop/driver layer's own independent frontmatter readers/writers, which remain separate today (2026-09-06 audit, confirmed live in the current tree):

1. `plugin/scripts/driver-filters.ts` — hand-rolled regex parser + `commitTaskFile` (atomic add+commit), `applyStatusAlignments`, `markNeedsHuman`, `propagateDocBranchToDevelop`, `syncDevelopToDoc`, `syncDocDevelopBidirectional`.
2. `plugin/scripts/worker-driver.ts` — a fifth independent frontmatter-regex variant behind `commitTaskStatusChange`/`flipTaskDone` (the mechanical fan-in's `ready→done` flip — this is the actually-running production path: 100% of the traced 1031/1031 `.quay/fan-in-step-trace.jsonl` records in the 2026-09-04–09-05 window carry the `wk-prod` runId prefix that maps to this code path).
3. `plugin/scripts/ready-pool-check.ts` — `setTaskStatus`, `retreatReadyToTodo`, promotion-driver's `commitTaskStatus`; reads status exclusively via `git show develop:tasks/<id>.md` (documented rationale at `:2086-2089`: "the manager working branch's disk is a stale agent-proxy"), independent of the frontmatter-write side.

Each of these evolved its own regex/parse logic AND its own commit discipline, independently of `task-schema.ts`'s canonical `parseFrontmatterCompletely()` and independently of each other. `gap-mark-needs-human-commit-after-write` (done) already had to hand-patch ONE of these five call sites (`markNeedsHuman`) for a missing commit-after-write bug — a defect class this task exists to stop recurring by removing the duplication that let it happen five separate times.

This consolidation is the Node-side sibling of `gap-abi-missing-commit-delete-dependson-primitives` (this task depends on it): once the ABI gains a branch-aware commit primitive, the loop layer's five writers should call INTO that shared primitive instead of each re-implementing "parse frontmatter, mutate a field, write, `git add`+`commit`" from scratch. The goal is a single `task-ops.ts` library that `driver-filters.ts`, `worker-driver.ts`, and `ready-pool-check.ts` all import for: (a) frontmatter parse/patch (reusing `task-schema.ts`'s `parseFrontmatterCompletely`, not a sixth regex), (b) the branch-aware commit step (reusing the primitive filed in the sibling task), and (c) the doc↔develop sync calls. This does NOT change WHERE these drivers run (still Node processes, not Claude Code sessions) or WHAT branch model they use — it only removes the duplication so a defect fixed once (like the `markNeedsHuman` bug) can't recur in four other places, and so future logic (e.g. the new `task_delete`) has one call site to add it to instead of five.

Related (done, narrower — single call-site patches, not the underlying duplication): `gap-unified-frontmatter-parser`, `gap-mark-needs-human-commit-after-write`.

## Plan

1. Inventory the exact function surface each of the three files needs from a shared library: parse (read status/labels/extra/body sections), patch-one-field (status flip, label add/remove, append a `## Needs-Human` section), and commit (scoped `git add <path> && git commit`, hard rule 11 atomicity — no wait between add and commit).
2. Create `plugin/scripts/task-ops.ts` exposing that surface, implemented on top of `task-schema.ts`'s `parseFrontmatterCompletely()` (no new regex) and the branch-aware commit primitive from `gap-abi-missing-commit-delete-dependson-primitives` (or, if that task lands the primitive only inside `packages/quay-native`, a thin Node-side wrapper that calls it the same way the ABI would).
3. Migrate `driver-filters.ts`'s `applyStatusAlignments`/`markNeedsHuman`/`commitTaskFile` to call `task-ops.ts` instead of its own regex+writeFileSync+git sequence. Behavior must be unchanged for existing callers (regression, not rewrite).
4. Migrate `worker-driver.ts`'s `commitTaskStatusChange`/`flipTaskDone` the same way. This is the highest-traffic call site (100% of fan-in-step-trace in the audited window) — test against the mechanical fan-in path specifically, not just unit tests.
5. Migrate `ready-pool-check.ts`'s `setTaskStatus`/`retreatReadyToTodo`/`commitTaskStatus` the same way. Its `develop`-ref-read behavior (documented rationale at `:2086-2089`) is UNCHANGED by this task — only the WRITE side is consolidated.
6. Delete the now-dead regex/parse code from all three files; do not leave a parallel unused copy (mirrors `gap-plugin-loop-manager-drifted-copies-pointerize`'s dual-copy lesson — sever, don't shadow).
7. Also update the mirrored copy under `experiments/quay-perpetual-stream/scripts/` if `task-schema.ts` has a dual-copy there (per `gap-unified-frontmatter-parser`'s own Touches list, which named this file).

## Acceptance Criteria

- [x] `plugin/scripts/task-ops.ts` exists and is imported by `driver-filters.ts`, `worker-driver.ts`, AND `ready-pool-check.ts` — verified by `grep -l "from.*task-ops\|require.*task-ops" plugin/scripts/driver-filters.ts plugin/scripts/worker-driver.ts plugin/scripts/ready-pool-check.ts` returning all three files.
- [x] Zero independent frontmatter-parsing regexes remain in these three files outside what `task-ops.ts`/`task-schema.ts` provide — verified by grepping each file for a standalone `/^status:/`-style frontmatter regex (the pattern used before this task) and confirming none remain outside `task-ops.ts` itself.
- [x] `plugin/test/driver-filters.test.mjs`, `plugin/test/worker-driver.test.mjs`, `plugin/test/worker-driver-fan-in.test.mjs`, `plugin/test/ready-pool-check.test.mjs` all still pass unmodified in behavior (green), proving the migration is behavior-preserving.
- [x] The mechanical fan-in path (`worker-driver.ts`'s `flipTaskDone`) still produces a real commit after a `ready→done` flip — verified end-to-end against a scratch task, not a mock: flip status, confirm `git log -1 -- tasks/<scratch-id>.md` shows a new commit.
- [x] `markNeedsHuman`'s commit-after-write behavior (the bug `gap-mark-needs-human-commit-after-write` fixed once) is now enforced by the shared `task-ops.ts` commit primitive, not by a call-site-local fix — verified by reading the diff and confirming `markNeedsHuman` no longer has its own git-add/commit call, only a `task-ops.ts` call.
- [x] `ready-pool-check.ts`'s `develop`-ref read behavior for dispatch computation is unchanged (negative control — this task touches only the write side).

## Definition of Done

A single library owns "parse task frontmatter, mutate a field, commit it" for the loop/driver layer; the five independent implementations found in the 2026-09-06 audit are reduced to one, exercised by all three real call sites (not just a new unit test double), and the actually-running production path (`worker-driver.ts`'s mechanical fan-in, 100% of current fan-in-step-trace volume) is verified end-to-end against a real commit, not a fixture.

## Touches

- `plugin/scripts/task-ops.ts` (new)
- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema.ts`
- `plugin/scripts/capability-catalog.sh` (register the new script per its own header rule for new `plugin/scripts/*.ts` files)
- `plugin/scripts/quay-init.sh` (add task-ops.ts to the explicit `--loop` laydown list — it is the ESM dep of laid-down driver-filters/worker-driver/ready-pool-check, invisible to closure step d)
- `plugin/scripts/quay-init-closure-ratchet.ts` (re-anchor the shrink-only laydown baseline to the new measured footprint — +1 file for task-ops.ts the shared library, -9365 bytes net from the dedup)
- `plugin/test/driver-filters.test.mjs`
- `plugin/test/worker-driver.test.mjs`
- `plugin/test/worker-driver-fan-in.test.mjs`
- `plugin/test/ready-pool-check.test.mjs`
- `plugin/test/task-ops.test.mjs` (new)
- `tasks/gap-task-ops-consolidate-driver-frontmatter-writers.md` (self)
