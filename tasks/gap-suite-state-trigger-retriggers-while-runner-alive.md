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

- [ ] AC1: 重触发前校验 `state.pid` 进程存活；存活 ⇒ 不发 RETRIGGER（发 SUITE-MERGE-PENDING + `wait-runner`）
- [ ] AC2: runner 已死（pid 不存在或 `finishedAt != null`）时行为不变——照常 RETRIGGER
- [ ] AC3: 负控制——state=running（runner 活）时任何 merge 不重触发（既有行为不回归）
- [ ] AC4: 新测试覆盖 (a)(b)(c) 三态；`--for-task` scoped 门绿
- [ ] AC5: 既有 suite-state-trigger 链测试绿（`--fail-fast-check` 退出 0 = 链完好）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 runner 活 + state=red + merge ⇒ 无第二个 runner（证据贴出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/suite-state-trigger.ts（RETRIGGER 前校验 state.pid 进程存活）
- plugin/test/suite-state-trigger.test.mjs（三态用例）
- tasks/gap-suite-state-trigger-retriggers-while-runner-alive.md（自身：勾 AC + 贴证据）
