---
id: gap-quay-task-consolidated-subagent
title: Build quay-task consolidated subagent — single ABI-only entry point for
  all task CRUD/lifecycle
status: done
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

Implementation corrections applied at build time (worker, 2026-09-06 — three factual fixes to the design above, each reflected in the Plan/AC below):
1. **MCP tool namespace**: the correct namespace for a plugin-shipped surface is `mcp__plugin_quay_quay__*`, NOT the bare `mcp__quay__*` written in the design (SPEC-plugin-lifecycle-single-bundle §3c: exact-string match, no prefix alias; a correctly-onboarded downstream project sees ONLY `mcp__plugin_quay_quay__*`, so bare names are dead — the same bug `gap-skill-allowed-tools-plugin-namespace` already fixed for the `loop-driver`/`routines` skills). The agent uses `mcp__plugin_quay_quay__task_list/…/lifecycle_adjudicate` + `Read`.
2. **`packages/quay/plugin/` is a gitignored pack-time snapshot**, not a hand-maintained committed dual-copy (`.gitignore` has `packages/quay/plugin/`; `packages/quay/scripts/package.sh` generates it with `cp -R plugin/ → packages/quay/plugin/` right before `npm pack`). The agent is single-sourced at `plugin/agents/quay-task.md` and registered once in `plugin/.claude-plugin/plugin.json`; the second copy is byte-identical by construction.
3. **Live spawn deferred**: the registered `quay:quay-task` agent is dispatchable only after the plugin reloads (post-fan-in); it cannot be spawned from an isolated task worktree in this session. The structural guarantee is pinned statically instead (exact `tools:` set + absence of file/Bash tools), and the live create/edit/promote/complete + negative-control trace is a `（待外部）` verification.

## Plan

1. Draft `plugin/agents/quay-task.md` per the design above (name, description, tools frontmatter; body = the CRUD/lifecycle operating procedure: read+dedup via `task_list`/`task_get`, draft content per shape (mirroring `quay-file-task`'s shape-aware artifact discipline for creates), write via `task_write`, promote/retreat/complete via the `lifecycle_*` verbs, always read back after write).
2. (Corrected) Single-source the agent at `plugin/agents/quay-task.md` only — `packages/quay/plugin/` is a gitignored pack-time snapshot generated by `package.sh`, not a hand-maintained dual-copy; do not hand-write the gitignored path.
3. (Corrected) Add `"./agents/quay-task.md"` to the `"agents"` array in `plugin/.claude-plugin/plugin.json` (the single manifest source; `packages/quay/plugin/.claude-plugin/plugin.json` is generated from it at pack time).
4. (Corrected) Extend `plugin/test/plugin-packaging.test.mjs` to cover the new agent (registration + exact `tools:` set + absence of `Bash`/`Write`/`Edit`/`Grep`/`Glob` + plugin-quay namespace + `description` background instruction + body substance). `plugin/test/mirror-pair-drift-check.test.mjs` is the WRONG class for this (its mirror pair is `plugin/scripts` ↔ `experiments/quay-perpetual-stream/scripts`, not agents) — not extended.
5. (Deferred) The live spawn smoke-test (create/edit/promote/complete through the registered agent + captured trace + negative control) requires a plugin reload before `quay:quay-task` is dispatchable — deferred as `（待外部）`, pinned statically by the test suite in the meantime.

## Acceptance Criteria

- [x] `plugin/agents/quay-task.md` exists with `tools:` containing exactly the 9 MCP task/lifecycle verbs + `Read` in the plugin namespace `mcp__plugin_quay_quay__*` (SPEC §3c; the design's bare `mcp__quay__*` is dead downstream — see corrections), and NOT containing `Bash`/`Write`/`Edit`/`Grep`/`Glob` — pinned by `plugin/test/plugin-packaging.test.mjs` (parses the frontmatter, diffs the tool set against the expected list).
- [x] The agent is single-sourced at `plugin/agents/quay-task.md`; the `packages/quay/plugin/` copy is a gitignored pack-time snapshot generated by `package.sh`'s `cp -R` (byte-identity by construction) — verified by staging + `diff`, not a hand-maintained dual-copy (correcting the design's committed-dual-copy framing).
- [x] `plugin/.claude-plugin/plugin.json` lists `./agents/quay-task.md` in its `"agents"` array (the single manifest source; `packages/quay/plugin/.claude-plugin/plugin.json` is generated from it) — pinned by the extended M143 agents test in `plugin/test/plugin-packaging.test.mjs`.
- [x] The `description` field contains an explicit background-invocation instruction ("background" + "do not block"/"do not wait") — pinned by `plugin/test/plugin-packaging.test.mjs`.
- [x] The structural ABI-only guarantee is pinned statically: the test asserts the exact `tools:` set and the absence of every file/Bash tool, so the live enforcement is deterministic once the plugin reloads (a subagent's `tools:` is harness-enforced "No such tool available", structurally distinct from a skill's advisory `allowed-tools`).
- [x] `plugin/test/plugin-packaging.test.mjs` passes (37/37) and demonstrably covers the new file via four added assertions (exact tools / forbidden-absent + namespace / description background instruction / body substance), not by passing while ignoring it.
- [ ] Live end-to-end spawn of the registered `quay:quay-task` agent — create→edit→promote→complete a scratch task with a captured tool-call trace showing zero `Edit`/`Write`/`Bash`, plus a deliberate negative-control prompt for an out-of-allowlist tool — requires the plugin to reload before the new agent type is dispatchable, which cannot happen from an isolated task worktree in this session（待外部）

## Definition of Done

The `quay-task` subagent exists, is registered in the plugin manifest (`plugin/.claude-plugin/plugin.json` `"agents"`), and its structural ABI-only guarantee (exact `tools:` allowlist, no file/Bash tools) is pinned by `plugin/test/plugin-packaging.test.mjs` — shown, not asserted. The live end-to-end spawn (create→edit→promote→complete + captured trace) is deferred to a post-plugin-reload session (`（待外部）`). CLAUDE.md's routing pointer now names `quay:quay-task` as the preferred entry point for task mutation, so the routing steer this task depends on for adoption exists somewhere a future session reads.

## Touches

- `plugin/agents/quay-task.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `CLAUDE.md`
- `plugin/test/plugin-packaging.test.mjs`
- `tasks/gap-quay-task-consolidated-subagent.md` (self)
