---
id: gap-telemetry-underreport-nontask-subagents-not-counted-in-slots
title: "Telemetry UNDER-report (mirror of the done high-report task):
  investigation subagents don't enter task brackets, so --slots realInFlight
  stays 0 while a 40m/187k-token general-purpose subagent burns the machine
  (verified: slots 0/3 vs 1 actual subagent process) — the inner's state
  self-check ① reads realInFlight ≤ cap and judges 3 free slots, real
  concurrency is 4 not 3, which directly threatens B-class wall-clock stability
  as the suite tightens; mechanism ruling: do NOT put investigation subagents
  into task brackets (wrong semantics), add a 'non-task subagents in-flight'
  count to --slots and have self-check ① use real concurrency (brackets +
  non-task subagents)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**遥测低报：调查型 subagent 不进任务括号，`--slots` 的 realInFlight 恒 0——槽位把真实并发漏算了。**
管理者实测（2026-08-07 16:2x）：同一时刻 inner pane 显示 1 个 general-purpose subagent 在飞
（40m46s / 187.3k tokens，在 "Reproducing driver AC6 flake with session-liveness"——调查型，
非任务执行），而 `fast-mode-telemetry.ts --slots --cap 3 --json` 返回 **realInFlight 0 /
bracketsInFlight 0 / slotsRemaining 3**。外层复验一致（slots 0/3，实际 1 subagent 进程）。

**根因**：遥测只数任务括号（`--task-start` / `--task-end`），而调查型 subagent 不走括号系统（没有
对应任务）。`--slot-status`/`--slots` 的 realInFlight 只扣减「括号存在但执行者消失」，不包含
「无括号但执行者在跑」。

**后果（具体）**：inner 状态自检①读 `realInFlight ≤ effective_cap`——现在读到 0/3 空槽 ⇒ 判定
「可再派 3 个任务」，而实际已有 1 个 40 分钟、187k tokens 的 subagent 在烧机器。**真实并发是 4 不是
3**。当套件往 13 分钟压、serial 段对负载敏感时，多一路不被计入的重负载直接打 B 类挂钟测试的稳定性
——正是该 subagent 自己在复现的那个 flake。

### 与既有任务的关系（同族、反方向）

`gap-telemetry-brackets-vs-subagents-no-slot-visibility`（done）记的是**高报**：红窗遗留未闭合括号
把健康态误判成满负荷（5 括号 vs 1 agent）。本次是**低报**：调查型 subagent 不进括号，槽位显示为空。
该任务判据 `brackets_reflect_subagents` 只覆盖了「括号多、实际少」方向；「实际多、括号零」方向没覆盖。

### 机制裁定（外层：不把调查型 subagent 纳入任务括号，另给"非任务在飞"计数）

1. **不纳入任务括号**——调查型 subagent 不是任务（无 --task-start），硬塞进括号语义错误；
2. **`--slots`/`--slot-status` 增「非任务 subagent 在飞」计数**：从 inner 会话读真实 subagent 进程数
   （pane/进程扫描，如 subagent 进程模式），`realInFlight` = 任务括号真实在飞 + 非任务 subagent；
3. **inner 状态自检①用「真实并发」**（括号 + 非任务 subagent），不再只用括号 realInFlight——真实并发
   > cap 才可判违规，非任务 subagent 也占并发预算。

## Contract

measure slots_report = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap 3 --json` stdout 的 `realInFlight` + `subagentsInFlight`（或等价字段；修复后二者之和 = 真实并发）
measure subagents_in_flight = `pgrep -af "general-purpose|Explore|Plan" | grep -v pgrep | grep -v "bash -c" | wc -l` stdout 数字段（内层实际 subagent 进程数）
band subagents_in_flight = 真实 subagent 进程数（≥1 时 slots 必须报出，不再 0/3）
invoke `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap 3 --json`
control 构造调查型 subagent（无括号）在跑 ⇒ `--slots` 必须报 realInFlight + subagentsInFlight ≥ 1（不再 0/3）；inner 状态自检①据此不空派
resume 若中断，先跑 measure 读 slots 报告 + 实际 subagent 进程数

## Acceptance Criteria

- [x] AC1: **`--slots`/`--slot-status` 增非任务 subagent 计数**——调查型 subagent（无括号）在跑时，
      slots 报告 `realInFlight + subagentsInFlight ≥ 1`（不再 0/3 空槽）
      → `fast-mode-telemetry.ts` 增 `countNonTaskSubagents`（Contract pgrep 模式
      `general-purpose|Explore|Plan`，排除 pgrep / bash -c / telemetry 自身进程）+ `scanNonTaskSubagents`
      （/proc 实扫）+ `readSubagentsInFlight`（`QUAY_TELEMETRY_SUBAGENTS` 测试覆盖）。`--slots` 输出新增
      `subagentsInFlight` / `realConcurrency`（= `realInFlight` + `subagentsInFlight`）；
      `--slot-status` 输出新增 `subagents_in_flight` / `real_concurrency`。scoped 测试
      `SLOT-STATUS — a non-task subagent (no bracket) is counted toward real concurrency` 与
      `SLOT-STATUS CLI — an in-flight non-task subagent reports realInFlight + subagentsInFlight ≥ 1` 全绿。
- [x] AC2: **inner 状态自检①用真实并发**——自检读括号真实在飞 + 非任务 subagent 之和；真实并发 > cap
      可判违规；非任务 subagent 占并发预算（不再空派）
      → `fast-mode-loop-tick.md` 状态自检①判据从「`realInFlight` ≤ cap」改为「`realConcurrency`
      （= `realInFlight` + `subagentsInFlight`）≤ cap」——真实并发 = 括号 + 非任务 subagent；两处重复行、
      「3.5 计量」与「每个 tick 必报」同步更新。
- [x] AC3: **负控制**——真实任务在飞时（有括号）计数不变（不重复计）；无任何在飞时 slots 仍报 0
      → scoped 测试 `SLOT-STATUS — real task in flight + non-task subagent SUM, never double-count` 与
      `SLOT-STATUS — zero in-flight (no brackets, no subagents) still reports 0` 全绿。
- [x] AC4: 与 gap-telemetry-brackets-vs-subagents-no-slot-visibility（done，高报方向）交叉标注——同族
      两面：高报（括号多实际少）已修，低报（实际多括号零）本任务
      → done 任务体已加「交叉标注（低报方向）」段。
- [x] AC5: 与 gap-suite-concurrency-8-green-serial-group（serial 负载敏感）交叉标注——低报在
      并发收紧时直接威胁 B 类挂钟稳定性
      → 该任务体「与既有任务的关系」已加双向交叉标注段。

### 实跑证据（invoke evidence，2026-08-08 内层实跑）

构造调查型 subagent（无括号）在跑的对照——`QUAY_TELEMETRY_SUBAGENTS=2` 注入 2 个非任务 subagent
进程（与 Contract measure `pgrep -af "general-purpose|Explore|Plan"` 同口径）：

```
$ QUAY_TELEMETRY_SUBAGENTS=2 node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --root <ws> --slots --cap 3 --json
{
  "bracketsInFlight": 0,
  "reconcilable": 0,
  "realInFlight": 0,
  "subagentsInFlight": 2,
  "realConcurrency": 2,
  "closedButLive": [],
  "occupiedSlots": 2,
  "slotsTotal": 3,
  "slotsRemaining": 1
}
```

修复前后对照：**修复前**（只读 realInFlight）`0/3` 空槽、`slotsRemaining 3` ⇒ 自检①误判 3 个空槽；
**修复后** `realInFlight 0 + subagentsInFlight 2 = realConcurrency 2`、`slotsRemaining 1` —— 非任务
subagent 被计入并发预算，不再空派。负控制：真实任务在飞（有括号）+ 非任务 subagent 各占一槽、不重复计
（`real_in_flight 1 + subagents_in_flight 1 = real_concurrency 2`，scoped 测试覆盖）；无任何在飞时
slots 仍报 0。

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（含调查型 subagent 在跑时 slots 报告前后对照）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- tasks/gap-telemetry-underreport-nontask-subagents-not-counted-in-slots.md（自身文件：self-touch，2026-08-08 内层补——缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/fast-mode-telemetry.ts（`--slots`/`--slot-status` 增 subagentsInFlight）
- plugin/loop/fast-mode-loop-tick.md（状态自检①改真实并发 = 括号 + 非任务 subagent）
- plugin/test/slot-visibility.test.mjs（runCli 钉 QUAY_TELEMETRY_SUBAGENTS=0 保持确定性）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4 交叉标注，done）
- tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md（AC5 交叉标注）
- tasks/gap-telemetry-underreport-nontask-subagents-not-counted-in-slots.md（自身文件，AC/证据自勾）

## Dispatch review

reviewer: outer
at: 2026-08-07T16:4xZ
changed: 管理者 16:2x 实测（低报方向）：调查型 subagent 不进括号，slots realInFlight 0/3 而实际 1 个
  187k tokens subagent 在跑。后果：inner 自检①误判空槽 3 → 可空派 3 任务，真实并发 4。外层裁定：
  不纳入任务括号（非任务），另给「非任务 subagent 在飞」计数，自检①用真实并发。
