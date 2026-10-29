---
id: gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale
title: GOAL-912 merge suite 双红：.gitignore blanket 回归 + l1-delivery 测试检查旧文件位置
status: ready
labels:
  - gap
  - suite
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-930
---
## Finding

GOAL-912 goal→develop merge 的全量 suite 两个红，都不是 goal 的 codex 代码造成：

1. **loop-driver-check AC2「registry is gitignored, same shape as gate-events.jsonl」**：`.gitignore` 里 2026-10-29 的 blanket `**/.quay/*` 吞掉了 per-file 专属条目，`git check-ignore -v .quay/loop-driver.jsonl` 返回 `**/.quay/*` 而非测试要求的专属 `**/.quay/loop-driver.jsonl`。已有一份修复在 author（commit 966435e36），本任务把同一修复落到 goal 分支。

2. **l1-delivery-surface-check AC5「quay-init wiring」**：测试 `plugin/test/l1-delivery-surface-check.test.mjs` 第 176/185 行读 `packages/quay/src/init.ts`（顶层），断言其含 `"l1-delivery-surface-check.ts"` 与 `l1Script = path.join(pluginRoot, "scripts", "l1-delivery-surface-check.ts")`。但 god-module 拆分后，l1 wiring 已迁到 `packages/quay/src/init/delivery-surface.ts`（:63 `l1Script = path.join(...)`、:76 调用），顶层 init.ts 已不含该字符串（`git show develop:packages/quay/src/init.ts | grep -c l1-delivery-surface-check` = 0）。测试检查了旧位置。

## Requested action

1. **.gitignore**：撤掉 blanket `**/.quay/*`（第 687 行附近），改为逐条声明 churning 运行时载体（与 author 966435e36 相同）：`**/.quay/loop-driver.jsonl`、`goal-round.jsonl`、`worker-round.jsonl`、`worker-outcome.jsonl`、`promotion-round.jsonl`、`promotion-outcome.jsonl`、`task-status-events.jsonl`、`task-status-events-state.json`、`store-commit-propagation.jsonl`、`worker-dispatch.json`、`scoped-gate-cache.json`、`doc-check-cache.json`、`baseline-red-rounds.jsonl`、`server.lock`、`server.json`、`server-services.json`、`serve.pid`、`worker-control.json`、`promotion-control.json`、`anchor.json`、`anchor.pid`、`anchor-takeover.json`、`anchor-desired.json`、`anchor-kind-stops.json`（都带 `**/.quay/` 前缀）。

2. **l1-delivery-surface-check.test.mjs**：把 AC5 测试里读顶层 `init.ts` 的两处（第 176 行 `initTs` 和第 185 行 `engine`）改为读 `packages/quay/src/init/delivery-surface.ts`（l1 wiring 的新家），断言内容不变。其余断言（cli/init.ts 的 `deliverySurfaceL1Report`）保持不动。

## Acceptance Criteria

- [x] `.gitignore` 无 blanket `**/.quay/*`，含专属 `**/.quay/loop-driver.jsonl`；`git check-ignore -v .quay/loop-driver.jsonl` 返回专属条目。
- [x] `node --test plugin/test/loop-driver-check.test.mjs` 绿。
- [x] `node --test plugin/test/l1-delivery-surface-check.test.mjs` 绿。

## Definition of Done

两个修复落 goal 分支（goal_ac=AC-930 路由）；两条测试在 worktree 里绿。

该轴仍暗,理由:测试/配置回归修复，无组件代码改动（只改 .gitignore 与测试断言），未跑 archguard/码文档比测量

## Touches

- `tasks/gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale.md`
- `.gitignore`
- `plugin/test/l1-delivery-surface-check.test.mjs`