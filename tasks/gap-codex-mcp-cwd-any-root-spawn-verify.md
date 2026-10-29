---
id: gap-codex-mcp-cwd-any-root-spawn-verify
title: Codex MCP 在任意工作根下真正可用：config cwd 修复 + spawn 校验
status: ready
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-927
---
## Proposal

实测（SPEC-codex-long-term-support-2026-10-29 §3.2，codex-cli 0.156.1）：Codex 拉起 MCP server 时，server cwd = 会话工作根（非项目根）；`.codex/config.toml` 的 `args = ["packages/quay/bin/quay.ts", "mcp"]` 是相对路径，从子目录（如 `packages/quay/`）启动 ⇒ ENOENT 且 codex 输出零提示。现有 `codex-stage1-selfcheck.sh` 只做 `codex mcp get/list`（读配置、不 spawn），从子目录跑仍 PASS ⇒ 抓不到「enabled 但没起来」。修两类：①给 config 加 `mcp_servers.quay.cwd`（已实测该字段生效）或 args 绝对化，使任意工作根下 server 可 spawn；②新建 spawn 校验，使「起没起来」可测量（硬规则 3b，不静默）。

## Plan

1. 改 `.codex/config.toml`：加 `[mcp_servers.quay] cwd="<repo root>"`（或 args 改绝对路径），使任意工作根下 server 可 spawn。repo root 用已实测生效的字段，不用写死宿主机无关字面量的变通（本机是 `/data/home/yale/work/quay`，但优先 cwd 字段指向 git root 的语义）。
2. 建 `plugin/scripts/codex-stage1-spawn-verify.sh`：从子目录 spawn 配置的 quay MCP server 并完成 initialize 握手，失败 exit 非 0。
3. 把 spawn 校验集成进 `codex-stage1-selfcheck.sh`（使 selfcheck 从子目录跑也会执行 spawn 校验，不再只读配置）。
4. 测试：仓库根 + 子目录均通过；坏 config（cwd 指向不存在路径）时 exit 非 0。

## Acceptance Criteria

- [x] `.codex/config.toml` 含 cwd 字段（或 args 绝对化），`codex mcp get quay` 显示 cwd。
- [x] `plugin/scripts/codex-stage1-spawn-verify.sh` 存在；从 `packages/quay/` 子目录运行 exit 0（server 真 spawn + initialize，非只 spawn 不验）。
- [x] 坏 config（cwd 指向不存在路径）时 spawn-verify exit 非 0。
- [x] `codex-stage1-selfcheck.sh` 从子目录运行会执行 spawn 校验（不再只读配置）。
- [x] `node --experimental-strip-types scripts/agents-claude-drift-check.ts` 仍 exit 0。

## Definition of Done

真实从子目录跑过一次 spawn-verify 并贴 exit 码；坏 config 负控制贴非零 exit 码；selfcheck 从子目录贴真实输出。代码落在 goal/GOAL-912 分支（goal_ac=AC-927 解析）。

## Touches

- tasks/gap-codex-mcp-cwd-any-root-spawn-verify.md
- .codex/config.toml
- plugin/scripts/codex-stage1-spawn-verify.sh (new)
- plugin/scripts/codex-stage1-selfcheck.sh
- plugin/scripts/capability-catalog-declarations.json
- plugin/skills/manager/SKILL.md
- plugin/skills/init/SKILL.md
- plugin/test/*codex-stage1-spawn* (new)

该轴仍暗，理由：本任务仅改 .codex/config.toml、两个 shell 脚本、两个 SPEC 声明点（SKILL.md）与一个测试文件，未触及 packages/* 源码依赖结构，L_D/L_G 无可测增量。

## Blocker

**2026-10-29T09:59:13.372Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (628/628 files) — recovery exhausted at floor concurrency 16 — no declared rung produced a complete verdict (64,48,32,16); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：1e225eb9-6db9-4a04-a89b-ac781cdcae3e

**2026-10-29 — 续做：更正误诊 + 修复**

- 真正根因（更正上文）：suite 红在静态检查 `spec-declaration-point-check exit=1`，非并发/incomplete。原因 = `orchestration/SPEC-codex-long-term-support-2026-10-29.md`（本任务所属 Codex program 的 SPEC）已落 goal/GOAL-912 与 develop，但未在任一声明点（`plugin/skills/manager/SKILL.md`、`plugin/skills/init/SKILL.md`）声明。该静态检查 fail-closed ⇒ suite 在跑任何测试文件前即红（0/628 terminal ⇒ 上层误报 incomplete 并徒劳降并发 64→48→32→16）。
- 修复：在两个声明点补声明该 SPEC；两文件已入 `## Touches`。
- 验证：worktree 内 `spec-declaration-point-check` exit 0（all 49 orchestration/SPEC-*.md declared at each of 2 declaration points）。
