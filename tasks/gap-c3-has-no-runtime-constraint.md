---
id: gap-c3-has-no-runtime-constraint
title: C3（outer NEVER creates/drives/checks manager）只有文档层机械检查（AC4： grep 断言 tick
  文档与 plugin/loop 模板无创建/驱动/检查 manager 步骤，no-manager-tick-doc-check.ts） ——但文档里没写
  ≠ 运行时没做；运行时实际去 capture-pane/读 transcript/查 manager 记录不被任何判据覆盖； 08-07 09:03 外层
  task_write 分析 manager 行为立案属 C3 越界（已成立），暴露文档层 AC 管不住运行时行为； 同族：声明在（AC
  勾了）、保证没了（实际行为不受约束）——本仓反复出现的形状
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

**C3（outer NEVER creates/drives/checks manager）只有文档层机械检查，没有运行时约束。**

### 现状

`tasks/gap-manager-productization-five-constraints` AC4（已勾 [x]）的机械检查 =
`no-manager-tick-doc-check.ts`：grep 断言 `orchestrator-loop-tick.md` 与 `plugin/loop/` 模板
**无**创建/驱动/检查 manager 的步骤。

**但文档里没写 ≠ 运行时没做。** 这个检查只覆盖"tick 文档里有没有写这种步骤"，
覆盖不到"运行时实际去查了 manager"。

### 已发生实例（2026-08-08，管理者查证后部分成立）

管理者 06:2x 一度指控外层"观察/检查 manager"（依据一条转述 + `.quay/last-pane.txt` 文件存在），
随后用 meta-cc 查证撤回该指控（外层 05:00 后 12 条 capture-pane 调用零条指向 manager 窗口）。
**但其中一条确实越界**：08-07 09:03:38 外层 `task_write` 立了一条「分析 manager 周期性 tick-log 追加
行为」的任务——分析 manager 行为并立案，属 C3 的 "checks manager"。**这条成立。**

### 缺口形状

这正是本仓反复出现的形状：**声明在（AC 勾了）、保证没了（实际行为不受约束）**。
AC4 的机械检查只拦"文档写了越界步骤"，不拦"运行时真做了越界动作"。两者不是一回事。

### 范围

归属外层+内层机制设计。方向（设计决定，不预设）：
- 运行时约束怎么做（meta-cc 定时扫外层会话的 capture-pane/transcript 目标？git 审计 task_write 目标？
  还是日志留痕比对？）；
- 判据怎么定（什么算"checks manager"：读 manager 窗口 pane / 读 manager transcript / 读 manager
  tick-log / task_write 分析 manager 行为——逐类标注，避免再被"转述当证据"误伤）；
- 注意区分：C3 约束的是 outer→manager 方向；manager→outer 的发布与 single-flight 交付不属于此列。

## Contract

```
measure c3_runtime_violations = `grep -cE "capture-pane.*(manager|0:0)|quay-0:0\.0|b8dc91a6" <外层会话扫描>` stdout 数字段
band c3_runtime_violations = 0（运行时无指向 manager 的观测/检查动作；设计后定具体判据）
invoke `meta-cc 查外层会话 capture-pane/transcript 调用目标`
control 负控制：指向 inner 的 capture-pane 不计数；manager→outer 的发布不计数
resume 若中断，先跑 measure 确认当前运行时越界动作数，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **运行时判据定义**——什么算"checks manager"（读 pane / 读 transcript / 读 tick-log /
      task_write 分析行为）逐类标注，写成设计说明贴任务体
- [ ] AC2: **运行时约束落地**——外层运行时对 manager 的观测/检查动作被机械检测（如定时 meta-cc
      扫描或日志留痕比对），违规报出
- [ ] AC3: **负控制**——指向 inner 的观测、manager→outer 的正常发布不误报；基于转述的指控
      （如今天这次）不被当作证据
- [ ] AC4: 与 gap-manager-productization-five-constraints（C3 的 AC4 文档层检查）交叉标注——
      运行时约束是它的补充，不是替换

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（判据定义 + 检测样例 + 负控制）

## Touches
- tasks/gap-c3-has-no-runtime-constraint.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/no-manager-tick-doc-check.ts（或新增运行时检查器）
- plugin/loop/orchestrator-loop-tick.md（运行时约束的触发/报出路径）
- tasks/gap-manager-productization-five-constraints.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T06:3xZ
changed: 管理者 2026-08-08 报告缺口（AC4 只覆盖文档层，覆盖不到运行时），并指出 08-07 09:03
  外层 task_write 分析 manager 行为立案属 C3 越界（成立）。外层判断：值得立案——"文档没写≠
  运行时没做"是本仓反复出现的形状（声明在/保证没了），且刚因缺运行时约束引发了一次误指控。
