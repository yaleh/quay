---
id: gap-abi-missing-commit-delete-dependson-primitives
title: Provider ABI missing commit/delete/depends_on primitives — dispatch spine
  bypasses it structurally
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Investigation (2026-09-06 architecture audit of `provider-client.ts`/`abi.ts`/`mcp-handlers.ts`/`packages/quay-native/src/store.ts`) found the canonical Provider ABI surface is missing three primitives that make it structurally unable to be a sole backing implementation for task mutation:

1. **No commit verb.** `task_write` never invokes git (`store.ts` has zero `execFileSync`/`spawnSync`/git calls of any kind — verified). Every actual consumer of task state on the dispatch/lifecycle spine (`ready-pool-check.ts`, `slot-refill.ts`, `worker-driver.ts`, the Web UI's `observation.ts`) reads exclusively from `git show develop:tasks/<id>.md`, never disk. A `task_write`-only edit is therefore invisible to promotion/dispatch/landing/Web-live-status until *something else* commits and (if the write happened in a task worktree, not the main checkout) ff-merges it into `develop`. The disk value silently loses to the git-ref value — no error, indistinguishable from "the edit never happened" (CLAUDE.md 硬规则 3b/4b).
2. **No delete verb.** `task_delete`/`taskDelete` = 0 hits across `abi.ts`, `mcp-handlers.ts`, `provider-client.ts` (confirmed again just now: the live `task_write` MCP tool schema has no `depends_on` key and there is no sibling `task_delete` tool at all). The only way to remove a task today is `git checkout --`/`rm` directly on `tasks/<id>.md` (e.g. `plugin/skills/routines/SKILL.md` does exactly this).
3. **`depends_on` is extra-only, asymmetric.** `gap-task-write-schema-depends-on-documentation` (done) deliberately scoped itself to *documenting* the `extra.depends_on` escape hatch, not promoting it to a first-class top-level `task_write` parameter — the Zod schema still has no `depends_on` key. `readDependsOn()` parses it correctly from raw frontmatter, but `parseTask()` (the canonical parser after `gap-unified-frontmatter-parser`, done) still returns it as unreadable for consumers who don't know to reach into `extra`.

These three gaps are why the loop/driver layer (55% of all `tasks/*.md`-touching commits in the last 2 days, per audit) cannot be migrated onto the ABI as-is: any writer that only calls `task_write` produces dispatch-invisible writes, can't remove a task, and can't set a dependency without the undocumented escape hatch. This task is prerequisite to `gap-task-ops-consolidate-driver-frontmatter-writers` (a sibling task filed alongside this one) and to any future Claude-Code-side consolidated task-editing subagent.

Related (done, narrower scope, not duplicates): `gap-unified-frontmatter-parser` (unified 3 in-process parsers — `store.ts`/`task-schema.ts`'s `parseTask`/`readDependsOn` — but not `driver-filters.ts`/`worker-driver.ts`'s independent regex parsers); `gap-task-write-schema-depends-on-documentation` (documented the `extra` escape hatch, explicitly did not add a top-level param).

## Plan

1. **Commit strategy.** Add a commit primitive to the native provider's write path (or a thin wrapper the ABI's `task_write` handler calls after a successful disk write) that: (a) commits `tasks/<id>.md` alone (scoped pathspec, never `-A`); (b) is branch-aware — on the main checkout it commits to the current branch and may call the existing `propagateDocBranchToDevelop` (`plugin/scripts/driver-filters.ts`); inside a task worktree (`task/<id>` branch) it must NOT push directly to `develop` — it commits to the worktree's own branch, leaving the existing fan-in ff-merge (`packages/quay/src/fan-in/ff-merge.ts`) as the only path into `develop`. Reuse `commitTaskFile`'s atomicity discipline (`driver-filters.ts:221`, hard rule 11: no wait between `git add` and `git commit`) rather than reinventing it. Make the behavior opt-out-able per call (some callers, e.g. multi-file batch editors, need to commit once at the end, not per-write) but commit-by-default.
2. **`task_delete`.** Add a `task_delete(id)` ABI verb + native-provider implementation (`git rm`/unlink + the same branch-aware commit strategy from step 1). Fail-closed on an id that doesn't exist; no silent no-op.
3. **`depends_on` first-class.** Add `depends_on?: string[]` as a top-level `task_write` Zod parameter (alongside `expectedStatus`), continuing to write it into `extra.depends_on` on disk for backward compat with `readDependsOn()`, but also make `parseTask()` surface it directly (not nested) so callers don't need the `extra` escape hatch. Existing tasks with `extra.depends_on` must continue to read correctly (regression test).
4. Update `docs/references/task-schema-canonical.md` and the `task_write` tool description to reflect all three additions.

## Acceptance Criteria

- [ ] `packages/quay-native/src/store.ts` (or its `task_write` call path) commits `tasks/<id>.md` after a successful write when running from a git-tracked workspace — verified by: `task_write` a task via MCP, then `git log -1 --format=%H -- tasks/<id>.md` shows a NEW commit whose timestamp is after the call, without any other manual `git commit` in between.
- [ ] The commit step is branch-aware and does not push directly to `develop` from a `task/<id>` worktree — verified by a negative control: `task_write` inside a task worktree, then `git rev-parse develop` unchanged (only the worktree's own branch advances).
- [ ] `task_delete` exists as an ABI verb and a native-provider implementation — verified by: `task_delete` a scratch task via MCP, then `task_get` on the same id returns not-found AND `tasks/<id>.md` is absent from disk.
- [ ] `task_delete` on a non-existent id fails closed (non-zero exit / explicit error), not a silent success.
- [ ] `task_write`'s Zod schema exposes `depends_on` as a top-level array parameter — verified by printing the schema (or the MCP tool's `inputSchema`) and grepping for `depends_on` at the top level, not only inside `extra`.
- [ ] A task written with the new top-level `depends_on` param round-trips through `parseTask()` directly (not via `readDependsOn()`) — verified by a script that writes via the new param and reads the field back from `parseTask()`'s return value.
- [ ] Existing tasks using `extra.depends_on` (e.g. `tasks/gap-task-write-schema-depends-on-documentation.md`) still read correctly after the change — regression, not just new-path.
- [ ] `docs/references/task-schema-canonical.md` documents all three additions.

## Definition of Done

A native-provider consumer that performs ONLY `task_write`/`task_delete` MCP calls (no direct git, no direct fs) can: create a task with a dependency, have it become dispatch-visible without any separate manual commit step, and delete it — all three actually exercised against the running MCP server in this workspace, not a fixture/mock. Not done until `plugin/scripts/ready-pool-check.ts`'s dispatch computation (real invocation, not a unit test double) picks up a `task_write`-only change without an intervening manual commit.

## Touches

- `packages/quay-native/src/store.ts`
- `packages/quay-native/src/mcp-server.ts`
- `packages/quay/src/abi.ts`
- `packages/quay/src/provider-client.ts`
- `packages/quay/src/mcp-handlers.ts`
- `plugin/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema.ts`
- `docs/references/task-schema-canonical.md`
- `packages/quay-native/test/store.test.mjs`
- `packages/quay/test/provider-abi-conformance.test.mjs`
- `tasks/gap-abi-missing-commit-delete-dependson-primitives.md` (self)
