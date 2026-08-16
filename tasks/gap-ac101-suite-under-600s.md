---
id: gap-ac101-suite-under-600s
title: "AC101: suite 在 main 相 lane=8 下总耗时 ≤600s（人设定 600s；先造反事实对照轮再优化）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC101。

**目标值 600s = 人逐字设定（输入，非自推导阈值）**。

**⚠️ 基线已更新（manager 2026-08-16 17:1xZ 独立核实修正，提交 24d6e9aa）**：⛔ 不再引用 round215 的
「需砍 415s」。现基线 = round218（16:51Z，lane=8）：
```
round215  08:14Z  green  1015s  tests=4951  load=6.83   cpu_time=6253s  commit=acdd0517
          static 83 / serial 304 / lowconc 276 / main 349
round218  16:51Z  red     747s  tests=5003  load=12.49  cpu_time=4454s  commit=968cc1a8
          static 44 / serial 232 / lowconc 183 / main 286      ← 四相【全部】下降
两轮之间 develop 落了 120 个提交
```
⇒ **现基线 747s ⇒ 距 600s 目标差 ≈147s（20%）**——难度显著低于立条时估计。
⚠️ **round218 是 `state=red`（fail=1）⇒ 不满足 AC101 判据①的 `state=="green"`，不计入那 3 轮**；
它只是起点读数，⛔ 不得被当成「已接近达成」的证据（747s 好看正因为标清了它不算数）。

**manager 假说已自行降级（据 round215 vs 218 对照）**：round218 宿主负载更高（12.49 vs 6.83）、并发更多
（5 条），耗时却少 268s ⇒ 「并发 scope churn 拖慢 serial/lowconc」被削弱（若成立 round218 该更慢）；
round215 cpu_time 多 1799s 也与「CPU 饥饿拖慢」方向相反。**替代候选并列（⛔ 不选边）**：①两轮间 120 个
提交含真实性能改动；②round215 本身是离群值。

**⇒ 对照轮目标改为**：先在无并发窗口测出一个干净基线（同提交 lane=8 全量），再回头判 120 个提交里
哪些改了耗时。⛔ 不得跳过对照直接按假说优化。

## Acceptance Criteria

- [ ] AC1: `.quay/verification-round.jsonl` 存在 ≥3 轮记录，满足 `laneCount==8` ∧ `state=="green"`
      ∧ `durationMs <= 600000`，且 `startedAt` 晚于立条时刻（2026-08-16T16:2xZ）——读生产载体非 fixture。
- [ ] AC2: 这 3 轮 `tests` 字段不得低于基线 **4951**（禁止砍覆盖换速度；低于基线即不计入且判作弊）。
- [ ] AC3: 优化手段落成代码/配置（可 `git log` 追溯的提交），⛔ 不接受"挑低负载时段跑一轮"充数。

## Definition of Done

- [ ] 3 轮 lane=8 全绿且 ≤600s、tests≥4951、优化可追溯；对照轮已跑并记录 serial/lowconc 翻倍真因。

## 对照轮记录（2026-08-16 17:1xZ）

**第 1 轮（round218，startedAt 16:51:19，lane=8）= 起点基线记录，⛔ 非反事实对照轮**（inner 直接量确认）：
- worktree 分支含 quoted-path（968cc1a8）+ AC99（505dd16d）两个**非本任务**提交（全量静态闸前置并入）
  ⇒ 测的代码 = develop + quoted-path 修复 + AC99 修复，非「同提交干净对照」
- 同时 5 worktree 并发在飞（并发场景，非「无并发 scope churn 窗口」）
- **结果**：state=red / durationMs=747160 / tests=5003 / pass=5002 / fail=1
- **⇒ 对照需重跑**：等其余任务收尾后，在无并发窗口跑一轮同提交 lane=8 全量（目标=测出干净基线，
  再判 120 个提交里哪些改了耗时——manager 17:1xZ 修正后的目标）。
- **任务隔离破坏**：quoted-path + AC99 改动并入 AC101 worktree 是污染源——两修复已在各自任务路径上
  （quoted-path fan-in 在跑、AC99 Touches 已在主检出修），AC101 worktree 内副本冗余且污染对照。

## Touches

**收窄说明（manager 2026-08-16 16:5xZ 裁定）**：⛔ 不使用目录级条目（`plugin/scripts/*` / `packages/quay/src/`）
——目录级是展开+不对称自锁语义，会挡住本阶段所有 UI 任务（serve-handlers 单点 + AC99 的 5 个 plugin 文件），
使「人明令 suite 与 UI 并行」在派发层结构上不可能。**真实改动对象 = 对照测量与优化落点**，对照轮跑完前
「main 相砍时长对象在 packages/quay/src/」是未证实猜测，⛔ 不得用未证实可能性锁住 src 目录。等对照轮真因
确定后，按实际落点补具体文件条目。

- scripts/test.sh（suite 分相结构——static/serial/lowconc/main 的 lane 与时长控制）
- plugin/test/full-suite-runner.test.mjs（资源闸自测 fixture——serial/lowconc 翻倍候选真因，先对照再改）
- plugin/test/trend-check.test.mjs（同上，资源闸自测 fixture）
- plugin/test/checker-cost.test.mjs（同上，资源闸自测 fixture）
- tasks/gap-ac101-suite-under-600s.md（自身）
