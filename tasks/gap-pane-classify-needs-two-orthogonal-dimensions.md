---
id: gap-pane-classify-needs-two-orthogonal-dimensions
title: pane-state-classify 枚举态少一个维度——【主线程能否收输入】与【后台 agent 是否在跑】正交，单枚举装不下 ⇒
  MARKER-STALE 是诚实报告非分类器 bug（{input空闲+agents在跑} 判 unknown）；正确形态=两个正交字段
  input_state/work_in_flight；附缺口：PANEL_BUSY_RE 只匹配 ctrl+t（面板折叠态），展开态变 ↓ to
  manage 不命中
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

**`classifyPaneState` 的枚举五态（waiting-input / permission-prompt / busy / error-banner / unknown）只有一个槽，但 pane 的真实状态是两个正交维度：①【主线程能否收输入】（input_state）②【后台 agent 是否在跑】（work_in_flight）。inner 实况 `⏵⏵ bypass permissions on · ← 1 agent · ↓ to manage` + agent 列表 `● main` / `◯ general-purpose …` = {输入空闲 + agents 在跑}——既无 `esc to interrupt`（主线程真空闲）也无 `ctrl+t to hide tasks`（面板展开态），`classifyPaneState` 返回 unknown。⇒ MARKER-STALE 不是分类器 bug，是监视器诚实报告「transcript 在动但屏幕判空闲」这个装不下的组合。**

### 实证（manager 2026-08-11 04:1x，03:5x 实测 inner + outer 复核）

- **实测 pane**（03:5x inner）：状态行 `⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · ↓ to manage` + agent 列表 `● main` / `◯ general-purpose Reviewing the full diff summary. 17m 13s`。
- **两件事正交**：主线程空闲、输入框可用（无 esc）AND 后台 agent 在跑、transcript 在动——枚举五态只有一个槽装不下这个组合。
- **outer 复核**：`classifyPaneState` 对该文本返回 `{state:"unknown", confidence:0}`——确认无槽可装。
- **PANEL_BUSY_RE 缺口**：只匹配 `ctrl+t to hide tasks`（面板**折叠**态）；面板**展开**时状态行变 `↓ to manage`，该正则不命中。若要继续走单枚举路线，这是具体缺口。
- **正确形态（manager 建议，裁定归 outer）**：分类器返回两个正交字段——`input_state`（能否收输入）与 `work_in_flight`（有无 agent 在跑）。这样 MARKER-STALE 不再是异常：transcript 在动 + 输入空闲 + agents>0 三者自洽。
- **代码注释里那条拒绝是对的、别推翻**：`← N agent` 与 `1 monitor` 确实在空闲时也渲染，所以不能当 busy 标志。但结论应是【它们是独立的 work-in-flight 标志，不是 busy 标志】。
- **操作影响（为什么值得修）**：manager 决定投递与否依据【能否收输入】；【是否忙】只影响要不要等。现在两者合成一个值，导致每次都要额外查 transcript + pane 两路才能下判断——今晚为此多跑 5 次核实。
- **既有任务未覆盖**：gap-pane-classify-busy-truncated（成因 A/B 截断与面板标志）与 gap-pane-classify-allow-bare-word（--allow-thin）均已 done，但【两正交维度】这个形态没被覆盖。

### 选定机制方向（实现归 inner，判定归 outer）

**`classifyPaneState` 返回两个正交字段**（或新增一个 `classifyPaneStateOrthogonal` 并行函数，保持旧枚举兼容）：
1. **`input_state`**：`waiting-input`（主线程空闲可收输入）/ `permission-prompt` / `busy`（主线程被占用）/ `error-banner`——即现有枚举去掉 work_in_flight 的部分。
2. **`work_in_flight`**：布尔——`● main` / `◯ general-purpose`（agent 列表）或 `← N agent` 存在 ⇒ true。注意：agent 列表行已由 `AGENT_LIST_LINE_RE` 识别，`← N agent` 是独立的 work-in-flight 标志（非 busy）。
3. **PANEL_BUSY_RE 补展开态**：`↓ to manage`（面板展开态）加入匹配——若走单枚举路线则这是必补缺口。
4. **消费方适配**：inner-blocked-signal / session-liveness / supervisor-health 读新字段（input_state 判能否收输入；work_in_flight 判是否等）。

**验证锚**：修后 (a) 实测 pane（`← 1 agent · ↓ to manage` + agent 列表）返回 `input_state=waiting-input` + `work_in_flight=true`；(b) MARKER-STALE 场景自洽（transcript 动 + input 空闲 + agents>0 非异常）；(c) 旧枚举兼容（waiting-input/busy/permission-prompt 单字段仍可用）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实测 pane（`← 1 agent · ↓ to manage` + `● main`/`◯ general-purpose`）+ `classifyPaneState` 返回 unknown（本任务 Proposal 已含）
- [ ] AC2: **两正交字段**——`classifyPaneStateOrthogonal` 返回 `input_state` + `work_in_flight`；实测 pane 得 `waiting-input` + `true`
- [ ] AC3: **work-in-flight 独立标志**——`← N agent`/agent 列表是 work_in_flight 标志（非 busy）；空闲时渲染不误判（代码注释拒绝保留）
- [ ] AC4: **PANEL_BUSY_RE 补展开态**——`↓ to manage` 加入匹配（若走单枚举路线必补）；或新字段天然覆盖
- [ ] AC5: **消费方适配 + 既有不回归**——inner-blocked-signal/session-liveness/supervisor-health 读新字段；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：实测 pane 返回两字段（贴输出）；MARKER-STALE 场景自洽
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（新增 `classifyPaneStateOrthogonal` 或改造 + PANEL_BUSY_RE 补 `↓ to manage`）
- plugin/test/pane-state-classify.test.mjs（两正交字段 + 展开态用例）
- plugin/scripts/inner-blocked-signal.ts（读新字段）
- plugin/scripts/session-liveness.sh（读新字段；MARKER-STALE 语义更新）
- plugin/scripts/supervisor-health.sh（读新字段）
- tasks/gap-pane-classify-busy-truncated-by-column-width.md（交叉标注——已 done，此形态未覆盖）
- tasks/gap-pane-classify-allow-bare-word-and-agent-list-masks-busy.md（交叉标注）
- tasks/gap-pane-classify-needs-two-orthogonal-dimensions.md（自身：勾 AC + 贴证据）

## Contract

measure   orthogonal_input_state = `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --pane-text "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · ↓ to manage" --json` 的 stdout 中 input_state 字段
band      orthogonal_input_state = waiting-input（主线程空闲可收输入）
measure   orthogonal_work_in_flight = `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --pane-text "⏵⏵ bypass permissions on · ← 1 agent · ↓ to manage" --json` 的 stdout 中 work_in_flight 字段
band      orthogonal_work_in_flight = true（有 agent 在跑）
invariant marker_stale_self_consistent = 1（transcript 动 + input 空闲 + agents>0 非异常）
invariant old_enum_compatible = 1（waiting-input/busy/permission-prompt 单字段仍可用）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --pane-text "<实测 pane>" --json`（贴 input_state + work_in_flight）
control   实测 pane 两字段正确；MARKER-STALE 自洽；旧枚举兼容；消费方不回归
resume    新字段 / PANEL_BUSY_RE / 消费方 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:1x 根因查清——MARKER-STALE 非分类器 bug，是枚举态少一个维度（{input空闲+agents在跑} 装不下）；两正交字段 input_state/work_in_flight 是正确形态；PANEL_BUSY_RE 缺展开态 ↓ to manage。既有两 done 任务未覆盖此形态。实现归 inner，判定归 outer
