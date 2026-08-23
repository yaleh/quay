---
id: gap-ac138-worker-driver-production-enablement
title: AC138 worker-driver 生产启用 + 自主处理真实任务
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac139-unified-driver-subcommand
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC138`，提交 `edc6a319`，⛔ 不在此复制，读那一段）。

**缺口（实测，非推断）**：AC129 只证明 worker-driver **具备**常驻/自主选任务/判停能力（单测覆盖），**从未在生产中启动过一次**——`pgrep worker-driver` 零命中、无 launch/supervisor 包装脚本（`ls plugin/scripts/*worker-driver*` 只有 `.ts` 自身）。与 promotion-driver 当天同坑：能力已实现、测试已绿、生产没跑过（硬规则 4 推论三）。

**吸取教训**：复用 `gap-resident-driver-stable-carrier-liveness` 的稳定承载/死亡告警/kill 测试三条判据（⛔ 不重犯 supervisor 挂 worktree 的事故）。

## Plan

1. **生产启用**：经 `quay driver start --kind worker` 从主检出稳定路径启动 worker-driver 为常驻进程（⛔ 非 worktree；统一入口 + 稳定承载 + 死亡告警由 AC139 提供）。
2. **自主处理**：驱动自主选任务（不传 `--task`），跑完真实任务（有 diff/commit，`selector_reason` 非占位值）。
3. **观测面修正**（manager 发现，⛔ 同 AC137-2 教训）：`status` 的 `carrier_records`/`last_record_ts` 只读 `KIND_CARRIERS[kind]` **首个**（outcome.jsonl=事件条件载体），round.jsonl（无条件每轮写）列第二位却未用 ⇒ 改成对**全部**文件取 mtime/末条时刻 **max**；worker 侧加 round 等价物（无条件心跳，⛔ worker-outcome 只在任务真完成时写、池空时心跳陈旧会被误读为「死亡」）。

## Acceptance Criteria

- [ ] AC1（稳定承载）：worker-driver 从主检出稳定路径启动为常驻进程（`ps` 可见，supervisor cmdline ⛔ 非 `quay-worktrees/`）；取假：`ps` 零命中或 supervisor 从 worktree 路径启动 ⇒ 假。
- [ ] AC2（死亡告警）：worker-driver/supervisor 死时有机件检测并报告（⛔ pid 文件在、进程已死 与「在跑」同形 ⇒ 假）。
- [ ] AC3（自主处理，能取假）：驱动自主选任务（不传 `--task`）跑完真实任务——产出可核（有 diff/commit），`selector_reason` 非占位值，且 spawn 出的 worker 进程 env 有 `ANTHROPIC_BASE_URL`（走 wrapper，⛔ 裸 claude）；取假：窗口内一次都没自主跑完任务、或全为 `--task` 显式指定、或 worker env 无 `ANTHROPIC_BASE_URL` ⇒ 假。

## Definition of Done

- [ ] worker-driver 生产启用 + 稳定承载 + 死亡告警 + 自主处理实证；AC1-3 全勾；land 到 develop。

## Retires

- 无（生产启用，新增 launch/supervisor 承载面）

## Touches

- packages/quay/src/cli/driver.ts（worker-kind 启用面：`quay driver start --kind worker`）
- plugin/scripts/promotion-driver-launch.sh（status 取 KIND_CARRIERS 全部文件 max）
- plugin/scripts/worker-driver.ts（worker round 等价物：无条件心跳）
- plugin/test/worker-driver.test.mjs（worker round 等价物 AC138-3 测试）
- plugin/test/promotion-driver-launch.test.mjs（status 全载体 max AC138-3 测试）
- .gitignore（worker-driver 运行时 state 模式：worker-driver.pid / .log / worker-control.json 等，⛔ 同 AC137 鸡生蛋——不列会重演脏树挡 ff）
- tasks/gap-ac138-worker-driver-production-enablement.md（自身）

> **注意**：AC3「自主处理 ≥N 任务」N 不在此拍板（硬规则 4：先无阈值跑生产分布再定）；若 AC3 在 fan-in 时刻结构上不可满足（需生产时间窗），按 AC137 先例标「（待外部）」。
