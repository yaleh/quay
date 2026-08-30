---
id: gap-live-fan-in-execution-phase-two-axis
title: live 页在飞任务「执行阶段」两轴分离 + fan-in 阶段建模（人 2026-08-30 裁定 Option A）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

live 页（/live 与 dashboard liveCard）在飞任务把「生命周期状态」与「执行阶段」塞进一个标签（serve-live.ts:68 `implCompletedAtMs==null ? "实现中" : "已完工待落地"`），且机械 fan-in 阶段完全无建模——worker 已退出、driver 在跑 suite 的窗口（实测 12-20 分钟）显示「实现中」，与真正在实现的 worker 不可区分。

**根因（已验证到行号）**：
- G1 轴混淆：状态列用执行阶段信号（implCompletedAtMs）但标签像生命周期词。
- G2 死代码半段：driver 路径三个来源全硬编码 `implCompletedAtMs: null`——observation.ts:733（outcome 载体）/ :1204（round 载体）/ :1232（/proc）→「已完工待落地」对 driver 执行的任务永不出现。
- G3 fan-in 无建模：fan-in 期间唯一命名任务载体是 worker-round（~5min）；worker-outcome 只在 finish()（fan-in 之后）写；fan-in-lock-events.jsonl 的 acquire-无-release 是直接量但 readLive 不读；full-suite-state.json 显示层不读。
- G5 载体迟滞：round ~5min 写一次 → fan-in 开始/结束各有 ≤5min 展示迟滞。

## Plan

**Option A（人 2026-08-30 裁定，两轴分离）**：
1. `InFlightTask` 加显式 `phase` 枚举：`implementing | fan-in | awaiting-land（兼容 workflow-events）| landed`。
2. 阶段推导优先级（直接量优先）：a. develop status=done → landed/移除；b. fan-in-lock-events.jsonl acquire 无 release → fan-in；c. /proc worker 进程在 → implementing；d. round 兜底。
3. 展示：**状态列=生命周期**（todo/ready/done/needs-human）；**新增「阶段」列**=枚举；fan-in 可带套件状态（full-suite-state.json）。awaitingLandMs 只在 awaiting-land 显示。
4. G5 round 迟滞用锁事件做事件级阶段判定。
5. 一并解 G1/G2/G3/G4；不重复 board 的 task-status-drift-check landing 旗。

## Acceptance Criteria

- [x] AC1（能取假，fan-in 阶段）：fan-in 锁 acquire 无 release 期间，`readLive().inFlight` 对该 task 返回 `phase=fan-in`（非 implementing）；（⛔ fixture-only / 仍 implementing ⇒ 假）。—— 单测 `serve.test.mjs` AC1：production 形状 fan-in-lock-events.jsonl（acquire 无 release）+ worker-round in_flight_tasks + full-suite-state.json 三载体，`readLive` 返回 `phase=fan-in` 且 `suite.state=running`。
- [x] AC2（能取假，implementing）：/proc worker 进程在且无锁 → `phase=implementing`。—— 单测 `serve.test.mjs` AC2：`liveWorkers:[{taskId,pid}]` 无锁 → `phase=implementing`，且 `status=ready` 从 task store 读出（轴 1 就位）。
- [x] AC3（能取假，landed 移除）：develop status=done → 从 inFlight 移除（或 phase=landed）。—— 单测 `serve.test.mjs` AC3：status=done 的 task 从 `readLive().inFlight` 移除，status=ready 的负控制仍在。
- [x] AC4（能取假，轴分离）：状态列显示生命周期（todo/ready/done），阶段列显示 phase 枚举——两轴不再塞同一标签。—— 单测 `serve.test.mjs` AC4 + `serve-live-implcomplete.test.mjs` AC1：`<th>状态</th>`（生命周期 ready）与 `<th>阶段</th>`（实现中/fan-in/待落地）两列分离，旧「已完工待落地」标签不再出现。

## Definition of Done

InFlightTask 加 phase 枚举 + 推导 + 渲染两轴；AC1-AC4 全勾；全量 suite 绿；live 页 fan-in 窗口不再误显「实现中」。

## Touches

- packages/quay/src/observation.ts（InFlightTask 加 phase + status/suite + 推导 + 读 fan-in-lock-events/full-suite-state）
- packages/quay/src/serve-live.ts（阶段列渲染，状态列改读生命周期，phaseLabel/suiteSuffix）
- packages/quay/src/serve-dashboard.ts（liveCard 同步 phase，fan-in 显式建模）
- packages/quay/test/serve.test.mjs（AC1-AC4 单测，含生产载体 fan-in 锁）
- packages/quay/test/serve-live-implcomplete.test.mjs（旧「已完工待落地」渲染断言迁移为两轴）
- tasks/gap-live-fan-in-execution-phase-two-axis.md（自身）
