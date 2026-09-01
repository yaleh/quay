---
id: gap-worker-driver-resident-loop-intermittent-hang
title: worker-driver 驻留环间歇挂起——liveness 后停在派发环前，round/outcome
  不写（worker-driver-fan-in 测试 flaky 根因）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`worker-driver-fan-in.test.mjs` 的「dep done ⇒ dispatched」/「orphan worktree ⇒ re-dispatched」两条对照间歇失败。归因（实测复现，同一 args 两次跑结果分叉）：

- **一次正常**：`worker-spawned` → `worker-done`（final_state completed）→ round 记录全写。
- **一次挂起**：`.quay/` 目录**只有 `worker-driver-liveness.log`**，无 `worker-round.jsonl`、无 `worker-outcome.jsonl`。

即：`runResidentLoop` 的 liveness 检查（`worker-driver.ts:2826`）写了 liveness log，但循环**停在派发环（`:2846-2887`）之前/之内**，`writeRound`（`:2891`）从未执行 ⇒ 不派发（spawned.length=0）、不写 outcome。**非派发逻辑回归**（派发逻辑手动跑正常、worker-spawned/worker-done 都发），**也非「读生产 pool」**（测试用 temp root + `--ready-pool-cmd` counter 隔离）——是**驻留环的间歇挂起**。

**候选挂点（待 worker 定位，按可能性排序）**：
1. `runLivenessCheckAsync`（`:2826`，gap-resident-driver-stable-carrier-liveness，较新）——spawn liveness 子进程后写 log 但不返回（子进程不退出 / await 无上限）。
2. `stopCondition → resourceGateCheck`（`:2847`）。
3. `readyPoolCheck`（`:2853`，counter 子进程）。
4. `runSelectorWorker`（`:2880`）。

## Plan

1. **定位挂点**：复现挂起时 dump 驻留环当前 await 点（给循环加每步 trace，或挂起时读子进程栈）。
2. **修挂点**：子进程超时上限 / 管道排水 / await 死锁解。
3. **验证**：worker-driver-fan-in 连跑全绿；生产 round 记录无停写窗口。

## Acceptance Criteria

- [ ] AC1（能取假，定位）：复现挂起时定位到具体 await/子进程（step-trace 或栈 dump 指到一行，⛔ 只报「挂起」不指位置 ⇒ 假）。
- [ ] AC2（能取假，修复）：修复后 `worker-driver-fan-in.test.mjs` 20 连跑全绿（无间歇挂起）；（⛔ 仍偶发挂 ⇒ 假）。
- [ ] AC3（能取假，生产载体，硬规则 4 推论三）：落地后生产 `worker-round.jsonl` 连续轮无超长 gap（无「liveness 写了但 round 停写」的窗口，N 只计落地后）；（⛔ 仍停写 ⇒ 假）。

## Definition of Done

挂点定位 + 修复；AC1-3 勾；worker-driver-fan-in 20 连跑绿；生产 round 无停写窗口。

## Touches

- plugin/scripts/worker-driver.ts（驻留环挂点修复）
- plugin/test/worker-driver-fan-in.test.mjs（如测试侧需加固时序）
- tasks/gap-worker-driver-resident-loop-intermittent-hang.md（自身）

## Needs-Human

**执行 2026-09-01T06:40:36.123Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red

## 补充处置（人裁定 2026-09-01）

三次「suite red」逐一核实（三个 worker session transcript + worktree 内保留的原始 suite log 交叉核对）：

1. **尝试 1**：原始 log 被同 `.quay/` 路径下尝试 2 覆盖，未能复原具体失败点。
2. **尝试 2**：仅 1 个失败，`writestate-atomicity-split.test.mjs:111` 负控制断言——已知的、load-sensitive 负控制 flake，是另一条已 done 姊妹任务（`gap-writestate-atomicity-liveness-assertion-flaky`）的同类问题，完全在本任务 `## Touches` 之外。
3. **尝试 3**：11 个互不相关的失败（`.quay` mtime race——另一条 `needs-human` 任务 `gap-suite-help-contract-mtime-race` 的已知问题、多处 "inner claude child must be alive"、`spawnSync ETIMEDOUT`、又一次 torn-write 负控制），全是典型的 CPU 耗尽下进程活性/时序断言崩坏。

三次负载采样：loadavg 均值 18–24（16 核机），PSI `cpu_stall` 均值 35–44%、峰值 64–73%；尝试 3 期间另有 `gap-scoped-gate-lpt-order` 同时在跑同样的全量 16-lane suite，两个全量 suite 抢同一台机的 CPU。

**本任务自身改动从未红过**：三次 worker 各自把 `## Touches` 内文件在隔离环境跑绿（尝试 1：49/49 + 之前 flaky 那对连跑 20 次 0 失败；尝试 2：49/34/46 全绿 + flaky 测试单独隔离跑 5/5）；`worker-driver-fan-in.test.mjs`（本任务要修的目标）三次「suite red」判词里一次都没出现。

**结论**：三次 needs-human 翻转是重试上限误伤——机制正确执行（连续 3 次不合格触发），但三次不合格的成因是宿主资源争用下的既有 flaky 点，与本任务改动无关、代码层面已正确落地。**needs-human → ready 重派**，非代码缺陷、无需人工改代码介入。worktree（`c94693487`，已含 AC2/AC3 时序加固提交）保留复用。

若要根治，「同时段多任务并发跑全量 suite 互相拖累」是一个值得单独立案的资源争用问题（未在本任务范围内处理）。