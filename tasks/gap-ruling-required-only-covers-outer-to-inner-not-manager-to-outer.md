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

**「谁在等人」机制只覆盖 outer→inner——通用化为参数化观测原语（管理者两轮更正 + 外层裁定）**：

**已存在的机制（严谨，已验证）**：inner-blocked-signal.ts 的 screen observer——outer 每 60s 轮询
inner pane 底部，classifyPaneState 纯 SHAPE 分类（ADR-016，never 整屏哈希），连续 N 次（默认 3，~3min）
waiting-input/permission-prompt 才判 ruling-required。

**单向 + 硬编码**：只有 outer 盯 inner，没人盯 outer/manager（今天两次真实场景落盲区）。写死的只在
薄壳三处：①输出路径 .quay/inner-blocked.json（BLOCKED_FILE_NAME 硬编码）；②阈值 RULING_REQUIRED_
PANE_SAMPLES=3（observePaneForRuling 已参数化 samples，但调用固定）；③orchestrator-loop-tick 固定指向
inner pane。

**通用化（管理者更正 + 外层裁定）**：不是「反向应用 manager→outer」，是**把工具通用化**——盯谁、盯
什么参数化，允许调用方配置：
1. **目标/路径参数化**：--target <名字>（inner/outer/manager）⇒ 输出 .quay/blocked-signals/<target>.json
   （而非硬编码 inner-blocked.json）
2. **阈值参数化**：--samples <N>（默认 3 保留，可覆盖；复用 session-liveness OVERDUE_MIN 校准值）
3. **动作可扩展**：触发后动作做成插件点/回调（写文件 vs 通知 vs 其它），调用方决定「检测到阻塞后做什么」
4. **不开放状态枚举**：classifyPaneState 的 ENUMERATED_STATES（waiting-input/permission-prompt/busy/
   error-banner/unknown）是 ADR-016 封闭枚举（防游戏化），**不开放**——除非重新评估 ADR-016（那是一个
   更大的决定，不在此次顺带做）

**与「机制做一次、下游配置复用」同原则**：manager 盯 outer、未来任何新方向都是配置一次调用，不新写
代码。

### 选定机制

1. inner-blocked-signal.ts 泛化为参数化观测原语：--target（决定输出路径命名空间）、--samples（可覆盖）、--pane（已有）
2. 动作插件点/回调：检测到阻塞后写文件 / 通知 / 其它（调用方配置）
3. classifyPaneState 保持封闭枚举（不开放）
4. manager 盯 outer：用通用原语配置一次调用

## Acceptance Criteria

- [ ] AC1: --target <名字> 参数化——输出 .quay/blocked-signals/<target>.json（非硬编码 inner-blocked.json），inner/outer/manager 各可观测
- [ ] AC2: --samples <N> 参数化（默认 3 保留可覆盖）
- [ ] AC3: 动作插件点/回调——检测到阻塞后写文件/通知/其它由调用方配置（非只有写信号文件一种反应）
- [ ] AC4: classifyPaneState 封闭枚举不变（ADR-016，ENUMERATED_STATES 不开放——grep 证明）
- [ ] AC5: manager 盯 outer 配置一次调用（实测：outer 等裁定 ⇒ 报出；busy ⇒ 不报）
- [ ] AC6: 与 ruling-required-trigger + ADR-016 + 自适应并发（机制一次下游复用）交叉标注

## Touches

- plugin/scripts/inner-blocked-signal.ts（--target/--samples 参数化 + 动作回调）
- plugin/scripts/pane-state-classify.ts（不动，仅确认封闭枚举）
- plugin/loop/orchestrator-loop-tick.md（调用参数化）
- plugin/test/（AC1-AC5 测试）
- tasks/gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick.md（AC6 交叉标注）
- tasks/gap-adaptive-concurrency-cap-tied-to-resource-gate.md（AC6 交叉标注）

## Contract

measure   observer_targets = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --target outer --pane <f> 2>&1 | grep -c 'blocked-signals/outer'` stdout 数字段
band      observer_targets >= 1（--target 参数化生效，输出按目标命名空间）
invoke    `grep -n 'BLOCKED_FILE_NAME\|RULING_REQUIRED_PANE_SAMPLES\|--target\|--samples' plugin/scripts/inner-blocked-signal.ts`
control   --target inner ⇒ inner-blocked.json；--target outer ⇒ blocked-signals/outer.json（AC1）
resume    参数化与动作回调分步提交，任一步完成即写盘