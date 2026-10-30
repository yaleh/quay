# AGENTS.md

Durable guidance for an AI agent (e.g. Codex) operating in THIS project. Laid down by
`quay init`. Concise by design — the repeatable workflows live in the quay Skills, not here.

## What this project uses

This project's task store is `quay` (a provider-agnostic task board). Task state is
authoritative through the Provider ABI (`.quay/config.yml`); transcripts and session notes
are diagnostic context, never authoritative state.

## The quay MCP server

Prefer the quay MCP server registered in `.codex/config.toml`: tools `task_list`,
`task_get`, `task_check`, `task_write`. If it is unavailable, degrade explicitly to the quay
CLI read path — never skip an authorization or a check because the MCP server is down.

## quay Skills (invoke explicitly)

- `$quay-task-operator` — bounded, human-authorized task read/check/create/edit transaction.
- `$quay-directive` — record a directive as a task-canonical `label:directive` task.

The skills are single-sourced in the quay plugin (`plugin/skills/`); `.agents/skills/` is the
Codex host surface and carries no copied policy.
