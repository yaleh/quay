# AGENTS.md

Durable guidance for an AI agent (e.g. Codex) operating in THIS repository. This is the
Codex-facing authority surface; it and the `.claude` surface resolve to ONE canonical
contract under `plugin/skills/` (single-source, enforced by
`scripts/agents-claude-drift-check.ts`). Concise by design — the repeatable workflows
live in the repository Skills, not here.

## What this repo is

`quay` is a provider-agnostic task board: a small Core CLI/MCP client plus a pluggable
Provider ABI. **The task store reached through the Provider ABI is the authoritative
state.** A task is `{id, title, status, role, labels, parent/children, body}`; `body`
markdown carries `## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done`.
Directives are TASK-CANONICAL (`label:directive` tasks — no `directives/*.md` file).
Transcript/session evidence is diagnostic context, NEVER authoritative state.

## Supported commands (MCP-first, CLI-fallback)

Prefer the project Quay MCP server (registered in `.codex/config.toml`) — tools
`task_list`, `task_get`, `task_check`, `task_write`. If Quay MCP is unavailable, degrade
EXPLICITLY and use the CLI fallback for the read path:

```
node packages/quay/bin/quay.ts task list --label directive --json
node packages/quay/bin/quay.ts task view <id> --json
node packages/quay/bin/quay.ts task check <id> --json
```

Missing MCP is degraded-but-working, never a reason to skip authorization or checks.

## Repository Skills (invoke explicitly)

- `$quay-task-operator` → canonical `plugin/skills/quay-task-operator/SKILL.md`: the
  bounded, human-authorized task read/check/create/edit transaction.
- `$quay-directive` → canonical `plugin/skills/quay-directive/SKILL.md`: record a
  directive as a task-canonical `label:directive` task.

`.agents/skills/*` are symlinks into `plugin/skills/` — they carry NO copied lifecycle
policy. Host invocation syntax (`$` vs `/`) is the only per-host difference.

## The write discipline (every mutation)

read + capability check → EXPLICIT human authorization → before-snapshot + semantic diff
→ `expectedStatus` CAS where applicable → immediate freshness re-read → MCP write →
MCP readback → task-schema check (`node plugin/scripts/task-schema-check.ts <file>`,
exit 0) → independent CLI readback → scoped Git diff + commit (ONLY the authorized task
artifact). A CAS conflict or an unrelated dirty-file overlap with the intended commit
path FAILS CLOSED. `expectedStatus` is NOT atomic same-status body CAS — do not claim it
is; if that guarantee is needed, file a separate provider-neutral product task.

## Concurrent-work protection

Commit only the authorized paths (never `git add -A`). Leave unrelated pre-existing
worktree changes untouched. One writer to canonical state at a time; if this workspace's
autonomous loop may run, do not race it on `master` (pause via its sentinel or use a
private worktree).

## Prohibited autonomous actions

This repository grants agents NO autonomous lifecycle authority. Every item below holds
in every session; a human-authorized conversation may lift one item for one action only.

<!-- PROHIBITED-AUTONOMOUS-ACTIONS: canonical list, mirrored verbatim from plugin/skills/quay-task-operator/SKILL.md; scripts/agents-claude-drift-check.ts asserts these two blocks stay set-identical. -->
- no independent AC/DoD ticking
- no task close or completion
- no SELECT or execute milestone
- no worker launch
- no merge, ABSORB, or schedule continuation
- no treating transcript/session evidence as authoritative state
<!-- /PROHIBITED-AUTONOMOUS-ACTIONS -->
