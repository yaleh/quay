---
id: gap-goal-target-health-vs-dir131-boundary
title: 「被驱动系统健康」读数与 DIR-131 边界冲突 —— fan-in 失败维度无处安放（需人三选一）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**冲突（2026-09-12 实测）**：`gap-goal-driver-blind-to-driven-system-health` 立案要求 goal-driver 每轮报出**被驱动系统**（GOAL-016 靶子项目 = ad-arm1 的 archguard）的健康读数，其中一条是「最近 N 轮 fan-in 的成败比与失败步骤分布（`fan-in-step-trace` 的 `ok:false`）」。按该任务实现后，本仓 scoped 门实测 **RED**：

```
goal-driver-task-boundary-check: RED (4 violation(s))
  - [fanin-read] fan-in @ line 1826: ...
  - [fanin-read] fan-in @ line 1885: ...
  - [fanin-read] fan-in @ line 2272: ...
  - [fanin-read] fan-in @ line 2369: ...
```

该检查是**人 2026-09-07 DIR-131 裁定的机械化产物**，其 AC6 原文：「断言 `goal-driver.ts` 非注释位置不引用 fan-in / full-suite-state / 落地率（goal 侧不以 task 落地指标为输入）」；DIR-131 的 `## Resolution` 里 **AC6 的负控制正是拿 `const c = ".quay/fan-in-step-trace.jsonl";` 当红样例**（实测输出 `[fanin-read] fan-in @ line 862`、exit 1）。

⇒ **任务体的 Plan/AC1 点名要读的载体，正是那条人裁禁止 goal 侧读的载体。** 这是实质冲突，不是形式冲突。

**为什么不能换载体绕过**：换一个语义相同的载体（`worker-outcome.jsonl` 等）同样能数出「落地失败」，但那会让检查绿而被禁行为照旧 —— 正是硬规则 3b/4 描述的「结构上不可能报红的检查」的反面形态（检查绿、行为违规）。也**不**把守卫本身放宽/豁免（那是替人改裁定）。

**已做的处理（不越权、不静默）**：把 fact 收窄到**被驱动系统自身**的结构量（⛔ 无任何 task 落地指标）⇒ 边界检查绿、两个 shrink-only 棘轮均未放宽；被阻塞任务的 **AC1 如实留未勾**（没被满足就不勾），并置 `needs-human`，worktree + 三条提交保留。

**收窄后的生产读数**（证明缺口只在「落地失败分布」这一维，其余两条可操作信号都在）：

```
ad-arm1:/home/yale/work/archguard: unhealthy [plugin-version-mismatch] — liveness=driving(4),
roundRecords=3(newest .quay/promotion-round.jsonl 13s) pluginVersion MISMATCH 0.4.0≠0.6.1(陈旧度 2761660s)
```

## Plan

1. **人三选一**：
   - ① **改 DIR-131 AC6 的口径**：把「关于**外部被驱动系统**的读数」与「关于**本仓自身落地率**的读数」分开 —— 前者不是 DIR-131 的反例形态（该裁定的反例是「拿本仓落地速率归因 goal 机制」）。
   - ② **把这条观察挪到非 goal 组件**：例如 quality 例程型 kind 的一条 routine，或一个独立观测面；`goal-driver.ts` 不碰。
   - ③ **放弃该维度**（只保留收窄后的两条信号：`not-driving` / `plugin-version-mismatch`）。
2. 按裁定落地：改 DIR-131 口径 / 新建组件 / 关闭该维度，并**同步判据与其负控制**（`goal-driver-task-boundary-check.ts` + 其单测；⛔ 不放宽任何 shrink-only 棘轮、不加静默豁免；若选 ①，检查需能区分两类读数且双向负控制都跑过）。
3. 被阻塞任务的 AC1 按裁定改写后重评估（它现为 `needs-human`，worktree 与提交保留在 `/home/yale/work/quay-worktrees/gap-goal-driver-blind-to-driven-system-health`，分支 `task/gap-goal-driver-blind-to-driven-system-health`）。

## Acceptance Criteria

- [x] AC1 裁定落地：①②③ 之一被执行，且在 DIR-131（或新组件）里有**可核的落点**（文件 + 行/节）
      **证据**：人 2026-09-12 裁定选项 **①**——改 DIR-131 AC6 口径，区分「本仓自身落地率」与
      「外部被驱动目标项目自身状态」。落点：`tasks/DIR-131.md` `## Resolution` 节新增小节
      「### 2026-09-12 补充裁定（AC6 口径澄清）」，逐字记录裁定与机械落点。
- [x] AC2 判据同步：`goal-driver-task-boundary-check.ts` 的判据与负控制与裁定一致 —— 选 ②/③ ⇒ 该检查不变且 `goal-driver.ts` 保持绿；选 ① ⇒ 检查能区分两类读数，且「外部目标读数 ⇒ 绿」「本仓落地率读数 ⇒ 红」双向负控制实测过（贴实际输出）
      **证据**：`goal-driver-task-boundary-check.ts` Detector 3 新增结构化、fail-closed 的
      `exemptSpans` 豁免——由 `goal-driver.ts` 内成对行内标记 `DIR-131-TARGET-PROBE-BEGIN` /
      `DIR-131-TARGET-PROBE-END` 界定，且仅豁免标记跨度内的字符串字面量成员；标记不成对时不豁免。
      实测双向负控制：
      ```
      本仓自身裸字面量、置于标记跨度外 ⇒ 仍报 RED（未获豁免）
      同一字面量、挪进 DIR-131-TARGET-PROBE-BEGIN/-END 标记内 ⇒ PASS
      标记残缺/不成对（如只有 BEGIN 无 END）⇒ 仍报 RED，fail-closed
      goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites
        (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads
        outside the target-probe exempt span
      ```
      单测：`goal-driver-task-boundary-check.test.mjs` 19/19 绿（含新增双向负控制用例）；
      `goal-driver.test.mjs` 60/60 绿（含两条以真实两态输出断言的新测试）。项目 scoped 门：
      `goal-driver-task-boundary-check: PASS`。
- [x] AC3 被阻塞任务重新可判：`gap-goal-driver-blind-to-driven-system-health` 的 AC1 被改写为与裁定一致的判据，且该任务重新进入 `ready`（或按 ③ 明确关闭该维度并从 AC 中移除）
      **证据**：`gap-goal-driver-blind-to-driven-system-health` 的 AC1 已改写并勾选（引用本裁定
      与新豁免机制），任务由 `needs-human` 转出（本次操作一并完成，详见该任务体自身记录）。

## Definition of Done

- AC1/AC2/AC3 满足，各附实测输出；
- ⛔ 不放宽任何 shrink-only 棘轮（`instrument-failure-check` 的 FAMILY_BASELINE / boundary check 的判定面）、不加静默豁免；
- 落地后 `bash scripts/test.sh --static-checks` 绿。

## Touches

- tasks/DIR-131.md
- plugin/scripts/goal-driver-task-boundary-check.ts
- plugin/test/goal-driver-task-boundary-check.test.mjs
- tasks/gap-goal-driver-blind-to-driven-system-health.md

## Resolution

**2026-09-12** — 人裁定选项 ①（见 AC1 证据）。机械实现（`exemptSpans` 结构化 fail-closed 豁免）
已在 worktree `/home/yale/work/quay-worktrees/gap-goal-driver-blind-to-driven-system-health`
（分支 `task/gap-goal-driver-blind-to-driven-system-health`）完成并测试通过，由承接会话负责提交。
本升级任务在裁定落地（三条 task 记录同步）后收尾为 `done`。
