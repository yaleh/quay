---
id: gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer
title: "'who-is-waiting' mechanism covers only outer→inner, no observation of
  outer/manager layer being waited on (2 real incidents today fell in blind
  spot; manager shouldn't hand-build); no task points at this gap
  (ruling-required done = built one direction only); fix: reuse
  classifyPaneState + consecutive-sample observer with direction reversed
  (manager watches outer), not new invention"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**「谁在等人」机制只覆盖 outer→inner，缺 outer/manager 层被等待的观测（管理者查实 + 外层核实）**：

**已存在的机制（严谨，已验证）**：inner-blocked-signal.ts 的 screen observer——outer 每 60s 轮询 inner
pane 底部，classifyPaneState 纯 SHAPE 分类（ADR-016，never 整屏哈希），**连续 N 次（默认 3，~3min）
waiting-input/permission-prompt 才判 ruling-required**，写阻塞信号 + 可行动问题 + 底部区域证据。
管理者手工试错摸出的判据（连续多次不 busy）它早就存在且多处理了 permission-prompt。

**但它是单向的**：只有 outer 盯 inner，**没有人盯 outer/manager**。今天两次真实场景都落这盲区：
①outer 等管理者裁定拓扑优先级（靠临时观测发现）；②archguard outer 假阳性（若真的也测不到）。
⇒ **outer/manager 被等待目前无任何机械观测**，只能靠人偶然瞥见或管理者临时搭——而管理者不该临时搭。

**搜索结果**：无任务精确指向缺口。相邻都不是：suite-state-has-no-reason-axis（套件语义）、
red-window-has-no-automatic-executor（红窗执行者）、ruling-required-trigger（已 done，正是建现有机制
的任务，但只做了 outer→inner 一层，无下一层跟进）。

**实现方式（管理者建议 + 外层采纳）**：**复用现有机制同一套判据**（classifyPaneState + 连续 N 次采样 +
底部区域），观测方向反过来——不是新发明，是把已验证机制应用到未覆盖层。观测者：**manager 盯 outer**
（manager 本来就该跨项目做，且已确认是合法职责）；manager 自己被盯大概率是人，可先不机械化。

### 选定机制

1. manager 用同一套判据（classifyPaneState + 连续 N 次 + 底部区域）盯 outer——outer 连续 waiting-input/
   permission-prompt ⇒ 报「outer 在等人」
2. 复用 inner-blocked-signal 的 screen observer 机制（参数化观测方向），不新发明
3. manager 被盯：先不机械化（人盯）
4. 验证：outer 等裁定（如拓扑优先级）⇒ manager 侧观测报出

## Acceptance Criteria

- [ ] AC1: manager 侧观测 outer——outer 连续 waiting-input/permission-prompt ⇒ 报「outer 在等人」（复用 classifyPaneState + 连续采样 + 底部区域）
- [ ] AC2: 复用 inner-blocked-signal screen observer 机制（参数化方向），非新发明（grep 证明同源）
- [ ] AC3: 实测：outer 等裁定场景 ⇒ manager 观测报出（负控制：outer busy 时不报）
- [ ] AC4: 与 ruling-required-trigger + inner-blocked-signal 交叉标注（同一机制的下一层）

## Touches

- plugin/scripts/inner-blocked-signal.ts（参数化观测方向：inner 或 outer）
- plugin/scripts/（manager 侧观测器，复用 classifyPaneState）
- plugin/test/（AC1-AC3 测试）
- tasks/gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick.md（AC4 交叉标注）

## Contract

measure   outer_waiting_detected = `bash <manager-observer> --pane <outer-pane> 2>&1 | grep -c 'ruling-required\|waiting-input'` stdout 数字段
band      outer_waiting_detected >= 1（outer 等人时被观测报出）
invoke    `grep -n 'classifyPaneState\|waiting-input\|permission-prompt' plugin/scripts/inner-blocked-signal.ts`
control   outer 等裁定 ⇒ 报出（AC3）；outer busy ⇒ 不报
resume    参数化方向与 manager 观测器分步提交，任一步完成即写盘