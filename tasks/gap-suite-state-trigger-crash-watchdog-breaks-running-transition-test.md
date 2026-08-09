---
id: gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test
title: suite-state-trigger 的 AC6 crash-watchdog（7d0311cf）把无 pid 的 running
  fixture 判成 crashed——red-window-shared-gate.test.mjs AC3 期望 running→red 转变触发
  SUITE-RED，但首读 running 就发 SUITE-RED（watchdog 把 60min 前的 startedAt 无 pid 当死），第二轮
  red 无事件 ⇒ AC3 红，全量套件轮换红
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`suite-state-trigger.ts` 的 AC6 crash-watchdog（7d0311cf，gap-full-suite-state-red-no-failure-detail-static-check-invisible）把无 `pid` 的 `running` fixture 判成 crashed——`red-window-shared-gate.test.mjs` AC3 期望 running→red 转变才触发 SUITE-RED，但首读 running 就发 SUITE-RED，第二轮 red 无事件 ⇒ AC3 断言失败，round-192 全量套件 early-red。**

### 实证（outer 2026-08-09 18:49 红窗分诊）

- round-192 early-red，唯一失败 = `red-window-shared-gate.test.mjs` AC3（651ms）。
- solo 复现：13/14 pass，AC3 fail —— `AssertionError: SUITE-RED emitted on the red flip`，`actual: undefined`。
- **最小复现（直接调 runOnce）**：
  ```
  write running fixture（startedAt='2026-08-05T06:00:00.000Z'，无 pid）→ runOnce
    ⇒ events=["SUITE-RED"]     ← 应该 SUITE-RUNNING！
  write red fixture → runOnce
    ⇒ events=[]                ← 应该 SUITE-RED！
  ```
- **根因**：`detectCrashedRunner`（line 392-408）——`state.state === "running"` 且无 `pid` 时，检查 `now - startedAt < RUNNING_STALE_MS (60min)`；测试 fixture 的 `startedAt` 是 2026-08-05（4 天前）⇒ 超过 60min ⇒ 判 crashed ⇒ 把 `running` 改写成 `red reason=crashed` ⇒ 首读发 SUITE-RED。
- **真实套件不受影响**：runner 现在写 `pid`（7d0311cf 加），watchdog 用 `isProcessAlive(pid)` 判活。但 **无 pid 的 running state（测试 fixture、legacy state、手工写入）** 会被误判。
- 测试 fixture 的 `startedAt` 是固定过去日期（state() helper 默认 `2026-08-05T06:00:00.000Z`），恰好触发 stale-crashed 分支。

**为什么重要**：AC6 watchdog 引入了「无 pid + 老 startedAt 的 running state ⇒ crashed」的新语义，与既有 AC3 测试（running→red 转变）冲突。全量套件每轮有概率红在 red-window-shared-gate，红窗分诊成本重复。这是 7d0311cf 的回归——AC6 该 task 的 scoped 门只跑了它自己的测试，没跑 red-window-shared-gate（cross-cut 盲区，同族）。

### 候选修法（实现归内层，接法留执行时）

1. **watchdog 放宽**：无 `pid` 的 running state 不判 crashed（保守——AC6 注释已写「legacy running state no pid too fresh to call dead」；但 `startedAt` 老的也应保守，因为无法确知 pid）。真实崩溃靠 pid-liveness 或 watchdog 的 generation 机制。
2. **测试 fixture 更新**：state() helper 的 `startedAt` 改为 `new Date().toISOString()`（fresh），避免误触 stale 分支——但这掩盖了「无 pid 老 startedAt 被判 crashed」的语义问题。
3. **watchdog 判据**：无 pid 时用「startedAt 距今 < 60min 才敢判 dead」的 fail-open 语义（与注释一致），但老 startedAt 且无 pid 时**不判 dead**（无法确知）——即只有「有 pid 且进程死」才判 crashed。

**验证锚**：修后 (a) red-window-shared-gate AC3 绿（running→red 转变触发 SUITE-RED）；(b) 真实 crashed（pid 进程死）仍被 watchdog 检出；(c) 无 pid 老 startedAt 的 running 不误判。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-192 实证 + 最小复现（首读 running 发 SUITE-RED）+ 根因（detectCrashedRunner 无 pid 老 startedAt 判 dead）（本任务 Proposal 已含）
- [ ] AC2: **watchdog 修正**——无 pid 的 running state 不误判 crashed（保守 fail-open），真实 crashed（pid 死）仍检出
- [ ] AC3: **AC3 测试绿**——red-window-shared-gate.test.mjs AC3 running→red 转变触发 SUITE-RED
- [ ] AC4: **真实崩溃仍检出**——构造 pid 死 ⇒ watchdog 写 crashed（负控制保留 AC6 能力）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿（suite-state-trigger + red-window-shared-gate 测试）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：red-window-shared-gate AC3 绿（贴任务体）；pid 死崩溃仍检出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/suite-state-trigger.ts（detectCrashedRunner：无 pid 老 startedAt 不判 dead；pid 死仍检出）
- plugin/test/red-window-shared-gate.test.mjs（AC3 回归验证）
- plugin/test/suite-state-trigger.test.mjs（AC6 watchdog 测试——crashed 检出保留）
- tasks/gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test.md（自身：勾 AC + 贴证据）

## Contract

measure   rwsg_ac3_red_after_fix = `node --no-warnings --experimental-strip-types --test plugin/test/red-window-shared-gate.test.mjs 2>&1 | grep -c '✖ AC3'` 的 stdout 数字
band      rwsg_ac3_red_after_fix = 0（AC3 绿）
invariant crashed_still_detected = 1（pid 死 ⇒ watchdog 写 crashed）
invariant nopid_running_not_crashed = 1（无 pid 老 startedAt 的 running 不误判 dead）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/red-window-shared-gate.test.mjs plugin/test/suite-state-trigger.test.mjs`
control   AC3 绿；pid 死崩溃检出；无 pid running 不误判
resume    watchdog 判据 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-192 red-window-shared-gate AC3 唯一失败）——最小复现定位 detectCrashedRunner 把无 pid 老 startedAt 的 running fixture 判 crashed ⇒ 首读发 SUITE-RED 而非 SUITE-RUNNING，第二轮 red 无事件。真实套件有 pid 不受影响；测试 fixture 无 pid 误触。7d0311cf 回归。实现归内层
