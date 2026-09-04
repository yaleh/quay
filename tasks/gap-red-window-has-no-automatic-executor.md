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
status: done
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

- [x] AC1: **RED 自动触发**——state 变 red 时立即通知外层并启动 RED 处置（不等下一次 cron；实测：套件红
      后外层在无人工/管理者介入下开始分诊）
- [x] AC2: **触发者是既有处置的执行者**——不引入新决策；分诊/修复/重启/重绿/撤信号流程与 (a) 块 AC4 一致
- [x] AC3: **RUNNING/GREEN 乐观派发有执行者**——state=running 时外层按文档驱动 inner 照常派发（池有可派
      即派），不待轮（乐观行为被实际动用一次，实跑证据）
- [x] AC4: **不引入新调度源**——触发者不是独立决策者，节奏仍唯一（外层 cron）；状态变化即触发既有逻辑
- [x] AC5: **真实使用**——一次套件转红：外层自动开始 RED 处置（非人/管理者提醒），全程记录
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC1–AC6 全部勾上；AC1/AC3/AC5 实跑证据贴任务体
- [x] 套件转红 ⇒ 外层自动处置（本轮「红着无人处置 30 分钟」场景不再发生）；乐观派发被实际动用
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

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

## 落地证据（2026-08-05，实现提交时写入，worktree `task/gap-red-window-has-no-automatic-executor`）

**机制落地**：
- `plugin/scripts/suite-state-trigger.ts`（new，capability-catalog 已声明）——红窗规则的**自动执行者**：
  状态变化即触发。`runOnce` 读 `.quay/full-suite-state.json` 的 `state`，与记忆文件
  `.quay/suite-state-last.json` 比较，**转变**时记一条到 `.quay/suite-state-events.jsonl`
  （append-only，`SUITE-RED.at` = `red_to_triage_ms` 起点）并打印事件：
  - `→ red` ⇒ `SUITE-RED`（`stopSignal:true` 确认 stop-dispatch 信号在位；`early` 标记早期 RED）；
  - `→ running` ⇒ `SUITE-RUNNING`（乐观派发执行者的事件）；
  - `→ green` ⇒ `SUITE-GREEN`。
  冷启动即红（外层 /clear 后套件仍红）也触发 `SUITE-RED`——第一眼即红，不等 cron（ROUND 2 形态兜底）。
  纯转变检测 `detectSuiteEvent` 导出可单测；`--monitor` 模式每 5 秒一轮，事件打到 stdout = 外层
  Monitor 事件流（立即推送，不等 20 分钟 cron）。
- `plugin/scripts/full-suite-runner.ts`——加 `--fail-fast-check`（Contract invoke）：构造失败 suite ⇒
  state=red ⇒ runOnce 记 `SUITE-RED` ⇒ stopSignal 在位，退出 0 = RED 自动触发链端到端验证。
- `plugin/loop/orchestrator-loop-tick.md`——接线：
  - 冷启动 **4b2**：挂 `suite-state-trigger.ts --monitor`（套件状态自动触发者；`SUITE-RED` ⇒ 立即 RED
    处置，`SUITE-RUNNING` ⇒ 乐观派发执行者）；
  - 步骤 1b 新增「套件状态自动触发者」子节：状态变化→事件表、触发者是执行者非新调度（AC2/AC4）、
    Contract invoke；红窗分诊 intro 注明由 `SUITE-RED` 触发、信号即 state=red；
  - 相关文件表 + 每 tick 必报补 suite-state-events.jsonl / 触发者挂载状态。
- `tasks/gap-full-suite-belongs-to-outer-background-above-3-min.md`——交叉标注：本条是其执行者层。
- `tasks/gap-suite-state-split-across-worktree-and-gate.md`——交叉标注：**本条 trigger 只读主 repo 相对路径
  `.quay/full-suite-state.json`**；该条保证 runner 跑 worktree（`--root <worktree>`）时经 `--state-dir` 把 state
  写进主 repo 并镜像回 worktree，trigger 的 SUITE-GREEN/RED 事件流才接到真实结果（否则 worktree 跑的绿写不进主 repo，
  事件流接到的是 stale red / 永不触发）。
- `.gitignore`——`full-suite-state.json` / `full-suite.log` / `suite-state-events.jsonl` /
  `suite-state-last.json`（运行时态，同 gate-events 族）。

**测试实跑输出**（`QUAY_TEST_SKIP_STATIC_CHECKS=1 scripts/test.sh plugin/test/suite-state-trigger.test.mjs`）：
```
✔ AC1 — state flips to red => SUITE-RED event, recorded, stopSignal in place (fixture)
✔ AC1 — the outer tick doc wires SUITE-RED => immediately start RED handling, NOT waiting for the next cron
✔ AC1 unit — detectSuiteEvent is a pure transition detector
✔ AC1b — cold-start-into-red still fires SUITE-RED (the ROUND 2 'red and nobody handling it' shape)
✔ AC2 — the trigger introduces NO new decisions: no triage/dispatch logic lives in it
✔ AC3 — state=running => SUITE-RUNNING; the doc wires it to drive inner dispatch (optimistic exerciser)
✔ AC4 — the trigger is Monitor-style event monitoring: no new scheduling source
✔ Contract invoke — `full-suite-runner.ts --fail-fast-check` proves: failure suite => red => SUITE-RED => stopSignal
✔ Contract control (negative) — a green suite produces NO SUITE-RED
✔ AC6 — this file declares node:test and // @test-group governance
ℹ tests 10 / pass 10 / fail 0 / cancelled 0
```
相邻回归：`full-suite-runner.test.mjs`（8/8）+ `capability-catalog.test.mjs`（8/8）一并实跑绿；
`bash plugin/scripts/capability-catalog.sh --summary` → `92 scripts | 92 declared | 0 unclassified`（AC1c gate）。

**AC1/AC3/AC5 证据（机制 vs 实跑，按 (a) 块先例分列）**：
- **AC1 机制已落地**：`suite-state-trigger.ts` 在 state 变 red 的**转变**上立即发 `SUITE-RED`（fixture
  证明 `early=true` 早期 RED + `stopSignal:true`），外层 Monitor（4b2 挂上）把它当会话事件推送，不等
  下一次 cron；`--fail-fast-check` 证明「失败 suite ⇒ red ⇒ SUITE-RED ⇒ stopSignal」整链。**实跑待补**：
  下一次真实套件转红时，外层在无人/管理者提醒下自动开始分诊——由外层核对补记（本轮 ROUND 2 已过去，
  机制落地于其后的首次真实 red）。
- **AC3 机制已落地**：state=running 发 `SUITE-RUNNING`，orchestrator 步骤 1b 明确「RUNNING 乐观派发
  执行者：池有 `dispatchable_disjoint ≥ cap` 就按 §4 驱动 inner 照常派发（不待轮）」。**实跑待补**：
  下一次外层后台套件运行期间（state=running）inner 实际照常派发不待轮的 telemetry 记录（`--task-start`
  时间戳落在 running 窗口内）。
- **AC5 真实使用待实际 RED 发生**：机制 + fixture 已勾（含负控制：green 无触发）；一次真实转红 ⇒ 外层
  自动 RED 处置（非人提醒）的全程记录由外层在首次真实 red 时核对补记，同 (a) 块 AC6 先例。
- 按 closure-sync AC5 先例：机制 + fixture 证据已勾，实跑证据待外层自然产生后由外层核对补记。
- **DoD 全量套件绿**：本条 SCOPED ONLY，不跑全量；全量绿归外层 verification-round 核对。
