---
id: gap-fan-in-mech-workflow-handoff-double-spawn-suite
title: 机械→workflow 兜底交接非互斥——同任务双 spawn suite（争单飞槽饿死后继）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  defer: post-mechanical-first-green
---
**type:** execution

## Proposal

`gap-verification-round-static-fail-no-record` 同时出现两个 `test.sh --buckets gap-verification-round` 进程（已取证 23:04）：
- ① `2446544→2446548` 带 suite-load-sampler 包装（机械 fan-in `spawnSuiteAndWait` 形态）；
- ② `2451913` 裸 test.sh（workflow 子代理 Bash 形态）。

两者争抢单飞槽（一个持有一个排队），饿死 L1 token-gate 的 suite（等槽 15min）与 force-color（排队 85min）。

**结构根因**（verification-round 的 worker 在 driver 日志 `:12913` 已诊断）：fan-in suite 步**两条路径都直接跑 `bash scripts/test.sh --buckets <task>`**（机械 `runMechanicalFanIn` 与 workflow `fan-in-execute.js` 都 bypass `full-suite-runner.ts`）——无「一个任务只跑一个 suite」的统一协调点；单飞槽只串行化执行、不阻止多 suite 进程被 spawn。

**近因**：同任务两条路径同时激活——worker 实现完退出（`:12931`「worker-driver will take over for the mechanical fan-in」）→ 机械 fan-in 接管 spawn 2446548；同时 `:13454`「re-dispatch fan-in-execute workflow 计划」→ workflow 路径 spawn 2451913。**机械→workflow 交接不互斥：前一个 suite 进程没被 reap，后一个就开跑。**

**⛔ 非关键路径**：无 `delivery-critical`，`extra.defer` 标「机械首绿后落地」，不与 force-color/watchdog/token-gate 争派发。

## Plan

机制级修法（⛔ 非补丁，二选一或结合）：

1. **交接互斥**：机械 fan-in red → workflow 兜底启动前，先 reap 机械的 suite 进程（killTree），再让 workflow 起 suite——任意时刻一个任务只有一个 suite 进程。
2. **统一路由**：suite 步改回经 `full-suite-runner.ts`（消除两条路径各 spawn 的旁路），单飞槽 + 统一协调。

## Acceptance Criteria

- [ ] AC1（能取假，交接互斥）：机械 red → workflow 兜底前，前 suite 进程已被 reap（killTree），任意时刻一任务仅一个 suite 进程（⛔ 双 spawn ⇒ 假）。
- [ ] AC2（不误伤）：机械 green 单跑 / workflow 单跑正常，单 suite 不受影响。
- [ ] AC3（负控制）：构造机械 red + workflow 兜底并发，验证不双 spawn。

## Definition of Done

机械→workflow 交接互斥（或统一路由）落地；AC1-AC3 全勾；任意时刻一任务仅一个 suite 进程。

## Touches

- plugin/scripts/worker-driver.ts（red→workflow 交接前 killTree reap 机械 suite）
- plugin/workflows/fan-in-execute.js（双副本之一，改后与 .claude 副本字节一致）
- .claude/workflows/fan-in-execute.js（双副本之二）
- plugin/scripts/full-suite-runner.ts（若走统一路由方向）
- plugin/test/worker-driver.test.mjs（交接互斥测试）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（交接互斥 + 双 spawn 负控制）
- tasks/gap-fan-in-mech-workflow-handoff-double-spawn-suite.md（自身）
