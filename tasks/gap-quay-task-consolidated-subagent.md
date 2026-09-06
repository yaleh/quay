---
id: gap-quay-task-consolidated-subagent
title: Build quay-task consolidated subagent — single ABI-only entry point for
  all task CRUD/lifecycle
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-09-06 architecture-audit discussion (provider ABI usage/design) concluded that of 22+ task-related Claude Code extensions, only `quay-file-task` sees real use (14 invocations/2.6 days), while ABI compliance is otherwise split: human-facing sessions use `task_write`/`task_get` reasonably (140 ABI calls vs 165 direct writes), but the autonomous loop's worker sessions make ZERO ABI calls against 365 direct task-file writes. The proposal (user-directed, keep Provider ABI/MCP as the underlying implementation, consolidate user-facing task CRUD into a single Claude Code extension) is to build one subagent that is the sole intended entry point for task mutation, made structurally incapable of bypassing the ABI (not just documented as preferring it) via the harness's hard-enforced subagent `tools:` allowlist — unlike a skill's `allowed-tools`, which is advisory only (confirmed: `quay-task-operator`'s SKILL.md grants `Bash, Read, Write, Edit` despite being the current ABI-compliance exemplar; a subagent's `tools:` field is structurally enforced — the harness returns "No such tool available" for anything outside it, verified against `claude-code-guide` platform-behavior research in this session).

Design decided in-conversation (not re-derived here, applied verbatim):
- New file (dual-copy, mirroring `plugin/agents/baime-iteration-executor.md`'s registration pattern): `plugin/agents/quay-task.md` + `packages/quay/plugin/agents/quay-task.md`, registered in the `"agents"` array of both `plugin/.claude-plugin/plugin.json` and `packages/quay/plugin/.claude-plugin/plugin.json`.
- `tools:` frontmatter = exactly: `mcp__quay__task_list, mcp__quay__task_get, mcp__quay__task_write, mcp__quay__task_check, mcp__quay__gate_run, mcp__quay__lifecycle_promote, mcp__quay__lifecycle_retreat, mcp__quay__lifecycle_complete, mcp__quay__lifecycle_adjudicate, Read`. Deliberately NO `Bash`, `Write`, `Edit`, `Grep`, `Glob` — this is what makes bypass structurally impossible for calls originating inside this subagent (it cannot reach `git checkout --`/`sed -i`/raw file edits at all, not merely "shouldn't"). `task_delete` is NOT included yet — the ABI has no such verb (tracked separately in `gap-abi-missing-commit-delete-dependson-primitives`); the subagent must respond to delete requests by naming that known gap, not by falling back to any file operation.
- Dedup-by-mechanism (the discipline `quay-file-task` already applies) is achievable with this tool set alone: `task_list`'s `search` parameter does case-insensitive substring match on title+body, so "grep tasks/*.md for a mechanism keyword" becomes `task_list({search: "<keyword>"})` — no filesystem/Bash access needed for this step.
- `description:` frontmatter must do double duty: (a) trigger-rich enough that Claude Code's routing model picks this agent for task CRUD/lifecycle requests instead of hand-editing `tasks/*.md`, and (b) contain an EXPLICIT instruction that this agent be invoked asynchronously/in the background — phrased for the CALLER (who reads this description at dispatch time, before choosing whether to await), not for the agent's own runtime, since "await or not" is the calling context's decision, made before the subagent starts running. Suggested wording (adjust to fit house style): "Always invoke this agent in the background — do not block your turn waiting for its result; it reports back via the normal task-notification/SendMessage channel when done, the same pattern already used for manager→outer task filing." This mirrors an established precedent in this project (manager creates tasks by messaging outer asynchronously) rather than inventing a new one.
- Internally the agent must still write synchronously and read back its own writes (`task_get`/`task_check` after every `task_write`) before reporting done — "invoke me asynchronously" (caller-side) is orthogonal to "verify my own writes before claiming success" (agent-side); conflating them would reintroduce the exact self-assertion-without-evidence failure this project's CLAUDE.md already warns against.

Known, accepted limitation (not in scope for this task, tracked as a separate decision): NO PreToolUse hook is being added to block direct `tasks/*.md` writes from other sessions/skills. This subagent's tool allowlist protects only calls originating from within it — it does not stop another session from continuing to `Edit`/`git commit` a task file directly. This task does not change that; it only makes the ABI-compliant path exist and be structurally clean.

## Plan

1. Draft `plugin/agents/quay-task.md` per the design above (name, description, tools frontmatter; body = the CRUD/lifecycle operating procedure: read+dedup via `task_list`/`task_get`, draft content per shape (mirroring `quay-file-task`'s shape-aware artifact discipline for creates), write via `task_write`, promote/retreat/complete via the `lifecycle_*` verbs, always read back after write).
2. Copy byte-identical to `packages/quay/plugin/agents/quay-task.md` (dual-copy, per the existing `baime-iteration-executor.md` mirror pattern).
3. Add `"./agents/quay-task.md"` to the `"agents"` array in both `plugin/.claude-plugin/plugin.json` and `packages/quay/plugin/.claude-plugin/plugin.json`.
4. Extend or confirm `plugin/test/mirror-pair-drift-check.test.mjs` and `plugin/test/plugin-packaging.test.mjs` cover the new agent file (dual-copy byte-identity + plugin.json registration) — these already exist for this class of check; verify they pick up the new file rather than writing a third parallel checker.
5. Smoke-test: spawn the `quay-task` subagent with a real scratch-task create/edit/promote/complete request end-to-end; capture its tool-call trace and confirm no `Edit`/`Write`/`Bash` call appears anywhere in it.

## Acceptance Criteria

- [ ] `plugin/agents/quay-task.md` exists with `tools:` containing exactly the MCP task/lifecycle verbs + `Read` listed in the Proposal, and NOT containing `Bash`, `Write`, `Edit`, `Grep`, or `Glob` — verified by parsing the frontmatter and diffing the tool set against the expected list.
- [ ] `packages/quay/plugin/agents/quay-task.md` is byte-identical to `plugin/agents/quay-task.md` — verified by `diff`.
- [ ] Both `plugin/.claude-plugin/plugin.json` and `packages/quay/plugin/.claude-plugin/plugin.json` list `./agents/quay-task.md` in their `"agents"` array — verified by `grep`.
- [ ] The `description` field contains an explicit background-invocation instruction — verified by grepping for "background" and a phrase equivalent to "do not block"/"do not wait" in the frontmatter text.
- [ ] A live end-to-end smoke test (spawn the actual `quay-task` subagent, not a mock): create a scratch task, edit it, promote it, complete it, entirely through this subagent — the orchestrating session makes zero direct `task_write`/`Edit` calls of its own during the test.
- [ ] The captured tool-call trace from that smoke test contains zero `Edit`, `Write`, or `Bash` tool invocations by the `quay-task` subagent.
- [ ] Attempting to have the subagent call a tool outside its allowlist (e.g. `Bash`) in a deliberate negative-control prompt fails with a harness-level "tool not available" error, not a permission prompt or silent success — confirming the restriction is structural, not advisory.
- [ ] `plugin/test/mirror-pair-drift-check.test.mjs` and `plugin/test/plugin-packaging.test.mjs` pass and demonstrably cover the new file (not just happen to still pass because they don't look at it).

## Definition of Done

The `quay-task` subagent exists, is registered in both plugin.json copies, and has been exercised end-to-end against a real scratch task (create→edit→promote→complete) with a captured tool-call trace proving zero direct file/Bash access — not asserted, shown. CLAUDE.md's cross-session-driving pointer table or a comparable routing pointer should mention it as the preferred entry point for task mutation (a doc update, not a behavior change, but necessary so the routing steer this task depends on for adoption actually exists somewhere a future session reads).

## Touches

- `plugin/agents/quay-task.md` (new)
- `packages/quay/plugin/agents/quay-task.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `packages/quay/plugin/.claude-plugin/plugin.json`
- `CLAUDE.md`
- `plugin/test/mirror-pair-drift-check.test.mjs`
- `plugin/test/plugin-packaging.test.mjs`
- `tasks/gap-quay-task-consolidated-subagent.md` (self)
