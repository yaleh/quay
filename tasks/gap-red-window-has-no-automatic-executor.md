---
id: gap-red-window-has-no-automatic-executor
title: the red-window rules have no automatic executor — the ROUND 2 suite went
  RED (state=red, early-RED = the (a) block's designed behavior) and sat
  unhandled until the manager intervened, because BOTH branches (RED →
  stop-dispatch + triage; GREEN/RUNNING → optimistic proceed) only run when the
  20-min cron or a human drives them; mechanism written but no executor = the
  'exists ≠ effective' pattern; add an automatic suite-state trigger
  (runner/monitor notify → outer RED handling starts; optimistic-proceed gets an
  exerciser)
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者介入的**活实况**（2026-08-05 ROUND 2）：套件转红且无人处置——`.quay/full-suite-state.json` 是
`state=red`（早期 RED 生效，这是 (a) 块设计的行为），但**红窗规则要求的 RED 处置一步都没执行**：
没有 stop-dispatch 信号文件、没有分诊、没有二分肇事合并。两层都空闲（outer 0 / inner 0），两条
SESSION-OVERDUE 已触发（各 30 分钟无心跳）。**这正是「存在≠生效」的活例**——机制写好了但没有执行者。

**根因**：红窗规则的两个分支**都没有自动触发者**，全靠 `*/20` cron 或人驱动：
- **RED 分支**：套件转红后，外层下一次 cron tick 才会做分诊（窗口最长 20 分钟）；本轮 cron 没在红后
  立即触发，套件红着无人处置；
- **GREEN/RUNNING 分支**：乐观派发同样缺触发者——inner 无自触发（锚点不对称），round-1/round-2 的
  inner 都「待轮不派」即使池有可派任务，红窗乐观规则落地但未被动用。

**与今晚反复出现的「存在≠生效」同型**：机制写进文档 ≠ 机制被执行。需要一个**执行者**把状态变化
（state=red / state=running）自动转成动作（通知外层 / 驱动 inner 派发）。

### 选定机制（外层裁定）

**加一个套件状态自动触发者**，把红窗规则从「被动响应驱动」变成「状态变化即执行」：

1. **RED 自动触发**：`full-suite-runner`（或一个状态监视器）在 state 变 red 时**立即**：
   (a) 通知外层（推送/会话事件——不等下一次 cron）；(b) 确认 stop-dispatch 信号在位（state=red 即信号，
   外层被通知后启动 RED 处置：分诊 → 驱动修复 → 重启套件 → 重新 green → 撤信号）。**处置是既有逻辑的
   执行者，不是新决策者。**
2. **RUNNING/GREEN 自动触发乐观派发**：外层 tick（或 inner 重锚）在 state=running 时**按文档驱动 inner
   照常派发**（池有可派即派），不待轮——乐观行为有执行者。
3. **不引入新调度源**：触发者是既有处置/派发逻辑的**执行器**，节奏仍唯一（外层 cron）；只是把「cron 才
   检查状态」改成「状态变化即触发」。

**归属**：红窗规则在 `gap-full-suite-belongs-to-outer-background-above-3-min`（(a) 块，已落地）；本条是
它的**执行者层**（存在≠生效的补全）。

## Acceptance Criteria

- [ ] AC1: **RED 自动触发**——state 变 red 时立即通知外层并启动 RED 处置（不等下一次 cron；实测：套件红
      后外层在无人工/管理者介入下开始分诊）
- [ ] AC2: **触发者是既有处置的执行者**——不引入新决策；分诊/修复/重启/重绿/撤信号流程与 (a) 块 AC4 一致
- [ ] AC3: **RUNNING/GREEN 乐观派发有执行者**——state=running 时外层按文档驱动 inner 照常派发（池有可派
      即派），不待轮（乐观行为被实际动用一次，实跑证据）
- [ ] AC4: **不引入新调度源**——触发者不是独立决策者，节奏仍唯一（外层 cron）；状态变化即触发既有逻辑
- [ ] AC5: **真实使用**——一次套件转红：外层自动开始 RED 处置（非人/管理者提醒），全程记录
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC1/AC3/AC5 实跑证据贴任务体
- [ ] 套件转红 ⇒ 外层自动处置（本轮「红着无人处置 30 分钟」场景不再发生）；乐观派发被实际动用
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/full-suite-runner.ts（或等价状态监视器：state=red 立即通知/触发）
- plugin/loop/orchestrator-loop-tick.md（RED 处置的触发接线 + RUNNING 乐观派发执行）
- plugin/test/（AC1/AC3 fixture 单测）
- tasks/gap-full-suite-belongs-to-outer-background-above-3-min.md（交叉标注：本条是其执行者层）

## Contract

measure   red_to_triage_ms = `cat .quay/full-suite-state.json` stdout 的 finishedAt 到分诊启动的时间差字段（秒）
band      red_to_triage_ms = <300000（5 分钟内——远小于 cron 窗口 20 分钟；目标秒级）
invariant executor_not_new_scheduler = 1（触发者执行既有处置/派发逻辑，非独立决策）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
control   构造一次失败 suite ⇒ state=red 后外层被自动触发（非人提醒）；成功 suite ⇒ 无触发（负控制）
resume    触发者与处置接线分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T04:4xZ
changed: 外层受管理者介入活实况裁定立案（存在≠生效的 RED 分支）。四处收紧：
(1) **RED 自动触发**——state 变 red 立即通知外层 + 启动处置（不等 cron 窗口；本轮红 30 分钟无人处置
    场景不再发生）；
(2) **触发者是执行者非新调度**——处置/派发仍是既有逻辑，只是状态变化即触发；
(3) **乐观派发有执行者**——RUNNING 态按文档驱动 inner 照常派发（round-1/2 的待轮不派被消除）；
(4) **归属 (a) 块执行者层**——交叉标注 full-suite task。
status: todo——(a) 块的执行者补全；排当前 RED 分诊后，高优先。
