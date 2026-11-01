---
id: gap-mcp-blacklist-extend-meta-cc-archguard-plantuml
title: worker 会话 mcpBlacklist 从 chrome-devtools/playwright 扩展到
  meta-cc/archguard/plantuml（shipped profiles.yml 与 dev-tree 保持同构）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

token 全量扫描已确认 task-worker/fix-worker/selector 是 driver 会话里 cache_read 最大的三类（claudecodeui-task-worker 44.2B、quay-task-worker 26.4B、quay-fleet-task-worker 9.1B）。cache_read 与「每轮常驻上下文」线性相关，而 MCP tool schema 就常驻在每轮都重读的缓存前缀里。`gap-worker-mcp-blacklist-strict-config`（done）已经把 chrome-devtools/playwright 从三个纯写代码 role 上摘掉（实测省 ~3.24GB RSS + 两套 schema），但 meta-cc（查会话历史）、archguard（架构分析）、plantuml（画图）对 task-worker/fix-worker/selector 同样无用：这三个 role 只走 quay MCP（task_get/task_write/task_check 是 ABI 强制面）+ Read/Bash/Edit。它们却仍被连接到每个 worker 会话、把 schema 灌进每轮上下文。机制已存在（role 层 `mcpBlacklist` → `driver-runtime.ts:2331 launchArgv` → `mcp-blacklist-resolve.ts` → `--strict-mcp-config --mcp-config <inline json>`），本任务只扩展黑名单取值，不改机制。

## Plan

1. `plugin/.quay/profiles.yml`（shipped fallback carrier）：roles.task-worker/fix-worker/selector 的 `mcpBlacklist` 从 `[chrome-devtools, playwright]` 扩展为 `[chrome-devtools, playwright, meta-cc, archguard, plantuml]`。
2. dev-tree 根 `.quay/profiles.yml` 同步同一条扩展（两份 carrier 同构，`profiles-role-coverage-check.ts` 的既有纪律）。
3. 不改 profile-policy.ts / driver-runtime.ts / mcp-blacklist-resolve.ts 的任何机制代码。

## Acceptance Criteria

- [ ] AC1 `plugin/.quay/profiles.yml` 的 roles.{task-worker,fix-worker,selector}.mcpBlacklist 各恰为 5 项 `[chrome-devtools, playwright, meta-cc, archguard, plantuml]`（grep 逐字核对）。
- [ ] AC2 dev-tree 根 `.quay/profiles.yml` 与 AC1 同构（三 role 的 mcpBlacklist 逐字一致）。
- [ ] AC3 负控制：最近 7 天 worker/fix-worker/selector 会话 transcript 里 `mcp__meta-cc__` / `mcp__plugin_archguard_*` / `mcp__plantuml__` 的 tool_use 命中数为 0（证明这三个 MCP 对这些 role 确实无用）；若有命中，该 role 保留对应 MCP 并从黑名单剔除，不得一刀切。
- [ ] AC4 一条真实 worker spawn 的 argv 含 `--strict-mcp-config` 且黑名单解析结果确实扣掉了这 3 个 server（贴 argv 或 resolve 结果）。
- [ ] AC5 `profiles-role-coverage-check.ts` 全绿（两份 carrier 同步，无漂移）。

## Definition of Done

- AC1–AC5 全部带真实粘贴证据勾选。
- 机制代码零改动；selector/fix-worker/task-worker 之外的角色（outer/manager/pool-judge/meta-driver）argv 与改动前逐字一致（不连坐，AC3 负控制覆盖）。

## Touches
- plugin/.quay/profiles.yml
- .quay/profiles.yml
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-mcp-blacklist-extend-meta-cc-archguard-plantuml.md