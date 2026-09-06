---
id: gap-worker-prompt-ac-check-via-abi-not-hand-edit
title: worker-driver.ts acCheckNote() instructs hand-editing AC checkboxes —
  migrate to task_check/task_write
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

2026-09-06 architecture-audit discussion (provider ABI usage/design) traced the single highest-volume Claude-Code-reachable ABI-bypass site to a specific function: `acCheckNote()` (`plugin/scripts/worker-driver.ts:937-944`), whose current text instructs every dispatched worker to hand-edit markdown:

> "then in the worktree task body `## Acceptance Criteria` check off every satisfied criterion as `- [x]` (turn `- [ ]` into `- [x]`), committing these AC checkbox updates together with your implementation in the same commit"

This single function is referenced from BOTH prompt builders — `buildWorkerPrompt()` (`:1000`, fresh dispatch) and `buildContinueWorkerPrompt()` (`:1650`, continue-reuse dispatch) — confirmed by grep, so one fix covers both paths, not just the common one. It is the reason a majority of the 159 traced worker sessions in the 2026-09-03→09-05 audit window (0 ABI calls, 365 direct task-file writes) never call `task_write`/`task_check` for AC bookkeeping: the dispatch prompt itself tells them not to. Of the 245 task-touching commits in that window, 54 ("worker 代码提交顺带勾 AC") are this exact pattern. It is also the class of defect `gap-mark-needs-human-commit-after-write` (done) already had to patch once for a DIFFERENT call site (`markNeedsHuman`) — this task is the worker-prompt sibling of that same "hand-rolled write outside the ABI" family.

This is the highest-leverage single change identified in the audit for migrating the autonomous loop's Claude-Code-reachable writes onto the ABI: it is a Claude Code session (unlike the 55% of task-touching commits that come from bare Node driver processes, which this change cannot reach), and it is the one instruction template that governs essentially all worker AC-ticking behavior today.

**Depends on `gap-abi-missing-commit-delete-dependson-primitives`**: today `task_write` performs no git commit. If `acCheckNote()` is migrated to call `task_write` without that sibling task's branch-aware commit primitive landing first, the worker would still need to manually `git add`/`git commit` the resulting disk change itself — no net simplification, and a real risk of the AC update silently not being picked up by fan-in's ac-precheck (which reads the git-committed state) if the manual commit step is dropped in the rewrite. Do not implement this task until the commit primitive exists.

## Plan

1. Rewrite `acCheckNote()` to instruct: verify each AC is satisfied, then call `task_check` to confirm, then call `task_write` with the updated `## Acceptance Criteria` section (checked items as `- [x]`) to record it — explicitly telling the worker NOT to hand-edit the checkbox characters in the file directly.
2. In the same prompt text, explicitly separate the tool-choice rule for CODE files (`Edit`/`Write` against the worktree's absolute path — unchanged, still correct) from the tool-choice rule for the TASK file (`task_write` MCP, never `Edit`/`Write`) — the existing "⚠️ CRITICAL: every Read/Edit/Write file_path MUST be the absolute path of the worktree" sentence in `buildWorkerPrompt()` must not be read by the worker as also applying to the task file, or the fix regresses on the next prompt edit (mirrors CLAUDE.md hard rule 5b: fixing one call site is not fixing the pattern everywhere it appears).
3. Confirm `task_write` (called from inside the worktree, on the `task/<id>` branch) commits per the branch-aware strategy from the sibling task — i.e. it must commit to the worktree's own branch, not attempt to push `develop` directly, matching the existing merge-back-via-fan-in flow.
4. Update `buildContinueWorkerPrompt()`'s call site (`:1650`) — verify it inherits the fix automatically via the shared `acCheckNote()` (expected, since both call sites reference the same function), and add a regression assertion so a future edit that forks the two prompts can't silently regress one of them.

## Acceptance Criteria

- [ ] `plugin/scripts/worker-driver.ts`'s `acCheckNote()` no longer contains the literal instruction to turn `- [ ]` into `- [x]` by hand — verified by `grep -c "turn \`- \[ \]\` into \`- \[x\]\`" plugin/scripts/worker-driver.ts` returning 0.
- [ ] `acCheckNote()`'s new text explicitly names `task_check` and `task_write` as the mechanism for recording AC state — verified by grep.
- [ ] Both `buildWorkerPrompt()` (`:1000`) and `buildContinueWorkerPrompt()` (`:1650`) still reference `acCheckNote()` (single source, not forked into two copies) — verified by grep count = 2 call sites, 1 definition.
- [ ] The rewritten prompt text distinguishes code-file tool choice (`Edit`/`Write`, worktree absolute path) from task-file tool choice (`task_write` MCP) explicitly enough that a fresh reading of the full `buildWorkerPrompt()` output does not leave "which tool for the task file" ambiguous — verified by a human/LLM read of the rendered prompt string, not just a grep.
- [ ] A live end-to-end test: dispatch a real worker against a scratch task with at least one unchecked AC, let it complete, and confirm the AC was ticked via a `task_write` call (not a raw markdown edit) — verified by inspecting the worker's tool-call transcript for a `task_write` call whose body contains the checked AC, and confirming no `Edit`/`Write` tool call touched `tasks/<scratch-id>.md`.
- [ ] `plugin/test/worker-driver.test.mjs`, `plugin/test/worker-driver-fan-in.test.mjs`, and `plugin/test/worker-driver-resident.test.mjs` pass after the change (regression, not just the new behavior).
- [ ] Fan-in's ac-precheck still correctly detects a genuinely-unchecked AC as a failure after this change (negative control — the new path must not accidentally make ac-precheck unable to see unchecked items).

## Definition of Done

A real worker dispatched against a real task ticks its Acceptance Criteria via `task_check`/`task_write`, not a hand markdown edit, end-to-end through the actual mechanical fan-in path (not a fixture) — and the resulting commit is still visible to fan-in's ac-precheck exactly as a hand-edited one would have been. Not done until this is demonstrated against a real dispatched worker, not only a rewritten prompt string that nobody has actually run.

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `plugin/test/worker-driver-fan-in.test.mjs`
- `plugin/test/worker-driver-resident.test.mjs`
- `tasks/gap-worker-prompt-ac-check-via-abi-not-hand-edit.md` (self)
