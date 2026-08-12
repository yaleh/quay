---
id: gap-suite-state-trigger-retriggers-while-runner-alive
title: suite-state-trigger 在 runner 仍活时重触发 ⇒ 双套件事故（state=red ≠ 轮次已终）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（outer 2026-08-12，同根因两次，双套件事故）**：

| # | 触发 merge | 后果 |
|---|---|---|
| 1 | outer 收尾 commit `0ccd3235`（09:14） | 旧 runner（09:06 起，未截断收集，state 早红）仍活 ⇒ 触发第二个 8-lane 套件（2688249）。2×8 竞争 + 新 runner 截断共享 `full-suite.log`（85B，旧 runner 的 fd 在截断点后，PERFILE 丢失）+ 新 runner 的 terminal write（runId 更新）使旧 runner 的 guarded state write 被 generation guard 全部丢弃（`writeStateGuarded` 只在 writer 仍是当前 runId 时落盘）。 |
| 2 | inner `b14849f1`（09:19） | 同一模式再次触发第三个套件（2762923），同后果。 |

**根因**：`suite-state-trigger.ts` 的重触发条件 `state != running` 判定「不在跑」即重触发，**不校验 `state.pid` 指向的进程是否存活**。`state=red` 不代表「轮次已终」——runner 在首个失败即标红（AC2 early-RED）但**继续收集完整失败集**（KILL_ON_RED=off 后尤其如此）。任何 merge 落在 `state=red` 且 runner 仍活的窗口 ⇒ 双套件。

**选定机制**：`suite-state-trigger.ts` 的 SUITE-MERGE-PENDING → RETRIGGER 路径在**发射 RETRIGGER 前**校验 `state.pid` 进程存活（`/proc/<pid>` 存在且 cmdline 含 `full-suite-runner`；或等价判据 `finishedAt != null`）。存活 ⇒ 发 SUITE-MERGE-PENDING（记账）但不 launch，标 `wait-runner`；已终（pid 不存在 / finishedAt 非空）⇒ 照常 RETRIGGER。

**验证锚**：(a) runner 活 + state=red + merge ⇒ 不重触发；(b) runner 死 + state=red + merge ⇒ 照常重触发；(c) runner 活 + state=running + merge ⇒ 不重触发（既有行为，负控制）；(d) `--for-task` scoped 门绿 + 既有 suite-state-trigger 链测试绿。

## Plan

1. 读 `plugin/scripts/suite-state-trigger.ts` 的 retrigger 分支（SUITE-MERGE-PENDING → launch runner 的路径），定位 `state != running` 判定点。
2. 在发射 RETRIGGER 前加 pid 存活校验：读 `state.pid` → `/proc/<pid>/cmdline` 含 `full-suite-runner` ⇒ 存活 ⇒ 不 launch（发 PENDING + `wait-runner` 标记）；否则照常。
3. 测试：三态（a）runner 活 + red ⇒ 不 launch；（b）runner 死 + red ⇒ launch；（c）runner 活 + running ⇒ 不 launch。用 mock state + 假 pid 构造。
4. 回归：`suite-state-trigger` 既有测试 + `--fail-fast-check`（构造失败 suite ⇒ SUITE-RED 链完好）+ `checker-mutation`。
5. 全量套件确认轮（修后——否则双套件事故会让任何红窗 merge 触发第二套件）。

## AC

- [x] AC1: 重触发前校验 `state.pid` 进程存活；存活 ⇒ 不发 RETRIGGER（发 SUITE-MERGE-PENDING + `wait-runner`）
- [x] AC2: runner 已死（pid 不存在或 `finishedAt != null`）时行为不变——照常 RETRIGGER
- [x] AC3: 负控制——state=running（runner 活）时任何 merge 不重触发（既有行为不回归）
- [x] AC4: 新测试覆盖 (a)(b)(c) 三态；`--for-task` scoped 门绿
- [x] AC5: 既有 suite-state-trigger 链测试绿（`--fail-fast-check` 退出 0 = 链完好）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 runner 活 + state=red + merge ⇒ 无第二个 runner（证据贴出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/suite-state-trigger.ts（RETRIGGER 前校验 state.pid 进程存活）
- plugin/test/suite-state-trigger.test.mjs（三态用例）
- tasks/gap-suite-state-trigger-retriggers-while-runner-alive.md（自身：勾 AC + 贴证据）

## Invoke Evidence（inner 2026-08-12，SCOPED ONLY）

**机制落地**（`plugin/scripts/suite-state-trigger.ts`）：
- 新增纯判据 `isRunnerInFlight(state)`：`finishedAt == null` 且 `pid` 进程存活（`isProcessAlive`，与既有 crash-watchdog 同一判据）⇒ 仍算在跑；`finishedAt != null`（终态）或 pid 缺/死 ⇒ 已终。
- `runOnce` 的 SUITE-MERGE-PENDING 分支：merge 落地仍照常发事件（记账），但 `waitRunner = mergePending && isRunnerInFlight(cur)`，事件与 `RunOnceResult` 均携带 `waitRunner` 标记。
- `spawnRetriggerRun`（发射 RETRIGGER 的唯一点）：读 state 后、spawn 前再校验 `isRunnerInFlight` —— 存活 ⇒ 打 `SUITE-RETRIGGER-WAIT-RUNNER` 且不 launch（TOCTOU 安全：runOnce 与 spawn 之间 runner 若已终，则照常 launch）。`--json`/`--once` 输出新增 `waitRunner`。

**scoped 门**：`bash scripts/test.sh --for-task gap-suite-state-trigger-retriggers-while-runner-alive`
```
ℹ tests 36  ℹ pass 36  ℹ fail 0  ℹ cancelled 0
```
含 `--fail-fast-check`（AC5，退出 0，链完好）；scoped 静态检查全部 PASS（test-framework-policy / test-isolation / task-contract-check / superseded-capability / tick-core-static-check / delivery-inventory-drift-gate）。

**新增四用例（覆盖 (a)(b)(c) 三态）**：
1. `isRunnerInFlight` 纯判据：活 runner + red ⇒ in-flight；死 pid + red ⇒ 不在跑；`finishedAt` 非空（活 pid 亦然）⇒ 不在跑；running + 活 pid ⇒ 在跑；无 pid/pid=0/green/absent ⇒ 不在跑。
2. AC1 集成：merge 落地 + 早红 + **活** runner ⇒ `SUITE-MERGE-PENDING` 带 `waitRunner:true`（不重触发）。
3. AC2 集成：merge 落地 + 早红 + **死** runner ⇒ `SUITE-MERGE-PENDING` 不带 waitRunner（照常 RETRIGGER）。
4. AC1 actor：`spawnRetriggerRun` 在早红 + 活 runner 下打 `SUITE-RETRIGGER-WAIT-RUNNER`、无 `SUITE-RETRIGGER`、无 `full-suite-retrigger.log`（runner 未被 spawn）、state 未动。

**兄弟回归**：`red-window-shared-gate.test.mjs` + `slot-free-trigger.test.mjs` 29 全绿；`full-suite-runner.test.mjs` 80 绿 / 1 环境性失败（`AC1 — … systemd-run cgroup scope (real systemd)` poll 超时——stash 后基线同样失败，与本次改动无关）。

**DoD「修后实跑」**：见上面用例 4 —— 以测试进程自身的活 pid 构造「runner 活 + state=red + merge 触发路径」⇒ `spawnRetriggerRun` 拒绝起第二个 runner（机械证据：WAIT-RUNNER 信号 + 无 spawn + 无 log + state 未动）。全量套件绿由外层 verification-round 验证。
