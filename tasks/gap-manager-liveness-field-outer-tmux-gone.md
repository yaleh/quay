---
id: gap-manager-liveness-field-outer-tmux-gone
title: 重新评估 manager-tick-readings.ts 的 outer.liveness 字段——outer 独立 tmux 会话已删除，该字段现无法观测
status: ready
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

## AC

- [ ] 方案决策已确定并记录在 Proposal 中（A/B/C 三选一）
- [ ] 若选 A（删除）：`grep -rn "outerReadings\|outer.liveness" plugin/scripts/ plugin/test/` 对已删除的函数/字段无新的真实调用命中（注释中的历史记录不算）
- [ ] 若选 B（替换）：新的观测量读数实现完成，manager tick 输出行示例 update 在 Proposal/Finding 中（含示例 pane_pid/代理数/其他新字段），下游判据若依赖旧字段格式已同步更新
- [ ] 若选 C（保留过时）：`outer.liveness` 输出行的注释/文档已明确标记为"已过时，恒 window-missing，见 gap-manager-liveness-field-outer-tmux-gone"
- [ ] `node scripts/test.sh` 对本任务涉及的范围全绿（manager 相关测试、manager-tick-readings 单元测试）

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