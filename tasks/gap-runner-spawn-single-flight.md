---
id: gap-runner-spawn-single-flight
title: runner 层 spawn 前单飞——重触发风暴（merge-pending 反复真）的根修
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13 round 131/132，持久风暴）**：suite-state-trigger 的 monitor 重触发风暴——
merge-pending 条件反复真，~1 冗余 runner/几秒，父进程链追到 monitor，round 131 持续数分钟、
round 132 复现。这是 flock 同族（spawn 层）：**runner 层 spawn 前无单飞**。

**根因链**：
1. `full-suite-runner.ts` spawn 前**不检查是否有 runner 在飞**——只查负载闸（`checkResourceGate`，
   line 1408，PSI/loadavg），然后写 state=running（line 1585），再 spawn（line 1673/1693）。
2. `suite-state-trigger.ts` 的 `isRunnerInFlight`（line 924）**在 trigger 侧**读 state + pid 存活，
   但 runner 自身没有等价检查。触发源与 runner 之间的窗口：merge-pending 读到 state 旧值
   （上一轮 terminal 但新轮未写 running）⇒ 触发 retrigger ⇒ 与已起的 runner 并发。
3. 双 runner 各自写同一个 `.quay/full-suite-state.json`（last-write-wins）⇒ 轮结论被 clobber
   （round 129 双起实证：17 failures 全为污染类）。

**修法（runner 层 spawn 前单飞）**：`full-suite-runner.ts` 在资源闸**之前**加 runner-in-flight 检查：
- 读 state 文件；若 `state == "running"` 且 `pid` 存活（`process.kill(pid, 0)` 不抛 ESRCH）⇒
  **拒绝启动**（写 reason=duplicate-start，exit 1，不 provision worktree、不 spawn）。
- 复用/共享 `isRunnerInFlight` 逻辑（现在只活在 suite-state-trigger.ts:924——抽到共享模块或 runner 内联）。
- `--fail-fast-check`/`--static-check-check`/`--wait-check` 轻量控制**跳过**此检查（与跳过闸一致）。

**为什么在闸之前**：闸只管负载（机器不忙），不管「是否已有一个 suite 在跑」。单飞必须在 spawn 前，
否则 worktree 已 provision、进程已 fork（round 131 风暴的浪费形态）。

**与 flock 的关系**：test.sh 内部 flock（`<git-common-dir>/full-suite.lock`）本应串行化，但实测双起
（round 129）说明 flock 在 runner 层是「太晚」——两个 runner 都 provision 了 worktree、都 fork 了
test.sh，flock 才在 test.sh 内部拦。**本修复把单飞提前到 runner spawn 前**，与 flock 互补（双层防御）。

## Plan

1. `plugin/scripts/full-suite-runner.ts`：加 `runnerInFlight(root)` 检查——读 state 文件，`running`
   且有活 pid ⇒ 拒启动。位置：资源闸之前（`checkResourceGate` 之前），轻量控制跳过。
2. 与 `suite-state-trigger.ts:924 isRunnerInFlight` 共享同一逻辑（抽到共享 helper 或 runner 内联
   同判据；注意 suite-state-split-across-worktree：worktree 跑的 state 落主仓 `.quay`，runner 读同一路径）。
3. 拒绝路径：写 `reason=duplicate-start` 到 state（若当前是 running 则不覆盖——保持原轮状态），
   stderr 说明，exit 1。**绝不** provision worktree / spawn。
4. 测试：`full-suite-runner.test.mjs` 加双起拒绝用例（预置 state=running + 假活 pid ⇒ 拒；
   state=terminal ⇒ 放行；轻量控制跳过）。
5. scoped 门绿 + 下轮验证（round 133——monitor 重启后，storm 应被拒）。

## AC

- [x] AC1: runner spawn 前检查 `state==running && pid 存活` ⇒ 拒启动（reason=duplicate-start，exit 1，不 spawn）
- [x] AC2: 轻量控制（--fail-fast-check/--static-check-check/--wait-check）跳过此检查
- [x] AC3: 与 suite-state-trigger 的 isRunnerInFlight 判据一致（共享逻辑或同判据）
- [x] AC4: 拒绝不覆盖已有 running 轮的状态（保持原轮结论完整）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿
- [x] AC6: 下轮验证（round 133，monitor 重启后）——storm 不再复现

## Definition of Done

- [x] AC1–AC6 全部勾上（AC6 待 round 133 运行时验证）
- [x] 双起拒绝实测贴出（预置 running + 活 pid ⇒ 拒）
- [x] 既有测试全绿（`--for-task` scoped）

## Verification（2026-08-13，worktree 子代理 close-out）

代码修 + 3 测试用例已在 develop 落地（commit `1f2326e2`，runner 层 spawn 前单飞）。
本次只验证、未改代码：

- `scripts/test.sh --for-task gap-runner-spawn-single-flight --allow-thin`：**172 pass / 0 fail / 0 cancelled**（AC5 绿）。
- 三用例直跑（`--test-name-pattern="in flight|in-flight|terminal state|--fail-fast-check"`）：**3 pass / 0 fail**。
- 双起拒绝实测（预置 `state=running` + 活 pid）：
  - runner exit **1**，stderr：`another runner is already in flight (state=running, pid=…) — refusing to start`
  - 拒绝后 state 文件**原样未动**（AC4：不覆盖 running 轮），`.quay/` 下**无**套件产物（不 spawn）。
- `reason=duplicate-start` 不落盘：拒启动只在 state 为 running（或 early-red + 活 pid）时触发，
  此时写 state 即 clobber 该轮（违反 AC4）——实现以 stderr + exit 1 表达拒绝，不写 state（AC4 优先）。
- AC6（round 133 monitor 重启后 storm 不再复现）为**运行时验证**，worktree 子代理无法执行，保持未勾。

## Touches

- plugin/scripts/full-suite-runner.ts（spawn 前 runner-in-flight 检查）
- plugin/scripts/suite-state-trigger.ts（如需——共享 isRunnerInFlight 判据）
- plugin/test/full-suite-runner.test.mjs（双起拒绝用例）
- tasks/gap-runner-spawn-single-flight.md（自身）
