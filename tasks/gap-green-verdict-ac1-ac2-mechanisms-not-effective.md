---
id: gap-green-verdict-ac1-ac2-mechanisms-not-effective
title: green-verdict (done) AC1/AC2 mechanisms not effective — verdict records
  no covered commit/tree (AC1), Contract invoke never returns without --once
  (AC2), --once --json is not JSON; same family as ac8
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

`gap-green-verdict-never-expires-411-minutes-and-187-commits-later-still-green`（status done，AC1-6 全勾）的 **AC1/AC2 机制经实测不生效**。三条可复算（管理者 2026-08-06 19:5x 实测 + 外层复核）。

## 实测

### 发现一（AC1 未生效）
AC1 要求「verdict 记录它所覆盖的 commit/tree」。`.quay/full-suite-state.json` 在两次不同的状态写入里**都没有该字段**：
- 18:47:46 red 版：`state/reason/runner/startedAt/laneCount/finishedAt/durationMs/failures`（8 键）
- 19:48:03 running 版：`state/runner/startedAt/laneCount/finishedAt/durationMs`（6 键）
两次都无 `commit` 或 `tree`。外层复核：`keys: [durationMs, finishedAt, laneCount, runner, startedAt, state]`，无覆盖字段。

### 发现二（Contract 的 invoke 跑不了）
Contract 写 `invoke node --experimental-strip-types plugin/scripts/suite-state-trigger.ts --json`。**这条永不返回**——`suite-state-trigger.ts:403`：
```ts
if (argv.includes("--monitor") || !argv.includes("--once")) { return runMonitor(root, intervalMs); }
```
缺 `--once` 就进常驻监测分支。实测：不带 `--once` 跑满 120 秒零输出（已 kill）；带 `--once` 秒回退出 0。⇒ Contract invoke 缺 `--once`，不能充当机械检查。

### 发现三（--json 不产出 JSON）
`--once --json` 实际输出是两行纯文本：
```
SUITE-STATUS running
stopSignal=false
```
不是 JSON。而 Contract 的 measure 写「--json 输出的 finishedAt 距今分钟数字段」——该字段无从取得。

## 性质

与 `gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect` **同族**：AC 勾选与机制生效不是一回事。按那条任务 AC6 纪律——**不得把整条任务说成假的**：本任务的 AC4「不加硬闸」等决策记录仍然有效，问题在 **AC1/AC2 这两条的机制层**。

**另一层（外层收尾纪律）**：本任务是我 2026-08-06 17:0x 收尾翻 done 的——当时信了 inner fan-in 的「AC1-6 checked, 72/72 green」checkbox，**没有独立验证机制**。这正是 `gap-ac8` 任务要建的「防复发机械检查」（AC 证据自承未生效/勾选与机制不符应可检出）的真实实例，也是 `gap-suite-red-verdict-carries-empty-failures-payload` 的姊妹面（verdict 连自己覆盖什么都没记）。

## 修复方向（接法留执行时）

1. **AC1**：`full-suite-runner.ts` 写 `state.failures` 的同时把 verdict 覆盖的 commit/tree 写进 `full-suite-state.json`（新增字段，如 `verdictCommit`）。
2. **AC2/Contract**：`suite-state-trigger.ts` 的 invoke 补 `--once`（或 Contract 改为 `--once --json`）；`--once --json` 应产出真 JSON（当前是两行纯文本），使 measure 的 `finishedAt` 距今分钟数可机械读取。

## AC（draft）

- [x] 一次状态写入后 `full-suite-state.json` 含 verdict 覆盖的 commit/tree 字段（full-suite-runner.ts 已写 `verifiedCommit`；suite-state-trigger 读取并把它表面化为 verdict 记录 —— `--once --json` 的 `coveredCommit`/`coveredTree` + 事件 state 快照）
- [x] `suite-state-trigger.ts --once --json` 返回真 JSON（含 finishedAt/state/stopSignal 字段，另加 finishedAtIso/ageMinutes/coveredCommit/coveredTree/events）
- [x] Contract invoke（带 --once）可作机械检查（`--once` / `--once --json` / 裸 `--json` 均秒回、退出 0、可解析；`--json` 蕴含一轮 `--once`，不再进常驻监测）
- [x] 与 ac8 任务交叉标注（本任务 `## 性质` 已标注 `gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect` —— AC 勾选 ≠ 机制生效的又一实例）

## DoD（draft）

- [ ] `gap-green-verdict` 的 AC1/AC2 机制真实生效（verdict 记录覆盖 + age/delta 可机械读出）
- [ ] 完整套件绿

## Evidence

- `.quay/full-suite-state.json` 两次写入均无 commit/tree 键
- `suite-state-trigger.ts:403`：`!argv.includes("--once")` → runMonitor 常驻
- `timeout 15 node ... suite-state-trigger.ts --once --json` 输出 `SUITE-STATUS running` / `stopSignal=false`（非 JSON）

## Invoke（inner 2026-08-11 实测）

机制修复 + 自审计（worktree `gap-green-verdict-ac1-ac2-mechanisms-not-effective`，scoped run 绿）。

- **Scoped test**：`bash scripts/test.sh --for-task gap-green-verdict-ac1-ac2-mechanisms-not-effective --allow-thin` →
  **28 pass / 0 fail / 0 cancelled，EXIT 0**（`suite-state-trigger.test.mjs` 全绿；含新增 5 条 AC1/AC2/AC3 测试）。
  `task-contract-check`（scoped 静态层）：no violations。相邻 `full-suite-runner.test.mjs` 77/77 绿（runOnce 返回类型仅扩展字段，无回归）。
- **AC2 —— `--once --json` 现在输出真 JSON**（此前是两行纯文本 `SUITE-STATUS running` / `stopSignal=false`）：
  ```json
  {"state":"red","finishedAt":1786233900,"finishedAtIso":"2026-08-09T00:05:00.000Z","ageMinutes":3772.06,"stopSignal":true,"retrigger":true,"retriggerIdleMs":226323677,"coveredCommit":"214a29c1e5f0b3d4a6c8e9f0a1b2c3d4e5f6a7b8","coveredTree":null,"events":[{"event":"SUITE-RED","at":"...","early":false,"stopSignal":true,"state":{...verifiedCommit...},"failureLocation":[...]}]}
  ```
  含 `finishedAt` / `state` / `stopSignal`，另加 `finishedAtIso` / `ageMinutes`（measure `verdict_age_min` 的输入）/ `coveredCommit` / `coveredTree` / `events`。EXIT 0。
- **AC1 —— verdict 记录覆盖 commit/tree**：`full-suite-runner.ts` 每个状态写入都携带 `verifiedCommit`（git rev-parse HEAD 于 run 开始，gap-merge-green-snapshot-verified-commit-livelock）；`suite-state-trigger.ts` 的 `SuiteState` 类型现声明 `verifiedCommit`/`commit`/`tree`，`runOnce` 把 `state.verifiedCommit ?? state.commit` 表面化为 `coveredCommit`（`state.tree` → `coveredTree`），并随 `--once --json` 输出 + SUITE-RED 事件 state 快照落进 verdict 记录 ⇒ Contract measure `verdict_commit_delta = git rev-list --count <verdict-commit>..HEAD` 有机械的 `<verdict-commit>` 可读。
- **AC3 —— Contract invoke（带 `--once`）可作机械检查**：`--once` / `--once --json` 秒回、退出 0、可解析；裸 `--json`（原 Contract invoke 形式）也**不再永不返回**——`--json` 蕴含一轮 `--once`（进不了常驻监测分支）。上表第二个 fixture 跑裸 `--json` EXIT 0。
- 说明：runOnce 的 `retrigger` 只是**纯决策**（runOnce 从不 spawn；实际起跑只在 runMonitor），`--once --json` 里 `retrigger:true` 是「终态已闲置超阈值」的如实报告，非副作用。

## Touches

- plugin/scripts/suite-state-trigger.ts（verdict 记录 covered commit/tree；--once/--json 修正）
- plugin/test/suite-state-trigger.test.mjs（AC1/AC2 机制测试）
- tasks/gap-green-verdict-ac1-ac2-mechanisms-not-effective.md（自身：勾 AC + 贴证据）
