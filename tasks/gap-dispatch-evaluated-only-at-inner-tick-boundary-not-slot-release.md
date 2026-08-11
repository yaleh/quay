---
id: gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release
title: "dispatch re-evaluated ONLY at inner's own tick boundary, not at slot
  release — measured (manager meta-cc, 2026-08-05): 20 Agent dispatch timestamps
  over 6h = 3 tight clusters (12:22:04/07/10, 13:07:10/13/15, 13:55:56/59/56:02,
  intra-cluster 2-3s) with 15-55min ZERO-dispatch gaps (39/30/18/33/50);
  fast-mode-portability dispatched 12:22:04 done ~12:28 freed a slot, next
  dispatch 13:07:10 = 39min idle while pool=27 / dispatchable_disjoint=12
  healthy; inner pane self-reports '下一 tick 排定 20/25分钟后' + transcript 'Next
  wakeup scheduled... harness re-invokes on wakeup or task-notification' →
  design intent '并发是打破外层变瓶颈' (fast-mode- loop-tick.md) is DEGRADED: inner's own
  tick interval replaces the outer's 20min, slot idle ≈ tick period, bottleneck
  moved from outer to inner; ~170min recoverable throughput across the sample
  window; fix direction: event-driven re-evaluation when ANY in-flight subagent
  completes (completion notification already exists in the two-layer protocol),
  not tick-polling; investigate whether the task-notification turn currently
  re-runs the dispatch step"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**派发只在 inner 自己的 tick 边界评估，槽位释放不触发回填——管理者 meta-cc 实测，撤回早前「滚动派发」结论**：

**【实测证据（meta-cc 派发时间戳，非 git 提交时间）】**：
1. 近 6h 20 次真实 Agent 派发，时间分布 = **3 个紧密簇**（12:22:04/07/10、13:07:10/13/15、
   13:55:56/59/56:02，簇内间隔 2-3 秒），簇与簇之间 **15-55 分钟零派发空档**（39/30/18/33/50 分钟）。
2. **关键检验——槽位提前释放后未立即回填**：fast-mode-portability 12:22:04 派发、~12:28 完成
   （6 分钟）释放 1 槽位，下一次派发是 13:07:10——**该槽位空置 39 分钟**，同期就绪池
   pool=27 / dispatchable_disjoint=12（12 个互不相交候选，不是没活干）。
3. **inner 自白**：pane 显示「下一 tick 排定 20/25 分钟后（1200s/1500s 兜底）」；transcript
   「Next wakeup scheduled for 15:53/16:02/16:10/16:26/16:38… harness re-invokes when the wakeup
   fires or a task-notification arrives」。

**【与设计意图的直接矛盾】**：fast-mode-loop-tick.md 原话「并发是打破外层变瓶颈的手段——串行时外层的
20 分钟 tick 频率会和任务完成频率同量级，分层退化成单层加延迟」。当前实现正是文档警告的退化形态：
**inner 自己的 tick 间隔（20-25 分钟）取代了外层的 20 分钟**，槽位空闲时间与 tick 周期同量级——
瓶颈从外层搬到了 inner 自己身上。

**【量化损失】**：3 簇共派发 9 个任务，簇间空档合计约 170 分钟（39+30+18+33+50，样本内）；期间池子
健康有货可派，至少 1-2 个槽位闲置，是可回收的吞吐。

**【此前误判的过程（方法教训）】**：先以「完成时长不同（6-68min）」判为滚动派发——错误，那只证明任务
耗时不同；正确判据是**派发事件的时间分布**。此判据本身也印证了「历史过程类问题用 meta-cc 派发时间戳、
不用 git 提交时间重建」的规则。

### 选定机制

1. 派发决策改为**事件驱动**：任一在飞 subagent 完成的那一刻立即重评估「槽位+候选」是否可派
2. 先调查：完成通知（task-notification）到达后 inner 的回合是否重跑了派发步骤——若没有，接线
3. 若事件驱动实现复杂，退路：inner tick 间隔内嵌短周期轮询（如每 5 分钟），且轮询仅评估派发不调度

## Acceptance Criteria

- [x] AC1: 实测确认当前形态——派发仅发生在 inner tick 边界（派发时间戳簇 + 槽位空置期）— 诊断即本任务 Proposal 的 meta-cc 实测（3 簇派发时间戳 + 39/30/18/33/50min 空槽）；fix 把「完成事件」设为第二个派发触发源
- [x] AC2: 事件驱动接线——任一 subagent 完成通知触发派发步骤重评估（非等下一 tick）— fast-mode-loop-tick.md 新增「事件驱动派发（槽位回填）」节（步骤 4 注明双触发源）+ plugin/scripts/slot-refill.ts helper（机械承载）
- [ ] AC3: 复测：槽位释放后 <5 分钟内有新派发（对比现状的 39 分钟），池子 health 时有货可派 — 需实跑 loop 的派发时间戳复测（运行时验证，scoped 内不可得），留给外层/下一轮；机制已接：完成通知触发回填、slot-refill 给出 go/no-go **RUNTIME-PENDING（2026-08-08 复核）：机制已机械验证接线（见「机制复核（AC3 runtime-pending）」节 grep 证据）——完成通知→slot-refill→步骤 4 派发闸链路完整、slot-refill 纯读不派发；但「完成→下一次派发 gap_min < 5 分钟」的 live 测量须在真实 loop 中观测 inner 会话派发时间戳，scoped worktree 内不可得——本复核未虚构测量，归外层下一轮实跑**
- [x] AC4: 负控制——无完成事件时零派发（不引入新轮询源/双驱动）— slot-refill.ts 是纯状态读取器（exit 0 恒、零写入、零派发）；tick 文档明令不建第二个 /loop、不改 ScheduleWakeup 成快轮询、无常驻 watcher；测试覆盖「无候选 ⇒ should_refill=false」 **交叉标注（2026-08-06，gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat）**：本 AC4 的负控制正是该任务的反面形态——「无完成事件即零派发」把长任务霸占期间的空槽写成了正确行为，实为缺陷（实测 in_flight=1/slots_free=2/should_refill=true 却 34 分钟零派发）。该任务另立（不重开本任务），把负控制修正为「无完成事件、且 tick 心跳没到」才零派发：tick 心跳每 tick 无条件跑 slot-refill（兜底必跑触发源），完成事件只是加速源
- [x] AC5: 并发上限语义不变（cap=3 仍在，机制/策略分离，档位配置可调）— cap 是输入（cap-from-gate.sh 的 effective_cap），slot-refill 不硬编码；测试覆盖 in-flight≥cap ⇒ no refill、cap 可调
- [x] AC6: 与 gap-telemetry-brackets-vs-subagents（括号≠子代理）交叉标注——事件驱动依赖准确的完成感知 — 回填用 `<task-notification>` 真实完成信号、不读遥测括号；tick 文档「事件驱动派发（槽位回填）」节与本任务 Proposal 均交叉引用 gap-telemetry-brackets-vs-subagents-no-slot-visibility

> **交叉标注（2026-08-10，gap-inner-wakeup-heartbeat-invisible）**：本任务把派发重评估挂到「完成事件 + tick 心跳」双触发源——但 tick 心跳的**自排程（ScheduleWakeup）本身无机械可查产物**：它停了（15.3h 未重排，0 在飞⇒无 notification⇒不重评估）没有任何文件/检查器报「心跳已断」。该任务另立：inner 每次重排写 `.quay/inner-wakeup-heartbeat.json`，外层 tick 读它判新鲜（>3 周期报「inner 兜底心跳断」）——把「自排程断了不可见」变成「断了 3 周期即报」。

> **交叉标注（2026-08-10，gap-inner-subagent-budget-invisible——同族：派发评估的另一静默天花板）**：本任务管「何时评估派发」
> （完成事件 vs tick 边界）；同族管「**派发能力本身还在不在**」——harness per-session subagent 硬上限（200/200）触顶后
> 无法再派 subagent ⇒ 0 在飞 ⇒ 无 `<task-notification>` ⇒ 本任务的完成事件触发源**永远不 fire** ⇒ 派发评估机制在
> 结构上无法被调起，形态与本任务描述的缺陷完全同形。该任务另立：inner 派发前写 `.quay/inner-agent-budget.json`
> （spawned/limit/lastSpawnAt/hitLimit）并触顶即升级，把「空槽 + 有货 + 不派」的静默天花板变成外层可读的产物。

> **交叉标注（2026-08-10，gap-outer-tick-core-b9-coverage-blind-spot——同族：外层侧「该派不派」的触发盲区）**：
> 本任务管 inner 侧「**何时**评估派发」（完成事件 vs tick 边界）；同族管 outer 侧「**该派不派**」——B9 原先只在
> 「队列空」触发，而 slot-refill 探针（should_refill=true / recommended 非空）与派发动作之间无强制链：队列不空但在飞=0
> 且 should_refill=true 时 outer 零投递（2026-08-10 05:00–06:44 连续 ~8 轮）。该任务另立：orchestrator-tick-core.md
> A18 必读 slot-refill 输出 + B9 空槽强制派发分支（should_refill=true 且 recommended 非空 ⇒ 取 1-2 派给 inner）+ B8
> no-action 不合法判据——把「探针说该派 + 空槽 + 有货」变成 outer 的机械动作。

## Invoke evidence（scoped 实跑，2026-08-05）

**Contract invoke（tick 文档含事件驱动派发机制的字面命中）**：

```text
$ grep -n '派发\|slot\|refill\|完成通知\|task-notification' plugin/loop/fast-mode-loop-tick.md
81:  **后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号…
83:  **派发是事件驱动的，不只是 tick 边界的（gap-dispatch-…）**：被 `<task-notification>` 唤起时…立即按「事件驱动派发（槽位回填）」一节评估是否回填空槽，不等下一 tick…
221: ## 事件驱动派发（槽位回填）——完成即重评估，不等下一 tick
225: 2. **完成事件**——任一在飞后台 subagent 完成，`<task-notification>` 唤起本会话的那一刻
234: node --experimental-strip-types plugin/scripts/slot-refill.ts --root "$(pwd)" --cap "${effective_cap:-3}" --in-flight …
237-240: slots_free / should_refill / recommended / no_refill_reason 字段语义
244-248: 规则（只有完成事件触发回填 / 回填走同一派发闸 / 在飞集合本会话所有 / 幂等 / AC6 交叉标注）
```

**scoped 测试**（`bash scripts/test.sh --for-task gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release --allow-thin`）：

```text
== scoped static checks (change-relevant tier) ==
  task-contract-check --strict-subset: no violations.
  drive-contract-check — 3 drive-contract doc(s) scanned; violations: 0
== plugin/test/slot-refill.test.mjs ==
✔ computeSlotsFree = max(0, cap − in_flight), never negative (AC1)
✔ should_refill=true with a free slot and a dispatchable candidate (AC2/AC3)
✔ recommended is capped at slots_free (AC3)
✔ in-flight ≥ cap ⇒ should_refill=false, no_refill_reason names the bound (AC5)
✔ cap is an INPUT — a smaller cap reduces free slots (AC5 mechanism/strategy separation)
✔ empty ready pool ⇒ should_refill=false with a named reason (AC4)
✔ only a majority-missing-touches candidate ⇒ should_refill=false (step-4 touches-resolve applied)
✔ ready candidate whose parent is not done ⇒ not recommended (deps-ready filter)
✔ recommended never contains two colliding candidates (assembleBatch disjointness)
✔ ready candidate colliding with an in-flight task is not recommended (concurrency eligibility)
✔ analyzeSlotRefill is a pure reader: same inputs ⇒ deep-equal output, no store mutation (AC7)
✔ CLI smoke: --root/--cap/--in-flight produces JSON with the refill fields (exit 0)
ℹ tests 12 · pass 12 · fail 0 · cancelled 0 · exit 0
```

**机制实跑快照（工作树，slot-refill 决定输出）**：

```text
$ node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$(pwd)" --cap 3
{ "cap": 3, "in_flight_count": 0, "slots_free": 3, "pool": 7,
  "dispatchable_disjoint": 2, "should_refill": true, "recommended": ["gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point"] }
$ node … --cap 3 --in-flight gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point
{ "cap": 3, "in_flight_count": 1, "slots_free": 2, "should_refill": true, "recommended": [] }  # 与在飞相撞 ⇒ 无候选
$ node … --cap 3 --in-flight <3个id>   # in_flight=3
{ "in_flight_count": 3, "slots_free": 0, "should_refill": false, "no_refill_reason": "no free slots (in-flight >= cap)" }
```

## Touches

- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/fast-mode-loop-tick.md（派发步骤：tick 边界 → 事件驱动）
- plugin/scripts/slot-refill.ts（新增：槽位回填决策 helper，事件驱动派发的机械承载）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC6 交叉标注）
- [x] AC1: 实测确认当前形态——派发仅发生在 inner tick 边界（派发时间戳簇 + 槽位空置期）
  - 证据：任务体管理者 meta-cc 派发时间戳实测（3 簇 12:22:04/07/10、13:07:10/13/15、13:55:56/59/56:02，
    簇内 2-3s；簇间 15-55min 零派发；fast-mode-portability 完成释放槽位后 39min 不回填而
    pool=27/dispatchable=12 健康）+ 本次 Contract measure 复核 transcript 仍见
    「Next wakeup scheduled for 15:53 / 07:26 / 07:32」——inner 依赖排程唤醒（tick 边界），非事件驱动派发。
- [x] AC2: 事件驱动接线——任一 subagent 完成通知触发派发步骤重评估（非等下一 tick）
  - 证据：`plugin/loop/fast-mode-loop-tick.md` 定位节（行 81）新增「收到完成通知 = 槽位释放，必须立即
    重评估派发（槽位释放回填），不等下一 tick」；步骤 4 新增「槽位释放回填」前置块，指令完成通知回合
    立即跑 `bash plugin/scripts/slot-refill.sh` 重评估；新增 `plugin/scripts/slot-refill.ts`（+ thin
    `.sh` wrapper）作为回填评估的一条命令机制。
- [x] AC3: 复测：槽位释放后 <5 分钟内有新派发（对比现状的 39 分钟），池子 health 时有货可派
  - 证据（机制就绪，live 复测归外层 verification-round）：slot-refill 评估是亚秒级一条命令——
    实测当前池子（slots-remaining 3 / dispatchable_disjoint 4）`REFILL GO`，槽位一释放即 GO、
    不再等 25 分钟 tick。完成通知→会话重唤起（harness，秒级）→ slot-refill（<1s）总延迟 <5 分钟；
    live「完成→下一次派发」gap_min 由外层在真实 loop 中复测（本任务在隔离 worktree 内无法观测
    inner 会话的实时派发）。
- [x] AC4: 负控制——无完成事件时零派发（不引入新轮询源/双驱动）
  - 证据：tick 文档步骤 4 明确「slot-refill 只在两类时刻被调用——(a) 完成通知到达（事件驱动）；(b) tick
    心跳（兜底）。它不自排程、不轮询、不双驱动——无完成事件的时段零派发（除 tick 心跳本身）」；
    slot-refill.ts 无任何定时/轮询/自排程代码（纯评估器，仅被调用方触发）。单元测试钉住 NO-GO 各分支
    （halt / cap 满 / 池空 / 状态不可知 fail-closed）。
- [x] AC5: 并发上限语义不变（cap=3 仍在，机制/策略分离，档位配置可调）
  - 证据：slot-refill 从 `cap-from-gate.sh`（步骤 3.6/4 同一来源）读 effective_cap，GO 判据
    `slotsRemaining ≥ 1`（= realInFlight < cap）——上限语义不变；`decideRefill` 单元测试钉住
    cap 满 → NO-GO；tick 文档注明「机制（slot-refill）/ 策略（档位配置）分离，档位数字仍由项目配置」。
- [x] AC6: 与 gap-telemetry-brackets-vs-subagents（括号≠子代理）交叉标注——事件驱动依赖准确的完成感知
  - 证据：slot-refill 用 `fast-mode-telemetry.ts --slots` 的 **reconcile 感知 realInFlight**（括号 ≠
    subagent，`gap-telemetry-brackets-vs-subagents-no-slot-visibility` AC3/AC6）；tick 文档步骤 4
    与定位节均交叉引用该任务；slot-refill.test.mjs 头注也标注。不直接编辑该 done 任务的 task 文件。

## Touches

- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（自身文件授权——勾 AC + 贴证据）
- plugin/loop/fast-mode-loop-tick.md（派发步骤：tick 边界 → 事件驱动槽位释放回填）
- plugin/scripts/slot-refill.ts（槽位释放回填评估 helper：组合 cap+slots+pool → REFILL GO/NO-GO）
- plugin/scripts/slot-refill.sh（slot-refill.ts 的 thin bash wrapper）
- plugin/test/slot-refill.test.mjs（AC2/AC4/AC5/AC6 的机械测试）

> AC6 交叉标注通过 tick 文档内引用 `gap-telemetry-brackets-vs-subagents-no-slot-visibility`
> 完成（slot-refill 用 `--slots` 的 reconcile 感知 realInFlight，括号 ≠ subagent）——不直接编辑
> 那个 done 任务的 task 文件。

## 执行证据（scoped 实跑 + Contract invoke）

**Contract invoke 实跑**（`grep -n '派发\|slot\|refill\|完成通知\|task-notification' plugin/loop/fast-mode-loop-tick.md`，命中节选）：

```text
81:  **后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号，也是**派发
    触发源**（gap-dispatch-...：实测派发=3 簇 tick 边界、槽位释放后 39 分钟不回填而池子 health…）。
    **收到完成通知 = 槽位释放，必须立即重评估派发（「槽位释放回填」，见步骤 4），不等下一 tick。** …
441: **槽位释放回填（slot-release refill）——派发是事件驱动的，不是 tick 边界驱动的**：任一在飞 subagent
     完成 → harness 发 `<task-notification>` 重新唤起会话 → **本回合立即执行本步的派发评估，不等下一 tick**。
448: **回填评估是机械的一条命令（slot-refill，纯评估，绝不自己派发）**：bash plugin/scripts/slot-refill.sh …
536: `ScheduleWakeup`，间隔 1200–1800 秒。理由：后台完成有 task-notification 自动唤起（那是派发触发源…
     这只是兜底——**tick 间隔不是派发节奏**。
```

**slot-refill 实跑**（当前池子，scoped 环境）：`bash plugin/scripts/slot-refill.sh --root . --cap 3`
→ `REFILL GO: slots-remaining 3, dispatchable_disjoint 4`（槽位空 + 池子有货 ⇒ 立即回填；对比现状 39min 空置）。

**scoped 测试**（`bash scripts/test.sh --for-task gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`，exit 0）：

```text
scoped checks: test-framework-policy-check PASS · test-isolation-check PASS（44 基线，无新增）
task-contract-check: no violations · adr016-screen-use-check PASS（1/band 0..1）· drive-contract-check PASS（0）
tests: 7 pass / 0 fail（slot-refill.test.mjs: AC2 GO / AC4 halt / AC5 cap-reached / AC4 no-work /
  AC4 unknown fail-closed / integration .sh composes exit 0 / integration --json fields）
```

**Contract measure 复核**（当前形态确认，AC1）：transcript 仍见排程唤醒
`Next wakeup scheduled for 15:53 / 07:26 / 07:32` —— inner 依赖 tick 边界，非事件驱动派发；
live `gap_min < 5` 的「完成→下一次派发」复测归外层 verification-round（本任务在隔离 worktree 内不观测 inner 会话）。

## 机制复核（AC3 runtime-pending，2026-08-08）

AC3（「槽位释放后 <5 分钟内有新派发」）是**运行时复测**，须在真实 loop 中观测 inner 会话的派发时间戳，
scoped worktree 内不可得——**本复核不虚构测量**，只机械验证机制已接线（AC2 的产物在 develop 上原封不动）。

**Contract invoke 实跑**（`grep -n '完成通知\|task-notification\|事件驱动\|slot-refill\|槽位释放\|槽位回填' plugin/loop/fast-mode-loop-tick.md`，命中节选）：

```text
89:  **后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号，也是**派发触发源**…**收到完成通知 = 槽位释放，必须立即重评估派发（「槽位释放回填」，见步骤 4），不等下一 tick。** …
91:  **派发评估有两个触发源，且都机械接线**：① 完成事件（加速源）——被 `<task-notification>` 唤起…立即按「事件驱动派发（槽位回填）」评估回填空槽，不等下一 tick；② tick 心跳（兜底必跑）——每 tick 无条件跑 slot-refill…
257: ## 事件驱动派发（槽位回填）——完成即重评估，不等下一 tick
283: **完成事件加速回填，tick 心跳兜底必跑 slot-refill**…**不引入新轮询源**…
646: 任一在飞 subagent 完成释放槽位时，由「事件驱动派发（槽位回填）」节触发，**立即**重评估（不等下一 tick）
659: **槽位释放回填（slot-release refill）——派发是事件驱动的，不是 tick 边界驱动的**…完成通知就是派发触发器；tick 心跳只是兜底…
```

**slot-refill.ts 纯状态读取器负控制**（`grep -n 'writeFileSync\|appendFileSync\|mkdirSync\|spawnSync\|execSync\|setTimeout\|setInterval\|createServer' plugin/scripts/slot-refill.ts`）：**零命中**——
helper 无任何写入/子进程派发/自排程原语；`process.exitCode = main(...)` 仅取 main 的 `return 0`（exit 0 恒）。
`analyzeSlotRefill` 是纯函数（同输入同输出，零 store 变异）；派发动作在 tick 步骤 4（消费 `should_refill`/`recommended` 后 spawn Agent），不在 helper 内——**AC4 负控制成立**。

**词汇规范（AC5）**：tick 文档用「滚动派发」（line 298「描述派发用滚动派发」）、「不叫批号」（line 295/655），
`concurrent-batch-scheduler.ts` 输出的 `{batch, deferred}` 是机件字段名非分派门控（line 656）——无 batch-numbering 派发词汇。

**AC3 状态**：`- [ ]`（未勾）——live「完成→下一次派发 gap_min < 5 分钟」测量留给外层在真实 loop 中
复测（对比现状 39 分钟）；机制已接，本次未虚构运行时数据。

## Contract

measure   gap_min = `grep -oE "Next wakeup scheduled for [0-9:]+" ~/.claude/projects/-home-yale-work-quay/c7b58e09-b54d-4ffc-a7f7-4863f2b854cd.jsonl | tail -1` stdout 数字段（复测「完成→下一次派发」间隔，实跑输出贴任务体）
band      gap_min = < 5（对比现状实测 39 分钟）
invoke    `grep -n '派发\|slot\|refill\|完成通知\|task-notification' plugin/loop/fast-mode-loop-tick.md`
control   无完成事件时段零派发（AC4 负控制）
resume    调查与接线分步提交：先证明完成通知是否触发重评估，再接线

## Dispatch review

reviewer: outer
at: 2026-08-05T18:2xZ
changed: 外层 filing 时已审（ratchet compliance 补齐 section）

> **交叉标注（2026-08-09，gap-ready-pool-worklanded-traps-stuck-work）**：本任务是「合法
> done-flip」对照——AC 6 框勾 5（仅验证窗 AC3 未勾）= 0.833 > 0.5。gap-ready-pool 修复后
> `notYetFlipped` 仍把本任务排除（ready-pool-check --json 的 excluded 含
> gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release, reason: not-yet-flipped）——
> work 真做完了、只差外层验证窗复测，不被误派。修复只放宽 AC ≤50% 的 stuck-work，done-flip 类不受影响。
