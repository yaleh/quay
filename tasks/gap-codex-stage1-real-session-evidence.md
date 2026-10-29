---
id: gap-codex-stage1-real-session-evidence
title: 真实 Codex 会话完成一次授权 operator 交易并留证据
status: needs-human
labels:
  - gap
  - codex
  - needs-human
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-929
---
## Proposal

DIR-121 的 fresh-session AC（4/6/7/8）因需要「真实 Codex 会话 + 显式人授权」从未闭合，且 DIR-121 被无理由 superseded（HARD terminal，不可复活，SPEC §3.1）。本任务重新立案这半边：人开一个 fresh Codex 会话，用 `$quay-task-operator` 做一次真实编辑 + 一次真实建任务，证据提交进 `docs/codex-stage1/evidence.json` 并经 live-proof-check 验证。⛔ 禁止用 fixture/probe/evidence-only 任务顶替（DIR-121 反伪造 bar 原样保留）。

## Plan

1. 人在 fresh 检出开 Codex 会话，确认加载 `AGENTS.md` + 两个 Skill（`$quay-task-operator`、`$quay-directive`）。
2. `$quay-task-operator` 做一次真实编辑（现有任务）+ 一次真实建任务，均显式人授权。
3. 记录证据：session 引用、before/after hash 或 semantic diff、MCP readback、CLI readback、CAS 拒绝记录、scoped commit SHA。
4. 证据写入 `docs/codex-stage1/evidence.json` 并提交进 goal/GOAL-912 分支。
5. `node plugin/scripts/codex-stage1-live-proof-check.ts docs/codex-stage1/evidence.json` exit 0。

## Acceptance Criteria

- [ ] 证据含 fresh Codex 会话引用 + 真实 task 编辑/创建 id（非 probe/fixture）。
- [ ] CAS 拒绝记录存在（stale expectedStatus 被拒）。
- [ ] `node plugin/scripts/codex-stage1-live-proof-check.ts docs/codex-stage1/evidence.json` exit 0。
- [ ] 提交只含证据文件（scoped，不碰无关路径）。

## Definition of Done

真实 Codex 会话的 durable 证据已提交进 `docs/codex-stage1/evidence.json`，live-proof-check exit 0，AC-929 由 not-evaluated 变为可评估。状态 needs-human，等人开真实 Codex 会话。

## Touches

- tasks/gap-codex-stage1-real-session-evidence.md
- docs/codex-stage1/evidence.json (new)
