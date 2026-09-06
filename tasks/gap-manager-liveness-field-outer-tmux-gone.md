---
id: gap-manager-liveness-field-outer-tmux-gone
title: 重新评估 manager-tick-readings.ts 的 outer.liveness 字段——outer 独立 tmux 会话已删除，该字段现无法观测
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-outer-tmux-window-logic
---
## Proposal

**outer 独立 tmux 会话已删除（gap-retire-outer-tmux-window-logic 完成），`outer.liveness` 字段现无法取得有效观测数据。**

`manager-tick-readings.ts` 的 `outer.liveness` 字段原设计用来监控 outer 会话的存活状态，通过查询 tmux pane 列表寻找 `window === "outer"` 的窗口（`:449-476` 行）。既然 Task 1 已经删除了 outer tmux 窗口的建立逻辑，这个查询会恒返回空数组，导致字段恒输出 `window-missing`。

**三个可行方案**（SPEC §7 Task 4 设计）：

1. **方案 A：直接删除字段** — 既然 outer 作为独立会话已消失，该观测量无存在意义。删除 `outerReadings()` 函数、字段输出行、相关测试。manager tick 输出格式变化，下游判据需跟新。

2. **方案 B：替换为新观测量** — 用"存在通过 subagent 派发的在飞代理数"替代（该量已存在，manager 有能力读 dispatch-record.jsonl）。保留输出字段名 `outer.liveness`，改为新数据源。

3. **方案 C：保留为过时断言** — 标记字段为已过时、恒返回 `window-missing`，便于转移期理解。最终仍需选择方案 A 或 B 来收尾。

**决策（2026-09-06）：方案 A——直接删除。**

选定方案 A：删除 `outer.liveness` 字段、`outerReadings()` 函数，以及仅服务于该字段的 tmux 读管线
（`tmuxListPanes`/`remoteTmuxListPanes`/`parsePanes`/`defaultTmuxSocket`/`resolvePanes` 及相关 seam）
与 `Project.session/host` 字段（仅 `outer.liveness` 消费）。理由：

1. **观察对象已消失**：outer 独立 tmux 会话/窗口已由 gap-retire-outer-tmux-window-logic 删除，该字段
   结构上恒返回 `window-missing`——正是本任务 DoD 明令禁止的「恒返回固定值」伪观测。
2. **方案 B 不成立**：`outer.liveness` 语义是「会话存活」，与「在飞代理数」（派发量）是不同观测量；
   后者已由 slot-refill / dispatch-record 独立承载，改名为 `outer.liveness` 会语义误导。manager 判层
   活性的正本已是直接量（git log 提交时刻 / worktree 活进程）。
3. **方案 C 与本任务 DoD 直接冲突**：保留恒 `window-missing` 的过时断言即「恒返回固定值」的伪观测。

删除范围：`outerReadings()`、`OuterReading` 接口、`render()`/`renderSelected()`/`main()` 里的
`outer.liveness` 输出分支与子命令，以及仅服务于它的 tmux 读管线 + `Project.session/host`。
`outer.ticklog`（读文件，非 tmux）保留。下游无任何机械 checker 解析 `outer.liveness` 输出
（grep 全仓核实），删除不产生断链。

## AC

- [x] 方案决策已确定并记录在 Proposal 中（A/B/C 三选一）
- [x] 若选 A（删除）：`grep -rn "outerReadings\|outer.liveness" plugin/scripts/ plugin/test/` 对已删除的函数/字段无新的真实调用命中（注释中的历史记录不算）
- [x] 若选 B（替换）：新的观测量读数实现完成，manager tick 输出行示例 update 在 Proposal/Finding 中（含示例 pane_pid/代理数/其他新字段），下游判据若依赖旧字段格式已同步更新（N/A：已选 A）
- [x] 若选 C（保留过时）：`outer.liveness` 输出行的注释/文档已明确标记为"已过时，恒 window-missing，见 gap-manager-liveness-field-outer-tmux-gone"（N/A：已选 A）
- [x] `node scripts/test.sh` 对本任务涉及的范围全绿（manager 相关测试、manager-tick-readings 单元测试）

## DoD

执行后，manager tick 的 `outer.liveness` 字段行为语义清晰一致：
- 若删除：该行不再出现在输出中，下游依赖处理缺失字段的代码正常工作，无静默失败
- 若替换：字段输出新观测量，数值真实有效（非恒常数），下游判据使用新值
- 若过时标记：字段仍输出但明确文档化为过时，防止误读

任何情况下，都不应留下"恒返回固定值"的伪观测——既无法反映系统状态，也无法向读者清晰传达为何值为常数的原因。

## Touches

- plugin/scripts/manager-tick-readings.ts
- plugin/test/manager-tick-readings.test.mjs
- orchestration/manager-tick-readings.md（若存在，更新 outer.liveness 相关说明）
- docs/analysis/test-file-baseline.txt（AC1 基线更新，如测试覆盖改变）
- tasks/gap-manager-liveness-field-outer-tmux-gone.md