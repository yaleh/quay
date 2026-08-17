---
id: gap-webui-dashboard-manager-slow-parallelize
title: WebUI dashboard/manager 页 13-14s——readSystem/readManager 串行跑机件脚本，ready-pool-check 单项 9.10s
status: ready
labels:
  - gap
  - webui
  - performance
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**人类指出（2026-08-17，manager 已用真实 HTTP 实测核实）**：dashboard 和 manager 两页打开慢，13-14 秒。

**实测（活服务器 100.78.206.100:4173）**：`/dashboard` 13.13s、`/manager` 13.97s、对照组 `/` 0.26s。

**根因（manager 逐项计时）**：
- `handleDashboard`（serve-handlers.ts:2318-2350）顺序 `await readSystem()` 再 `await readManager()`（未 `Promise.all`）。
- `readSystem`（observation.ts:823-841）顺序跑 `resource-gate.sh`(1.65s)→`process-budget.sh`(0.35s)。
- `readManager`（observation.ts:927-1015）顺序跑 `loop-driver-check.sh`(1.26s)→`session-liveness.sh --once`(2.31s)→observer-registry 同步读→`ready-pool-check.ts --json`(**9.10s，单项最大**，`node --experimental-strip-types` 每次现编译无缓存)→`git rev-list`(0.01s)。串行相加 ≈14.7s 与实测吻合。`/manager` 同样调 `readManager`，同一根因。

**方向（manager 供参考，非裁定）**：两处 `Promise.all` 并行；`ready-pool-check.ts` 9s 是否可短 TTL 缓存或跨路由共享一次结果，单独评估。

**能取假（⊢ 对照）**：修复后活服务器 `/dashboard` / `/manager` 墙钟显著下降（目标：并行化后 ≤5s 量级，ready-pool 若缓存再降）；串行→并行的 `Promise.all` 结构可 diff 见。

## Plan

1. 读 `handleDashboard`（serve-handlers.ts:2318-2350）、`readSystem`/`readManager`（observation.ts:823-1015）。
2. `readSystem` 内部机件脚本（resource-gate/process-budget）改 `Promise.all`；`readManager` 内部机件脚本（loop-driver-check/session-liveness/ready-pool-check/git）改 `Promise.all`。
3. `handleDashboard` 的 readSystem+readManager 改并行（`Promise.all`）。
4. 评估 ready-pool-check 9s：短 TTL 缓存（如 30-60s）或跨路由共享——若做缓存需考虑读新鲜度（ready-pool 是 A22 每 tick 的输入，缓存不得影响 A22 读真值；缓存只服务 WebUI 展示面）。
5. scoped 门 + 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: `readSystem` / `readManager` 内部串行机件脚本改为并行（`Promise.all`），结构 diff 可见。
- [x] AC2: `handleDashboard` 的 readSystem+readManager 并行。
- [x] AC3: 活服务器实测 `/dashboard` / `/manager` 墙钟显著下降（目标 ≤5s；ready-pool-check 若引入缓存须证明不污染 A22 读真值）。〔实现侧已取假：本地 worktree 实测 /manager 6.27s→2.08s、/dashboard 8.23s→2.21s（并行 + slot-refill 30s TTL 缓存）；活服务器最终读数在 fan-in 落地后验证。缓存 A22 不污染由 gap-dashboard-parallelize.test.mjs 两条 AC3 测试证明（子进程独立性 + 模块隔离）。〕
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] dashboard/manager 页并行化落地，实测墙钟下降，ready-pool 缓存（若有）不污染 A22，scoped + 全量绿。

## Touches

- packages/quay/src/serve-handlers.ts（handleDashboard 并行；⚠️ 与 in-flight ac98 共用 serve-handlers.ts）
- packages/quay/src/observation.ts（readSystem/readManager 并行）
- packages/quay/test/（性能/结构测试）
- tasks/gap-webui-dashboard-manager-slow-parallelize.md（自身）

## Test-Files

- packages/quay/test/gap-dashboard-parallelize.test.mjs（新：AC1/AC2 结构 + AC3 缓存行为与 A22 不污染）
- packages/quay/test/serve-ac95-views.test.mjs（readManager/readSystem 既有集成）
- packages/quay/test/serve-handlers.test.mjs（handleDashboard 既有集成）
