---
id: gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release
title: "dispatch re-evaluated ONLY at inner's own tick boundary, not at slot
  release — measured (manager meta-cc, 2026-08-05): 20 Agent dispatch
  timestamps over 6h = 3 tight clusters (12:22:04/07/10, 13:07:10/13/15,
  13:55:56/59/56:02, intra-cluster 2-3s) with 15-55min ZERO-dispatch gaps
  (39/30/18/33/50); fast-mode-portability dispatched 12:22:04 done ~12:28
  freed a slot, next dispatch 13:07:10 = 39min idle while pool=27 /
  dispatchable_disjoint=12 healthy; inner pane self-reports '下一 tick 排定
  20/25分钟后' + transcript 'Next wakeup scheduled... harness re-invokes on
  wakeup or task-notification' → design intent '并发是打破外层变瓶颈' (fast-mode-
  loop-tick.md) is DEGRADED: inner's own tick interval replaces the outer's
  20min, slot idle ≈ tick period, bottleneck moved from outer to inner;
  ~170min recoverable throughput across the sample window; fix direction:
  event-driven re-evaluation when ANY in-flight subagent completes (completion
  notification already exists in the two-layer protocol), not tick-polling;
  investigate whether the task-notification turn currently re-runs the dispatch
  step"
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
- [ ] AC3: 复测：槽位释放后 <5 分钟内有新派发（对比现状的 39 分钟），池子 health 时有货可派 — 需实跑 loop 的派发时间戳复测（运行时验证，scoped 内不可得），留给外层/下一轮；机制已接：完成通知触发回填、slot-refill 给出 go/no-go
- [x] AC4: 负控制——无完成事件时零派发（不引入新轮询源/双驱动）— slot-refill.ts 是纯状态读取器（exit 0 恒、零写入、零派发）；tick 文档明令不建第二个 /loop、不改 ScheduleWakeup 成快轮询、无常驻 watcher；测试覆盖「无候选 ⇒ should_refill=false」
- [x] AC5: 并发上限语义不变（cap=3 仍在，机制/策略分离，档位配置可调）— cap 是输入（cap-from-gate.sh 的 effective_cap），slot-refill 不硬编码；测试覆盖 in-flight≥cap ⇒ no refill、cap 可调
- [x] AC6: 与 gap-telemetry-brackets-vs-subagents（括号≠子代理）交叉标注——事件驱动依赖准确的完成感知 — 回填用 `<task-notification>` 真实完成信号、不读遥测括号；tick 文档「事件驱动派发（槽位回填）」节与本任务 Proposal 均交叉引用 gap-telemetry-brackets-vs-subagents-no-slot-visibility

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
